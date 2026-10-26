// Imports only the historical delayed-receipt rows. Never creates live tasks.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const [manifestPath, rowsPath, sourcePath, mode] = process.argv.slice(2);
assert(manifestPath && rowsPath && sourcePath, 'Usage: node import_observations_source.mjs manifest.json rows.jsonl source.xlsm [--verify-only]');
assert(!mode || mode === '--verify-only', 'Unknown import mode');
const [manifestRaw, rowsRaw, sourceRaw] = await Promise.all([
  readFile(manifestPath), readFile(rowsPath), readFile(sourcePath),
]);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
assert(manifest.formatVersion === 1 && manifest.sheet === 'Observações', 'Unexpected source format');
assert(manifest.lastExcelRow >= 10 && manifest.lastExcelRow <= 10000, 'Unexpected source size');
assert(JSON.stringify(manifest.excludedColumns) === JSON.stringify(['H', 'I']), 'Contract columns must be excluded');
assert(sha256(sourceRaw) === manifest.sourceWorkbookSha256, 'Workbook hash mismatch');
assert(sha256(rowsRaw) === manifest.rowsSha256, 'Export hash mismatch');
const rows = rowsRaw.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
assert(rows.length === manifest.delayRowCount && rows.length > 0, 'Delay count mismatch');
assert(rows.every((row, i) => Number.isSafeInteger(row.excelRow) && row.excelRow >= 2 && row.excelRow <= manifest.lastExcelRow && (i === 0 || row.excelRow > rows[i - 1].excelRow)), 'Invalid row ordering');
assert(rows.every((row) => /^[0-9a-f]{64}$/.test(row.rowSha256) && row.sectionLabel && row.cells && Object.keys(row.cells).length === 27 && !('H' in row.cells) && !('I' in row.cells)), 'Invalid delay row');
assert(manifest.excludedAdvanceExcelRows.every((excelRow) => !rows.some((row) => row.excelRow === excelRow)), 'An advance row was included');
assert(sha256(rows.map((row) => row.rowSha256).join('\n')) === manifest.rowHashesSha256, 'Row digest mismatch');
if (mode === '--verify-only') {
  console.log(JSON.stringify({ result: 'verified_only', rows: rows.length, excludedAdvanceRows: manifest.excludedAdvanceExcelRows.length }));
  process.exit(0);
}

assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
const prisma = new PrismaClient();
try {
  const batch = await prisma.dudaBdGeralImport.findUnique({
    where: { sourceWorkbookSha256: manifest.sourceWorkbookSha256 }, select: { id: true },
  });
  assert(batch, 'Matching BD Geral import not found');
  const existing = await prisma.dudaObservationSourceRow.findMany({
    where: { importId: batch.id }, orderBy: { excelRow: 'asc' }, select: { excelRow: true, rowSha256: true },
  });
  if (existing.length) {
    assert(existing.length === rows.length && existing.every((row, index) => row.excelRow === rows[index].excelRow && row.rowSha256 === rows[index].rowSha256), 'Existing Observações import differs');
    console.log(JSON.stringify({ result: 'already_present', importId: batch.id, rows: existing.length }));
  } else {
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 100) {
        await tx.dudaObservationSourceRow.createMany({
          data: rows.slice(index, index + 100).map((row) => ({
            id: randomUUID(), importId: batch.id, excelRow: row.excelRow,
            rowSha256: row.rowSha256, trackingMonth: row.trackingMonth,
            sectionLabel: row.sectionLabel, groupLabel: row.groupLabel,
            workName: row.workName, municipality: row.municipality, cells: row.cells,
          })),
        });
      }
    }, { timeout: 120000 });
    const actual = await prisma.dudaObservationSourceRow.findMany({
      where: { importId: batch.id }, orderBy: { excelRow: 'asc' }, select: { excelRow: true, rowSha256: true },
    });
    assert(actual.length === rows.length && actual.every((row, index) => row.excelRow === rows[index].excelRow && row.rowSha256 === rows[index].rowSha256), 'Post-import readback failed');
    console.log(JSON.stringify({ result: 'imported_historical_delays', importId: batch.id, rows: actual.length }));
  }
} finally {
  await prisma.$disconnect();
}
