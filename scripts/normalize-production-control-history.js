// One-time, conservative Aethos reconciliation. Dry-run unless --apply is passed.
// Never changes quantities, targets, activity, unit or estimated price.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const normalize = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ').trim();
const unique = (values) => [...new Set(values.filter(Boolean))];
const canonicalPerson = (name, active, contract) => {
  const key = normalize(name);
  for (const candidates of [active, contract]) {
    const matches = unique(candidates).filter((item) => {
      const candidate = normalize(item);
      return candidate === key || candidate.startsWith(`${key} `);
    });
    if (matches.length === 1) return matches[0];
  }
  return name;
};
const inferredCity = (work, sourceWork) => {
  if (sourceWork?.cidade) return String(sourceWork.cidade).trim();
  const match = work.name.match(/^(.{3,45}?)\s*(?:\/SC)?\s+-\s+(?:CC|TP|PE|CE|CP)\b/i);
  return match ? match[1].trim() : null;
};

async function main() {
  const [lines, works, state, contractNames] = await Promise.all([
    prisma.productionControlLine.findMany({
      where: { competence: '2026-10' },
      select: { id: true, competence: true, workCode: true, workName: true,
        engineer: true, municipality: true, activity: true, unit: true,
        unitPrice: true,
        daily: { select: { id: true, productionDate: true, quantity: true } },
        weeks: { select: { id: true, weekIndex: true,
          weeklyPlanQuantity: true, monthPlanQuantity: true } } },
    }),
    prisma.aethosObra.findMany({ where: { active: true },
      select: { code: true, name: true } }),
    prisma.constructionControlState.findUnique({ where: { id: 'default' } }),
    prisma.aethosContract.findMany({ where: { active: true, engineerName: { not: null } },
      distinct: ['engineerName'], select: { engineerName: true } }),
  ]);
  const data = state?.data || {};
  const stateWorks = Array.isArray(data.works) ? data.works : [];
  const activeEngineers = (Array.isArray(data.engineers) ? data.engineers : [])
    .filter((item) => item?.status === 'Ativo')
    .map((item) => String(item.nome || '').trim());
  const contractEngineers = contractNames.map((item) => item.engineerName || '');
  const byCode = new Map(works.map((work) => [work.code, work]));
  const changes = [];
  const skipped = [];
  for (const line of lines) {
    const alias = normalize(line.workName);
    let work;
    if (line.workCode) {
      work = byCode.get(line.workCode);
      if (!work || !normalize(work.name).includes(alias)) {
        skipped.push({ id: line.id, name: line.workName, code: line.workCode,
          reason: 'existing code conflicts with the Aethos description' });
        continue;
      }
    } else if (alias.length >= 12 && !/^(RECUPERACAO DE VIAS|LINHA EYNG|REQUALIFICACAO ASFALTICA)$/.test(alias)) {
      const matches = works.filter((candidate) => normalize(candidate.name).includes(alias));
      if (matches.length === 1) work = matches[0];
    }
    if (!work) {
      skipped.push({ id: line.id, name: line.workName,
        reason: 'no unique Aethos match' });
      continue;
    }
    const sourceWork = stateWorks.find((item) => String(item?.codigoObra || '') === work.code);
    const city = inferredCity(work, sourceWork);
    if (line.municipality && city && normalize(line.municipality) !== normalize(city)) {
      skipped.push({ id: line.id, name: line.workName, code: work.code,
        reason: 'municipality conflicts with Aethos work' });
      continue;
    }
    const next = {
      workCode: work.code,
      workName: work.name,
      municipality: line.municipality || city,
      engineer: canonicalPerson(line.engineer, activeEngineers, contractEngineers),
    };
    const before = {
      workCode: line.workCode, workName: line.workName,
      municipality: line.municipality, engineer: line.engineer,
    };
    if (Object.keys(next).every((key) => next[key] === before[key])) continue;
    changes.push({ id: line.id, before, after: next,
      activity: line.activity, dailyCount: line.daily.length,
      weekCount: line.weeks.length });
  }
  // A work may appear under different aliases. Never collapse those into one
  // code/service pair without human reconciliation.
  const collisionKeys = new Map();
  for (const line of lines) {
    const proposed = changes.find((item) => item.id === line.id)?.after;
    const code = proposed?.workCode || line.workCode;
    if (!code) continue;
    const key = `${line.competence}|${code}|${line.activity}`;
    collisionKeys.set(key, [...(collisionKeys.get(key) || []), line.id]);
  }
  const collisions = [...collisionKeys.values()].filter((ids) => ids.length > 1).flat();
  const safe = changes.filter((item) => !collisions.includes(item.id));
  const report = { scanned: lines.length, proposed: changes.length,
    safe: safe.length, collisions: collisions.length, skipped: skipped.length,
    byWork: [...new Set(safe.map((item) => item.after.workCode))].sort(),
    skippedExamples: skipped.filter((item) => item.code).slice(0, 12) };
  console.log(JSON.stringify(report));
  if (!apply) return;
  const backupDir = process.env.PRODUCTION_NORMALIZATION_BACKUP_DIR;
  if (!backupDir || !path.isAbsolute(backupDir) || !fs.existsSync(backupDir)) {
    throw new Error('An existing absolute PRODUCTION_NORMALIZATION_BACKUP_DIR is required.');
  }
  const backup = path.join(backupDir, `production-control-${Date.now()}.json`);
  const content = JSON.stringify({ lines, changes: safe, skipped, collisions },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  fs.writeFileSync(backup, content, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ backup, sha256: crypto.createHash('sha256').update(content).digest('hex') }));
  for (const change of safe) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.productionControlLine.findUnique({ where: { id: change.id } });
      if (!current || Object.keys(change.before).some((key) => current[key] !== change.before[key])) {
        throw new Error(`Line changed during reconciliation: ${change.id}`);
      }
      await tx.productionControlLine.update({ where: { id: change.id }, data: change.after });
      await tx.productionControlRevision.create({ data: {
        lineId: change.id, action: 'NORMALIZE_AETHOS_WORK',
        before: change.before, after: change.after,
        changedByUserId: 'system:aethos-production-normalization-20261027',
      } });
    });
  }
  console.log(JSON.stringify({ applied: safe.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
