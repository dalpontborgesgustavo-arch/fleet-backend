"""Extract only the Prateleiras sheet into a private JSON import payload.

The workbook is read-only; never commit the payload or original workbook.
"""

import argparse
import hashlib
import json
import pathlib
import re

import openpyxl


def extract(source: pathlib.Path):
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True, keep_links=False)
    sheet = workbook["Prateleiras"]
    rows = []
    current_month = None
    for index, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        title = row[0]
        if isinstance(title, str) and title.strip():
            match = re.search(r"\b(1[0-2]|[1-9])\s+DE\s+(20\d{2})\b", title, re.IGNORECASE)
            if not match:
                raise ValueError(f"Unrecognized section header on row {index}")
            current_month = f"{match.group(2)}-{int(match.group(1)):02d}"
            continue
        municipality = str(row[5] or "").strip()
        work_name = str(row[6] or "").strip()
        amount = row[10]
        category = str(row[27] or "").strip()
        if not any((municipality, work_name, amount, category)):
            continue
        if not current_month or not isinstance(amount, (int, float)) or amount <= 0:
            raise ValueError(f"Incomplete shelf row {index}")
        if any(value is not None for col, value in enumerate(row) if col not in (5, 6, 10, 27)):
            raise ValueError(f"Unexpected data outside selected shelf columns on row {index}")
        rows.append({
            "excelRow": index,
            "trackingMonth": current_month,
            "municipality": municipality,
            "workName": work_name,
            "amount": f"{amount:.2f}",
            "category": category,
        })
    if not rows:
        raise ValueError("No shelf rows found")
    return {"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "rows": rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    payload = extract(args.source)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"sourceSha256": payload["sourceSha256"], "rowCount": len(payload["rows"]), "months": sorted(set(row["trackingMonth"] for row in payload["rows"]))}))


if __name__ == "__main__":
    main()
