// Private, idempotent evidence import. It does not create operational facts.
// Run only after database backup and migration readback.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [manifestPath, rowsPath, sourcePath, mode] = process.argv.slice(2);
assert(manifestPath && rowsPath && sourcePath, 'Usage: node import_staging.mjs manifest.json bd_geral_rows.jsonl source.xlsm [--verify-only]');
assert(!mode || mode === '--verify-only', 'Unknown import mode');

const [manifestRaw, rowsRaw, sourceRaw] = await Promise.all([
  readFile(manifestPath),
  readFile(rowsPath),
  readFile(sourcePath),
]);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
assert(manifest.formatVersion === 1, 'Unsupported export format');
assert(manifest.sheet === 'BD Geral', 'Unexpected source sheet');
assert(manifest.includedColumnCount === 27, 'Unexpected column count');
assert(JSON.stringify(manifest.excludedColumns) === JSON.stringify(['H', 'I']), 'Columns H and I must be excluded');
assert(sha256(sourceRaw) === manifest.sourceWorkbookSha256, 'Workbook hash mismatch');
assert(sha256(rowsRaw) === manifest.rowsSha256, 'JSONL hash mismatch');

const rows = rowsRaw.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
assert(rows.length === manifest.physicalRowCount, 'Physical row count mismatch');
assert(rows.length >= 1528 && rows.length <= 10000, 'Unexpected BD Geral body size');
assert(manifest.tableRange === `A6:AC${rows.length + 6}`, 'Unexpected source range');
assert(rows.every((row, index) => row.excelRow === index + 7), 'Physical rows are missing or out of order');
assert(rows.every((row) => /^[0-9a-f]{64}$/.test(row.rowSha256)), 'Invalid row digest');
assert(rows.every((row) => row.cells && Object.keys(row.cells).length === 27 && !('H' in row.cells) && !('I' in row.cells)), 'Unexpected imported columns');
const classifications = Object.fromEntries(Object.keys(manifest.classifications).map((key) => [key, 0]));
for (const row of rows) {
  assert(Object.hasOwn(classifications, row.classification), 'Unexpected row classification');
  classifications[row.classification] += 1;
}
assert(JSON.stringify(classifications) === JSON.stringify(manifest.classifications), 'Classification control mismatch');
assert(classifications.detail_candidate === manifest.detailCandidateCount, 'Detail control mismatch');
const rowHashesDigest = sha256(rows.map((row) => row.rowSha256).join('\n'));
assert(rowHashesDigest === manifest.rowHashesSha256, 'Row hash control mismatch');

if (mode === '--verify-only') {
  console.log(JSON.stringify({ result: 'verified_only', sourceWorkbookSha256: manifest.sourceWorkbookSha256, rows: rows.length, classifications }));
  process.exit(0);
}

assert(process.env.DATABASE_URL, 'DATABASE_URL is required');

const prisma = new PrismaClient();
try {
  const existing = await prisma.dudaBdGeralImport.findUnique({
    where: { sourceWorkbookSha256: manifest.sourceWorkbookSha256 },
    select: { id: true, physicalRowCount: true, manifest: true },
  });
  if (existing) {
    assert(existing.physicalRowCount === rows.length, 'Existing import row count differs');
    assert(existing.manifest?.rowsSha256 === manifest.rowsSha256, 'Existing import has different extraction');
    const actual = await prisma.dudaBdGeralRow.count({ where: { importId: existing.id } });
    assert(actual === rows.length, 'Existing import is incomplete');
    console.log(JSON.stringify({ result: 'already_present', importId: existing.id, rows: actual }));
    process.exitCode = 0;
  } else {
    const imported = await prisma.$transaction(async (transaction) => {
      const batch = await transaction.dudaBdGeralImport.create({
        data: {
          id: randomUUID(),
          sourceWorkbookSha256: manifest.sourceWorkbookSha256,
          sourceLabel: manifest.sourceLabel,
          capturedAt: new Date(manifest.capturedAt),
          physicalRowCount: manifest.physicalRowCount,
          detailCandidateCount: manifest.detailCandidateCount,
          status: 'STAGED',
          manifest,
        },
        select: { id: true },
      });
      for (let index = 0; index < rows.length; index += 100) {
        await transaction.dudaBdGeralRow.createMany({
          data: rows.slice(index, index + 100).map((row) => ({
            id: randomUUID(),
            importId: batch.id,
            excelRow: row.excelRow,
            rowSha256: row.rowSha256,
            classification: row.classification,
            hiddenByFilter: row.hiddenByFilter,
            legacyItem: row.legacyItem,
            serviceMonth: row.serviceMonth,
            engineer: row.engineer,
            contractNumber: row.contractNumber,
            clientName: row.clientName,
            municipality: row.municipality,
            workName: row.workName,
            billingMonth: row.billingMonth,
            expectedReceiptMonth: row.expectedReceiptMonth,
            receivedMonthText: row.receivedMonthText,
            cells: row.cells,
            issues: row.issues,
          })),
        });
      }
      return batch;
    }, { timeout: 120000 });
    const [actual, first, last] = await Promise.all([
      prisma.dudaBdGeralRow.count({ where: { importId: imported.id } }),
      prisma.dudaBdGeralRow.findFirst({ where: { importId: imported.id }, orderBy: { excelRow: 'asc' }, select: { excelRow: true, rowSha256: true } }),
      prisma.dudaBdGeralRow.findFirst({ where: { importId: imported.id }, orderBy: { excelRow: 'desc' }, select: { excelRow: true, rowSha256: true } }),
    ]);
    assert(actual === rows.length && first?.excelRow === 7 && last?.excelRow === rows.length + 6, 'Post-import readback failed');
    assert(first.rowSha256 === rows[0].rowSha256 && last.rowSha256 === rows.at(-1).rowSha256, 'Boundary hash readback failed');
    console.log(JSON.stringify({ result: 'staged', importId: imported.id, rows: actual, firstRow: first.excelRow, lastRow: last.excelRow }));
  }
} finally {
  await prisma.$disconnect();
}
