// End-to-end importer exercise against the disposable CI PostgreSQL service.
// The generated data is entirely fictitious; no JR workbook enters GitHub.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const dir = await mkdtemp(join(tmpdir(), 'duda-bd-geral-ci-'));
const workbook = join(dir, 'fictitious.xlsm');
const jsonl = join(dir, 'rows.jsonl');
const manifestPath = join(dir, 'manifest.json');
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .concat(['AA', 'AB', 'AC'])
  .filter((letter) => !['H', 'I'].includes(letter));
const cells = Object.fromEntries(
  letters.map((letter) => [
    letter,
    { header: letter, raw: null, formula: null, cached: null },
  ]),
);
const rowSha256 = hash(JSON.stringify(cells));
const rows = Array.from({ length: 1528 }, (_, index) => ({
  excelRow: index + 7,
  rowSha256,
  classification: 'blank',
  hiddenByFilter: index > 5,
  legacyItem: null,
  serviceMonth: null,
  engineer: null,
  contractNumber: null,
  clientName: null,
  municipality: null,
  workName: null,
  billingMonth: null,
  expectedReceiptMonth: null,
  receivedMonthText: null,
  cells,
  issues: [],
}));
const workbookBytes = Buffer.from('FICTITIOUS_CI_ONLY');
const rowsBytes = Buffer.from(
  rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
);
const manifest = {
  formatVersion: 1,
  sheet: 'BD Geral',
  tableRange: 'A6:AC1534',
  sourceWorkbookSha256: hash(workbookBytes),
  sourceLabel: 'Fictitious CI smoke test',
  capturedAt: new Date().toISOString(),
  physicalRowCount: 1528,
  detailCandidateCount: 0,
  includedColumnCount: 27,
  excludedColumns: ['H', 'I'],
  classifications: { blank: 1528, detail_candidate: 0 },
  rowsSha256: hash(rowsBytes),
  rowHashesSha256: hash(rows.map((row) => row.rowSha256).join('\n')),
};

try {
  await Promise.all([
    writeFile(workbook, workbookBytes),
    writeFile(jsonl, rowsBytes),
    writeFile(manifestPath, JSON.stringify(manifest)),
  ]);
  for (const expected of ['staged', 'already_present']) {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./import_staging.mjs', import.meta.url)),
        manifestPath,
        jsonl,
        workbook,
      ],
      { encoding: 'utf8', env: process.env },
    );
    if (run.status !== 0) throw new Error(`Importer failed: ${run.stderr}`);
    const result = JSON.parse(run.stdout.trim());
    if (result.result !== expected || result.rows !== 1528) {
      throw new Error(`Unexpected import result: ${run.stdout}`);
    }
  }
  const prisma = new PrismaClient();
  try {
    const batch = await prisma.dudaBdGeralImport.findUnique({
      where: { sourceWorkbookSha256: manifest.sourceWorkbookSha256 },
    });
    if (
      !batch ||
      (await prisma.dudaBdGeralRow.count({ where: { importId: batch.id } })) !==
        1528
    ) {
      throw new Error('Independent PostgreSQL readback failed');
    }
    console.log(
      'Duda staging import smoke test passed: 1528 rows, idempotent readback',
    );
  } finally {
    await prisma.$disconnect();
  }
} finally {
  await Promise.all([
    rm(workbook, { force: true }),
    rm(jsonl, { force: true }),
    rm(manifestPath, { force: true }),
  ]);
  await rmdir(dir);
}
