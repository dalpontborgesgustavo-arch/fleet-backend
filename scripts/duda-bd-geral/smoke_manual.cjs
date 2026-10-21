// Disposable CI database only. Exercise the actual service after the additive
// migrations and fictitious importer smoke test, without using JR data.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { DudaBdGeralService } = require('../../dist/src/duda-bd-geral/duda-bd-geral.service.js');
const { DUDA_BD_GERAL_COLUMNS } = require('../../dist/src/duda-bd-geral/duda-bd-geral.columns.js');

const prisma = new PrismaClient();
const service = new DudaBdGeralService(prisma);
const values = Object.fromEntries(DUDA_BD_GERAL_COLUMNS.map((key) => [key, '']));
values.A = 'CI-ITEM-001';
values.B = '2026-10';
values.L = '1234,56';

async function main() {
  const batch = await prisma.dudaBdGeralImport.findFirst({
    where: { sourceLabel: 'Fictitious CI smoke test' },
  });
  assert.ok(batch);
  const created = await service.createManualEntry(batch.id, 'ci-admin', values);
  assert.equal(created.manualState, 'new');
  const listed = await service.listRows(batch.id, {
    page: '1', q: 'CI-ITEM-001', columnFilters: JSON.stringify({ L: '1234,56' }),
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.rows[0].id, created.id);
  const changed = { ...values, L: '1400,00' };
  const edited = await service.updateRow(batch.id, created.id, 'ci-admin', changed, 1);
  assert.equal(edited.version, 2);
  assert.equal(edited.cells.L.raw, '1400,00');
  const revisions = await service.listRevisions(batch.id, created.id);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].version, 2);
  const source = await prisma.dudaBdGeralRow.findFirstOrThrow({ where: { importId: batch.id }, orderBy: { excelRow: 'asc' } });
  await prisma.dudaBdGeralRow.update({
    where: { id: source.id },
    data: {
      classification: 'detail_candidate',
      cells: { ...source.cells, A: { header: 'ITEM', raw: 'CI-SOURCE-001', formula: null, cached: null },
        B: { header: 'MÊS', raw: '2026-10', formula: null, cached: null },
        L: { header: 'PRODUÇÃO', raw: '90', formula: null, cached: null } },
    },
  });
  const sourceValues = { ...values, A: 'CI-SOURCE-001', L: '100' };
  const overlaid = await service.updateRow(batch.id, source.id, 'ci-admin', sourceValues, 0);
  assert.equal(overlaid.manualState, 'edited');
  assert.equal(overlaid.cells.L.raw, '100');
  const original = await prisma.dudaBdGeralRow.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(original.cells.L.raw, '90');
  const filteredSource = await service.listRows(batch.id, { columnFilters: JSON.stringify({ L: '100' }) });
  assert.ok(filteredSource.rows.some((row) => row.id === source.id));
  const originalCount = await prisma.dudaBdGeralRow.count({ where: { importId: batch.id } });
  assert.equal(originalCount, 1528);
  console.log('Duda manual service smoke passed: create, filter, edit, overlay, audit, source unchanged');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
