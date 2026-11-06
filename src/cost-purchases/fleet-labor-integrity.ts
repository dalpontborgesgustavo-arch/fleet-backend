import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export type FleetLaborFact = {
  companyId: string; unitId: string; queryCode: string; ruleVersion: string;
  companyCode: string; employeeNumber: string; employeeKey: string;
  competence: Date; period: number; totalGeneralRateado: Prisma.Decimal;
  cardinalityOk: boolean; contentHash: string; syncRunId: string; active: boolean;
};

export type FleetLaborBaselineRow = {
  companyCode: string; employeeNumber: string; employeeKey: string;
  competence: Date; period: number; totalGeneralLine: Prisma.Decimal | null;
  sourceRows: number; allocationRows: number | null;
  fixedAllocationValue: Prisma.Decimal | null; allocationClosed: boolean;
  officialCostEligible: boolean; pendingReason: string | null;
  contentHash: string; syncRunId: string;
  syncRun: { status: string; rejectedRows: number };
};

export function fingerprint0025Aggregate(row: FleetLaborBaselineRow) {
  return digest({ sourceRows: row.sourceRows, allocationRows: row.allocationRows,
    fixedAllocationValue: amount(row.fixedAllocationValue),
    totalGeneralLine: amount(row.totalGeneralLine),
    allocationClosed: row.allocationClosed,
    officialCostEligible: row.officialCostEligible,
    pendingReason: row.pendingReason });
}

function key(companyCode: string, employeeNumber: string, competence: Date, period: number) {
  return `${companyCode}|${employeeNumber}|${competence.toISOString().slice(0, 10)}|${period}`;
}

function amount(value: Prisma.Decimal | null) {
  try {
    if (value === null || !new Prisma.Decimal(value).isFinite()) return null;
    return new Prisma.Decimal(value).toFixed(6);
  } catch { return null; }
}

/** Rebuild the exact canonical hash used at staging, independent of stored hashes. */
export function fingerprintFleetLaborFacts(rows: FleetLaborFact[], scope: {
  companyId: string; unitId: string; queryCode: string; ruleVersion: string;
  syncRunId: string;
}) {
  const seen = new Set<string>();
  const entries = rows.map((row) => {
    const month = row.competence.toISOString().slice(0, 10);
    const value = amount(row.totalGeneralRateado);
    const rowKey = key(row.companyCode, row.employeeNumber, row.competence, row.period);
    if (row.companyId !== scope.companyId || row.unitId !== scope.unitId ||
        row.queryCode !== scope.queryCode || row.ruleVersion !== scope.ruleVersion ||
        row.syncRunId !== scope.syncRunId || !row.active || !row.cardinalityOk ||
        !row.companyCode || !row.employeeNumber ||
        row.employeeKey !== `${row.companyCode}-${row.employeeNumber}` ||
        !month.endsWith('-01') || ![20, 30, 40].includes(row.period) ||
        (row.period === 30 && row.competence.getUTCMonth() !== 10) ||
        (row.period === 40 && row.competence.getUTCMonth() !== 11) ||
        value === null || seen.has(rowKey)) {
      throw new ConflictException('Fatos da consulta dedicada divergem do contrato de origem');
    }
    seen.add(rowKey);
    const contentHash = digest({
      companyCode: row.companyCode, employeeNumber: row.employeeNumber,
      employeeKey: row.employeeKey, competence: month, period: row.period,
      totalGeneralRateado: value, formulaId: row.ruleVersion, cardinalityOk: true,
    });
    if (row.contentHash !== contentHash) {
      throw new ConflictException('Hash de fato da consulta dedicada divergiu');
    }
    return { key: rowKey, competence: month, employeeKey: row.employeeKey,
      period: row.period, value, contentHash };
  });
  entries.sort((a, b) => a.competence.localeCompare(b.competence) ||
    a.employeeKey.localeCompare(b.employeeKey) || a.period - b.period);
  return { sourceHash: digest(entries.map((item) => item.contentHash)), entries };
}

type ParityIssue = { key: string; reason: string; source0025?: string | null;
  candidate0039?: string | null };

/** Full keyset and value parity: null, duplicate and unhealthy baseline facts fail closed. */
export function compareFleetLaborParity(
  candidate: ReturnType<typeof fingerprintFleetLaborFacts>['entries'],
  baseline: FleetLaborBaselineRow[],
) {
  const issues: ParityIssue[] = [];
  let issueCount = 0;
  const add = (issue: ParityIssue) => { issueCount += 1; if (issues.length < 25) issues.push(issue); };
  const sourceByKey = new Map<string, { value: string | null; contentHash: string; syncRunId: string }>();
  for (const row of baseline) {
    const rowKey = key(row.companyCode, row.employeeNumber, row.competence, row.period);
    if (!row.companyCode || !row.employeeNumber ||
        row.employeeKey !== `${row.companyCode}-${row.employeeNumber}` ||
        !row.competence.toISOString().slice(0, 10).endsWith('-01') ||
        ![20, 30, 40].includes(row.period) ||
        (row.period === 30 && row.competence.getUTCMonth() !== 10) ||
        (row.period === 40 && row.competence.getUTCMonth() !== 11)) {
      add({ key: rowKey, reason: 'INVALID_0025_IDENTITY' });
    }
    if (sourceByKey.has(rowKey)) add({ key: rowKey, reason: 'DUPLICATE_0025_KEY' });
    const value = amount(row.totalGeneralLine);
    if (value === null) add({ key: rowKey, reason: 'NULL_0025_VALUE', source0025: null });
    if (row.syncRun.status !== 'SUCCEEDED' || row.syncRun.rejectedRows !== 0) {
      add({ key: rowKey, reason: 'UNHEALTHY_0025_ROW_RUN' });
    }
    if (row.contentHash !== fingerprint0025Aggregate(row)) {
      add({ key: rowKey, reason: '0025_HASH_MISMATCH' });
    }
    sourceByKey.set(rowKey, { value, contentHash: row.contentHash,
      syncRunId: row.syncRunId });
  }
  const candidateByKey = new Map(candidate.map((row) => [row.key, row]));
  for (const [rowKey, source] of sourceByKey) {
    const target = candidateByKey.get(rowKey);
    if (!target) add({ key: rowKey, reason: 'MISSING_IN_0039', source0025: source.value });
    else if (source.value !== null && source.value !== target.value) {
      add({ key: rowKey, reason: 'VALUE_MISMATCH', source0025: source.value,
        candidate0039: target.value });
    }
  }
  for (const row of candidate) {
    if (!sourceByKey.has(row.key)) add({ key: row.key, reason: 'MISSING_IN_0025',
      candidate0039: row.value });
  }
  const baselineCanonical = [...sourceByKey].sort(([a], [b]) => a.localeCompare(b))
    .map(([rowKey, row]) => ({ key: rowKey, ...row }));
  return { matching: issueCount === 0 && baseline.length > 0 && candidate.length > 0,
    issueCount, issues, baselineRows: baseline.length, candidateRows: candidate.length,
    baselineHash: digest(baselineCanonical),
    candidateHash: digest(candidate.map((row) => row.contentHash)),
    baselineTotal: baselineCanonical.reduce((sum, row) => sum.plus(row.value || 0),
      new Prisma.Decimal(0)).toFixed(6),
    candidateTotal: candidate.reduce((sum, row) => sum.plus(row.value),
      new Prisma.Decimal(0)).toFixed(6) };
}

export async function verifyApprovedFleetLaborIntegrity(
  db: Prisma.TransactionClient | PrismaService,
  approval: {
    id: string; competence: Date; rowCount: number; totalCost: Prisma.Decimal;
    sourceHash: string; baselineHash: string; candidateHash: string;
    baselineSyncRunId: string; syncRunId: string;
    syncRun: { status: string; sourceHash: string | null;
      queryCode: string; ruleVersion: string };
    reversal?: { id: string } | null;
  },
  scope: { companyId: string; unitId: string; queryCode: string; ruleVersion: string },
) {
  if (approval.reversal || approval.syncRun.status !== 'STAGED' ||
      approval.syncRun.sourceHash !== approval.sourceHash ||
      approval.syncRun.queryCode !== scope.queryCode ||
      approval.syncRun.ruleVersion !== scope.ruleVersion) return false;
  const [rows, baseline, sourceRun] = await Promise.all([
    db.totvsFleetLaborCost.findMany({ where: { approvalId: approval.id } }),
    db.totvsEmployeeCostAggregate.findMany({
      where: { companyId: scope.companyId, unitId: scope.unitId,
        source: 'TOTVS_RM', queryCode: 'IND.BI.0025', competence: approval.competence,
        isCurrent: true, active: true },
      select: { companyCode: true, employeeNumber: true, employeeKey: true,
        competence: true, period: true, totalGeneralLine: true, contentHash: true,
        sourceRows: true, allocationRows: true, fixedAllocationValue: true,
        allocationClosed: true, officialCostEligible: true, pendingReason: true,
        syncRunId: true, syncRun: { select: { status: true, rejectedRows: true } } },
    }),
    db.totvsEmployeeSyncRun.findUnique({ where: { id: approval.baselineSyncRunId },
      select: { status: true, rejectedRows: true } }),
  ]);
  if (rows.length !== approval.rowCount ||
      !rows.every((row) => row.isCurrent && row.active &&
        row.competence.getTime() === approval.competence.getTime())) return false;
  if (sourceRun?.status !== 'SUCCEEDED' || sourceRun.rejectedRows !== 0) return false;
  try {
    const fingerprint = fingerprintFleetLaborFacts(rows, { ...scope,
      syncRunId: approval.syncRunId });
    const parity = compareFleetLaborParity(fingerprint.entries, baseline);
    return parity.matching && fingerprint.sourceHash === approval.candidateHash &&
      parity.candidateHash === approval.candidateHash &&
      parity.baselineHash === approval.baselineHash &&
      new Prisma.Decimal(parity.candidateTotal).equals(approval.totalCost);
  } catch { return false; }
}
