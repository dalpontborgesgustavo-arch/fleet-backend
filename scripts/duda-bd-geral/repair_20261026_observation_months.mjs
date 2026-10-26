// One-time correction of derived month metadata. Source cells and row digests stay immutable.
// No historical row is promoted to an operational observation.
import { PrismaClient } from '@prisma/client';

const SOURCE_SHA = '55d0a8447c57d326c69c76b504fefd6e7d4030903849e7629d0a49af2817297f';
const EXPECTED_MISSING = 49;
const EXPECTED_UNDATED = 3;

function monthFromSection(label) {
  const match = /M[ÊE]S\s+(1[0-2]|0?[1-9])\b(?:\s+DE\s+(20\d{2}))?/i.exec(label);
  return match?.[2] ? `${match[2]}-${String(Number(match[1])).padStart(2, '0')}` : null;
}

const mode = process.argv[2];
if (mode && mode !== '--apply') throw new Error('Use --apply only after dry-run review');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient();
try {
  const batch = await prisma.dudaBdGeralImport.findUnique({
    where: { sourceWorkbookSha256: SOURCE_SHA }, select: { id: true },
  });
  if (!batch) throw new Error('Expected workbook import not found');
  const rows = await prisma.dudaObservationSourceRow.findMany({
    where: { importId: batch.id },
    orderBy: { excelRow: 'asc' },
    select: { id: true, excelRow: true, trackingMonth: true, sectionLabel: true },
  });
  if (rows.length !== 241) throw new Error(`Unexpected source row count: ${rows.length}`);
  const corrections = [];
  let undated = 0;
  for (const row of rows) {
    const expected = monthFromSection(row.sectionLabel);
    if (row.trackingMonth && row.trackingMonth !== expected) {
      throw new Error(`Conflicting month on source row ${row.excelRow}`);
    }
    if (!expected) undated += 1;
    if (expected && !row.trackingMonth) corrections.push({ id: row.id, excelRow: row.excelRow, trackingMonth: expected });
  }
  if (undated !== EXPECTED_UNDATED) throw new Error(`Unexpected undated row count: ${undated}`);
  if (corrections.length !== EXPECTED_MISSING && corrections.length !== 0) {
    throw new Error(`Unexpected correction count: ${corrections.length}`);
  }
  if (mode === '--apply' && corrections.length) {
    if (corrections.length !== EXPECTED_MISSING) throw new Error('Partial source state; refusing repair');
    await prisma.$transaction(async (tx) => {
      for (const row of corrections) {
        const result = await tx.dudaObservationSourceRow.updateMany({
          where: { id: row.id, importId: batch.id, trackingMonth: null },
          data: { trackingMonth: row.trackingMonth },
        });
        if (result.count !== 1) throw new Error(`Concurrent change on source row ${row.excelRow}`);
      }
    }, { timeout: 120000 });
  }
  const after = await prisma.dudaObservationSourceRow.groupBy({
    by: ['trackingMonth'], where: { importId: batch.id }, _count: { _all: true },
  });
  if (mode === '--apply') {
    const actual = new Map(after.map((row) => [row.trackingMonth, row._count._all]));
    if (actual.get(null) !== 3 || actual.get('2025-10') !== 10 || actual.get('2025-11') !== 6 || actual.get('2025-12') !== 9 || actual.get('2026-10') !== 24) {
      throw new Error('Post-repair month distribution differs from source');
    }
  }
  console.log(JSON.stringify({ mode: mode || 'dry-run', corrected: corrections.length, undated, distribution: after.map((row) => ({ month: row.trackingMonth, count: row._count._all })) }));
} finally {
  await prisma.$disconnect();
}
