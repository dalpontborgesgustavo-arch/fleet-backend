"""Export only delayed-receipt detail rows from the legacy Observações sheet.

The output is historical evidence, not an operational pending queue. The
workbook is read only and macros are never executed.
"""

import argparse
import hashlib
import pathlib
import re
import sys
import warnings

import openpyxl
from openpyxl.utils import get_column_letter

from extract_workbook import canonical_json, serializable, text_value


EXCLUDED_COLUMNS = {8, 9}  # Contract value and balance are not used in JR.
LAST_COLUMN = 29


def section_month(label):
    # Match two-digit months before one-digit months; the word boundary avoids
    # silently treating "10" as "1" when a year follows.
    match = re.search(r"M[ÊE]S\s+(1[0-2]|0?[1-9])\b(?:\s+DE\s+(20\d{2}))?", label, re.I)
    return f"{match.group(2)}-{int(match.group(1)):02d}" if match and match.group(2) else None


def extract(source: pathlib.Path, output_dir: pathlib.Path):
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    warnings.filterwarnings("ignore", message="Unknown extension is not supported")
    formulas = openpyxl.load_workbook(source, read_only=False, data_only=False)
    cached = openpyxl.load_workbook(source, read_only=False, data_only=True)
    ws = formulas["Observações"]
    values = cached["Observações"]
    if ws.max_row < 10 or ws.max_row > 10000 or ws.max_column < LAST_COLUMN:
        raise ValueError("Unexpected Observações worksheet dimensions")
    headers = [text_value(ws.cell(1, index).value) for index in range(1, LAST_COLUMN + 1)]
    if headers[0] != "ITEM" or headers[6] != "OBRA":
        raise ValueError("Unexpected Observações worksheet headers")
    output_dir.mkdir(parents=True, exist_ok=True)
    rows_path = output_dir / "observations_delay_rows.jsonl"
    section = None
    group = None
    advance_group = False
    advance_rows = []
    delay_rows = []
    row_hashes = []
    with rows_path.open("w", encoding="utf-8", newline="\n") as stream:
        for excel_row in range(2, ws.max_row + 1):
            label = text_value(values.cell(excel_row, 1).value)
            if label:
                normalized = label.upper()
                if "OBSERVAÇÕES REFERENTE AO RECEBIMENTO" in normalized:
                    section = label
                    group = None
                    advance_group = False
                    continue
                if "PAGAMENTO ANTECIPADO" in normalized:
                    group = label
                    advance_group = True
                    continue
                if "PAGAMENTO PRORROGADO" in normalized:
                    group = label
                    advance_group = False
                    continue
            if not section:
                continue
            work = text_value(values.cell(excel_row, 7).value)
            if work and work.upper() == "TOTAL":
                continue
            if not any(values.cell(excel_row, index).value not in (None, "") for index in range(2, LAST_COLUMN + 1)):
                continue
            if advance_group:
                advance_rows.append(excel_row)
                continue
            cells = {}
            for index in range(1, LAST_COLUMN + 1):
                if index in EXCLUDED_COLUMNS:
                    continue
                letter = get_column_letter(index)
                cell = ws.cell(excel_row, index)
                cached_cell = values.cell(excel_row, index)
                formula = serializable(cell.value) if cell.data_type == "f" else None
                cells[letter] = {
                    "header": headers[index - 1],
                    "raw": None if formula else serializable(cell.value),
                    "formula": formula,
                    "cached": serializable(cached_cell.value),
                    "numberFormat": cell.number_format,
                    "dataType": cell.data_type,
                }
            row_sha = hashlib.sha256(canonical_json(cells).encode("utf-8")).hexdigest()
            row_hashes.append(row_sha)
            row = {
                "excelRow": excel_row,
                "rowSha256": row_sha,
                "trackingMonth": section_month(section),
                "sectionLabel": section,
                "groupLabel": group,
                "workName": work,
                "municipality": text_value(values.cell(excel_row, 6).value),
                "cells": cells,
            }
            delay_rows.append(excel_row)
            stream.write(canonical_json(row) + "\n")
    manifest = {
        "formatVersion": 1,
        "sheet": "Observações",
        "sourceWorkbookSha256": source_sha,
        "sourceLabel": "Recebimentos atrasados, histórico da planilha",
        "lastExcelRow": ws.max_row,
        "delayRowCount": len(delay_rows),
        "excludedAdvanceExcelRows": advance_rows,
        "excludedColumns": ["H", "I"],
        "rowsSha256": hashlib.sha256(rows_path.read_bytes()).hexdigest(),
        "rowHashesSha256": hashlib.sha256("\n".join(row_hashes).encode("ascii")).hexdigest(),
    }
    (output_dir / "observations_manifest.json").write_text(canonical_json(manifest) + "\n", encoding="utf-8")
    print(canonical_json({key: manifest[key] for key in ("sourceWorkbookSha256", "lastExcelRow", "delayRowCount", "excludedAdvanceExcelRows", "rowsSha256")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output_dir", type=pathlib.Path)
    args = parser.parse_args()
    try:
        extract(args.source, args.output_dir)
    except Exception as error:
        print(f"Observações export failed: {error}", file=sys.stderr)
        raise
