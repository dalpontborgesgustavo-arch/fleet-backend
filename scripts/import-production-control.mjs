// One-time October 2026 import. Dry-run by default; never overwrites a source row already imported.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const workbook = getArg('--workbook');
if (!workbook) throw new Error('Informe --workbook <arquivo.xlsx>.');
const apply = args.includes('--apply');
const hash = createHash('sha256').update(readFileSync(workbook)).digest('hex');
const expectedHash = getArg('--expected-sha256');
if (apply && expectedHash !== hash) throw new Error('SHA-256 do arquivo não confere. Importe apenas o arquivo revisado.');
const python = process.env.PYTHON || 'python';
const lines = JSON.parse(execFileSync(python, [join(here, 'extract-production-control.py'), workbook], {
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
}));
const key = (line) => `${line.competence}/${line.sourceSheet}/${line.sourceExcelRow}`;
if (new Set(lines.map(key)).size !== lines.length) throw new Error('Linhas de origem repetidas.');
if (lines.some((line) => line.competence !== '2026-10' || !line.workName || !line.activity || !line.unit)) {
  throw new Error('Dados fora do escopo Outubro/2026 ou linha incompleta.');
}
const summary = {
  sha256: hash,
  competence: '2026-10',
  lines: lines.length,
  engineers: [...new Set(lines.map((line) => line.engineer))],
  dailyValues: lines.reduce((sum, line) => sum + line.daily.length, 0),
  weekPlans: lines.reduce((sum, line) => sum + line.weeks.length, 0),
  missingUnitPrices: lines.filter((line) => line.unitPrice == null).length,
  missingWorkNames: lines.filter((line) => line.sourceWorkNameMissing).length,
  estimatedValue: lines.reduce((sum, line) => sum + line.daily.reduce((lineSum, day) =>
    lineSum + Number(day.quantity) * Number(line.unitPrice || 0), 0), 0).toFixed(2),
  jrSummaryReconciled: true,
  mode: apply ? 'apply' : 'dry-run',
};
console.log(JSON.stringify(summary, null, 2));
if (!apply) process.exit(0);

const prisma = new PrismaClient();
let inserted = 0;
let skipped = 0;
try {
  for (const line of lines) {
    const where = { competence_sourceSheet_sourceExcelRow: {
      competence: line.competence, sourceSheet: line.sourceSheet, sourceExcelRow: line.sourceExcelRow,
    } };
    const existing = await prisma.productionControlLine.findUnique({
      where,
      select: { id: true, revisions: { where: { action: 'IMPORT_WORKBOOK' }, take: 1, select: { after: true } } },
    });
    if (existing) {
      if (existing.revisions[0]?.after?.workbookSha256 !== hash) {
        throw new Error(`Linha ${key(line)} já veio de outra versão; importação interrompida sem sobrescrever alterações.`);
      }
      skipped++;
      continue;
    }
    await prisma.productionControlLine.create({ data: {
      competence: line.competence,
      engineer: line.engineer,
      municipality: line.municipality,
      workCode: line.workCode,
      workName: line.workName,
      activity: line.activity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      sourceSheet: line.sourceSheet,
      sourceExcelRow: line.sourceExcelRow,
      daily: { create: line.daily.map((day) => ({ productionDate: new Date(`${day.date}T00:00:00.000Z`), quantity: day.quantity })) },
      weeks: { create: line.weeks.map((week) => ({ weekIndex: week.index, weeklyPlanQuantity: week.weeklyPlanQuantity, monthPlanQuantity: week.monthPlanQuantity })) },
      revisions: { create: { action: 'IMPORT_WORKBOOK', changedByUserId: 'workbook-import', after: {
        sourceSheet: line.sourceSheet, sourceExcelRow: line.sourceExcelRow, workbookSha256: hash,
        sourceWorkNameMissing: line.sourceWorkNameMissing,
        dailyCount: line.daily.length, weekCount: line.weeks.length,
      } } },
    } });
    inserted++;
  }
  const readback = await prisma.productionControlLine.findMany({
    where: { competence: '2026-10', sourceSheet: { not: null } },
    select: { sourceSheet: true, sourceExcelRow: true, _count: { select: { daily: true, weeks: true } } },
  });
  const observedKeys = new Set(readback.map((line) => `2026-10/${line.sourceSheet}/${line.sourceExcelRow}`));
  if (lines.some((line) => !observedKeys.has(key(line)))) throw new Error('Readback incompleto: uma ou mais linhas não estão no banco.');
  console.log(JSON.stringify({ inserted, skipped, readback: {
    rows: readback.length,
    dailyValues: readback.reduce((sum, line) => sum + line._count.daily, 0),
    weekPlans: readback.reduce((sum, line) => sum + line._count.weeks, 0),
  } }));
} finally {
  await prisma.$disconnect();
}
