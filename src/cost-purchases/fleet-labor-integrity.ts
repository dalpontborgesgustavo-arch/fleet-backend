import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export type FleetLaborFact = {
  companyId: string;
  unitId: string;
  queryCode: string;
  ruleVersion: string;
  companyCode: string;
  employeeNumber: string;
  employeeKey: string;
  competence: Date;
  period: number;
  totalGeneralRateado: Prisma.Decimal;
  cardinalityOk: boolean;
  contentHash: string;
  syncRunId: string;
  active: boolean;
};

export type FleetLaborBaselineRow = {
  id?: string;
  companyCode: string;
  employeeNumber: string;
  employeeKey: string;
  competence: Date;
  period: number;
  totalGeneralLine: Prisma.Decimal | null;
  sourceRows: number;
  allocationRows: number | null;
  fixedAllocationValue: Prisma.Decimal | null;
  allocationClosed: boolean;
  officialCostEligible: boolean;
  pendingReason: string | null;
  contentHash: string;
  syncRunId: string;
  syncRun: { status: string; rejectedRows: number };
};

export function fingerprint0025Aggregate(row: FleetLaborBaselineRow) {
  return digest({
    sourceRows: row.sourceRows,
    allocationRows: row.allocationRows,
    fixedAllocationValue: amount(row.fixedAllocationValue),
    totalGeneralLine: amount(row.totalGeneralLine),
    allocationClosed: row.allocationClosed,
    officialCostEligible: row.officialCostEligible,
    pendingReason: row.pendingReason,
  });
}

function key(
  companyCode: string,
  employeeNumber: string,
  competence: Date,
  period: number,
) {
  return `${companyCode}|${employeeNumber}|${competence.toISOString().slice(0, 10)}|${period}`;
}

function amount(value: Prisma.Decimal | null) {
  try {
    if (value === null || !new Prisma.Decimal(value).isFinite()) return null;
    return new Prisma.Decimal(value).toFixed(6);
  } catch {
    return null;
  }
}

export function fingerprint0025Manifest(
  rows: Array<{
    id: string;
    companyCode: string;
    employeeNumber: string;
    employeeKey: string;
    competence: Date;
    period: number;
    contentHash: string;
    syncRunId: string;
  }>,
) {
  const seen = new Set<string>();
  const entries = rows
    .map((row) => {
      const rowKey = key(
        row.companyCode,
        row.employeeNumber,
        row.competence,
        row.period,
      );
      if (!row.id || !row.contentHash || !row.syncRunId || seen.has(rowKey)) {
        throw new ConflictException(
          'Manifesto 0025 contem agregado invalido ou duplicado',
        );
      }
      seen.add(rowKey);
      return {
        key: rowKey,
        aggregateId: row.id,
        contentHash: row.contentHash,
        syncRunId: row.syncRunId,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  return { rowCount: entries.length, contentHash: digest(entries), entries };
}

function valid0025CostRow(row: FleetLaborBaselineRow, competence: Date) {
  const month = row.competence.toISOString().slice(0, 10);
  return (
    row.competence.getTime() === competence.getTime() &&
    Boolean(row.companyCode && row.employeeNumber) &&
    row.employeeKey === `${row.companyCode}-${row.employeeNumber}` &&
    month.endsWith('-01') &&
    [20, 30, 40].includes(row.period) &&
    (row.period !== 30 || row.competence.getUTCMonth() === 10) &&
    (row.period !== 40 || row.competence.getUTCMonth() === 11) &&
    row.sourceRows >= 1 &&
    row.syncRun.status === 'SUCCEEDED' &&
    row.syncRun.rejectedRows === 0 &&
    row.contentHash === fingerprint0025Aggregate(row)
  );
}

/**
 * JR designates the current IND.BI.0025 rateio as the canonical fleet labor
 * cost. Verify the latest monthly capture against every current aggregate
 * before letting Resultados Frota consume any of its rows. The legacy
 * `officialCostEligible` flag belongs to a different reconciliation workflow.
 */
export async function verifiedCurrentFleetLabor0025(
  db: PrismaService,
  competence: Date,
  scope: { companyId: string; unitId: string },
  now = new Date(),
) {
  const [latestRun, currentRows, manifest] = await Promise.all([
    db.totvsEmployeeSyncRun.findFirst({
      where: {
        companyId: scope.companyId,
        unitId: scope.unitId,
        queryCode: 'IND.BI.0025',
        contextCode: '0/P',
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        contextCode: true,
        rejectedRows: true,
        finishedAt: true,
      },
    }),
    db.totvsEmployeeCostAggregate.findMany({
      where: {
        companyId: scope.companyId,
        unitId: scope.unitId,
        source: 'TOTVS_RM',
        queryCode: 'IND.BI.0025',
        competence,
        isCurrent: true,
        active: true,
      },
      select: {
        id: true,
        companyCode: true,
        employeeNumber: true,
        employeeKey: true,
        competence: true,
        period: true,
        totalGeneralLine: true,
        contentHash: true,
        sourceRows: true,
        allocationRows: true,
        fixedAllocationValue: true,
        allocationClosed: true,
        officialCostEligible: true,
        pendingReason: true,
        syncRunId: true,
        syncRun: { select: { status: true, rejectedRows: true } },
      },
    }),
    db.totvsEmployeeCostRunManifest.findFirst({
      where: {
        competence,
        syncRun: {
          is: {
            companyId: scope.companyId,
            unitId: scope.unitId,
            queryCode: 'IND.BI.0025',
            contextCode: '0/P',
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        syncRunId: true,
        rowCount: true,
        contentHash: true,
        syncRun: {
          select: {
            status: true,
            contextCode: true,
            rejectedRows: true,
            finishedAt: true,
          },
        },
        memberships: {
          select: {
            aggregate: {
              select: {
                id: true,
                companyCode: true,
                employeeNumber: true,
                employeeKey: true,
                competence: true,
                period: true,
                totalGeneralLine: true,
                contentHash: true,
                sourceRows: true,
                allocationRows: true,
                fixedAllocationValue: true,
                allocationClosed: true,
                officialCostEligible: true,
                pendingReason: true,
                syncRunId: true,
                isCurrent: true,
                active: true,
                syncRun: { select: { status: true, rejectedRows: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  const unavailable = {
    ready: false as const,
    historicalProvisional: false,
    rows: [] as typeof currentRows,
  };
  const firstOfCurrentMonth = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
  );
  const recentCutoff = new Date(firstOfCurrentMonth);
  recentCutoff.setUTCMonth(recentCutoff.getUTCMonth() - 2);
  const isRecent = competence >= recentCutoff;
  if (competence.getTime() >= firstOfCurrentMonth) return unavailable;
  // Before manifests existed, older months were already displayed as
  // provisional 0025 figures. Preserve that historical report, but never
  // elevate it to official or use this fallback for recent/open months.
  if (!manifest && !isRecent && currentRows.length) {
    try {
      fingerprint0025Manifest(currentRows);
      if (currentRows.every((row) => valid0025CostRow(row, competence))) {
        return {
          ready: false as const,
          historicalProvisional: true,
          rows: currentRows,
        };
      }
    } catch {
      // Invalid or duplicated historical data must remain unavailable.
    }
  }
  if (
    !manifest ||
    manifest.syncRun.status !== 'SUCCEEDED' ||
    manifest.syncRun.contextCode !== '0/P' ||
    manifest.syncRun.rejectedRows !== 0 ||
    !manifest.syncRun.finishedAt ||
    !currentRows.length
  )
    return unavailable;

  // Recent closed competences must be refreshed by the daily 0025 job. Older
  // closed months remain valid only while the manifest still matches current
  // rows; they are not expected in each new two-month source capture.
  if (
    isRecent &&
    (!latestRun ||
      manifest.syncRunId !== latestRun.id ||
      now.getTime() - manifest.syncRun.finishedAt.getTime() >
        36 * 60 * 60_000 ||
      manifest.syncRun.finishedAt.getTime() - now.getTime() > 5 * 60_000)
  )
    return unavailable;
  if (manifest.rowCount !== currentRows.length) return unavailable;
  const observed = manifest.memberships.map((item) => item.aggregate);
  if (observed.length !== currentRows.length) return unavailable;
  try {
    const fingerprint = fingerprint0025Manifest(observed);
    if (fingerprint.contentHash !== manifest.contentHash) return unavailable;
  } catch {
    return unavailable;
  }
  const currentIds = currentRows.map((row) => row.id).sort();
  const observedIds = observed.map((row) => row.id).sort();
  if (observedIds.some((id, index) => id !== currentIds[index]))
    return unavailable;
  for (const row of observed) {
    if (!row.isCurrent || !row.active || !valid0025CostRow(row, competence))
      return unavailable;
  }
  return {
    ready: true as const,
    historicalProvisional: false,
    rows: currentRows,
  };
}

/** Rebuild the exact canonical hash used at staging, independent of stored hashes. */
export function fingerprintFleetLaborFacts(
  rows: FleetLaborFact[],
  scope: {
    companyId: string;
    unitId: string;
    queryCode: string;
    ruleVersion: string;
    syncRunId: string;
  },
) {
  const seen = new Set<string>();
  const entries = rows.map((row) => {
    const month = row.competence.toISOString().slice(0, 10);
    const value = amount(row.totalGeneralRateado);
    const rowKey = key(
      row.companyCode,
      row.employeeNumber,
      row.competence,
      row.period,
    );
    if (
      row.companyId !== scope.companyId ||
      row.unitId !== scope.unitId ||
      row.queryCode !== scope.queryCode ||
      row.ruleVersion !== scope.ruleVersion ||
      row.syncRunId !== scope.syncRunId ||
      !row.active ||
      !row.cardinalityOk ||
      !row.companyCode ||
      !row.employeeNumber ||
      row.employeeKey !== `${row.companyCode}-${row.employeeNumber}` ||
      !month.endsWith('-01') ||
      ![20, 30, 40].includes(row.period) ||
      (row.period === 30 && row.competence.getUTCMonth() !== 10) ||
      (row.period === 40 && row.competence.getUTCMonth() !== 11) ||
      value === null ||
      seen.has(rowKey)
    ) {
      throw new ConflictException(
        'Fatos da consulta dedicada divergem do contrato de origem',
      );
    }
    seen.add(rowKey);
    const contentHash = digest({
      companyCode: row.companyCode,
      employeeNumber: row.employeeNumber,
      employeeKey: row.employeeKey,
      competence: month,
      period: row.period,
      totalGeneralRateado: value,
      formulaId: row.ruleVersion,
      cardinalityOk: true,
    });
    if (row.contentHash !== contentHash) {
      throw new ConflictException('Hash de fato da consulta dedicada divergiu');
    }
    return {
      key: rowKey,
      competence: month,
      employeeKey: row.employeeKey,
      period: row.period,
      value,
      contentHash,
    };
  });
  entries.sort(
    (a, b) =>
      a.competence.localeCompare(b.competence) ||
      a.employeeKey.localeCompare(b.employeeKey) ||
      a.period - b.period,
  );
  return {
    sourceHash: digest(entries.map((item) => item.contentHash)),
    entries,
  };
}

type ParityIssue = {
  key: string;
  reason: string;
  source0025?: string | null;
  candidate0039?: string | null;
};

/** Full keyset and value parity: null, duplicate and unhealthy baseline facts fail closed. */
export function compareFleetLaborParity(
  candidate: ReturnType<typeof fingerprintFleetLaborFacts>['entries'],
  baseline: FleetLaborBaselineRow[],
) {
  const issues: ParityIssue[] = [];
  let issueCount = 0;
  const add = (issue: ParityIssue) => {
    issueCount += 1;
    if (issues.length < 25) issues.push(issue);
  };
  const sourceByKey = new Map<
    string,
    { value: string | null; contentHash: string; syncRunId: string }
  >();
  for (const row of baseline) {
    const rowKey = key(
      row.companyCode,
      row.employeeNumber,
      row.competence,
      row.period,
    );
    if (
      !row.companyCode ||
      !row.employeeNumber ||
      row.employeeKey !== `${row.companyCode}-${row.employeeNumber}` ||
      !row.competence.toISOString().slice(0, 10).endsWith('-01') ||
      ![20, 30, 40].includes(row.period) ||
      (row.period === 30 && row.competence.getUTCMonth() !== 10) ||
      (row.period === 40 && row.competence.getUTCMonth() !== 11)
    ) {
      add({ key: rowKey, reason: 'INVALID_0025_IDENTITY' });
    }
    if (sourceByKey.has(rowKey))
      add({ key: rowKey, reason: 'DUPLICATE_0025_KEY' });
    const value = amount(row.totalGeneralLine);
    if (value === null)
      add({ key: rowKey, reason: 'NULL_0025_VALUE', source0025: null });
    if (row.syncRun.status !== 'SUCCEEDED' || row.syncRun.rejectedRows !== 0) {
      add({ key: rowKey, reason: 'UNHEALTHY_0025_ROW_RUN' });
    }
    if (row.contentHash !== fingerprint0025Aggregate(row)) {
      add({ key: rowKey, reason: '0025_HASH_MISMATCH' });
    }
    sourceByKey.set(rowKey, {
      value,
      contentHash: row.contentHash,
      syncRunId: row.syncRunId,
    });
  }
  const candidateByKey = new Map(candidate.map((row) => [row.key, row]));
  for (const [rowKey, source] of sourceByKey) {
    const target = candidateByKey.get(rowKey);
    if (!target)
      add({ key: rowKey, reason: 'MISSING_IN_0039', source0025: source.value });
    else if (source.value !== null && source.value !== target.value) {
      add({
        key: rowKey,
        reason: 'VALUE_MISMATCH',
        source0025: source.value,
        candidate0039: target.value,
      });
    }
  }
  for (const row of candidate) {
    if (!sourceByKey.has(row.key))
      add({
        key: row.key,
        reason: 'MISSING_IN_0025',
        candidate0039: row.value,
      });
  }
  const baselineCanonical = [...sourceByKey]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rowKey, row]) => ({ key: rowKey, ...row }));
  return {
    matching: issueCount === 0 && baseline.length > 0 && candidate.length > 0,
    issueCount,
    issues,
    baselineRows: baseline.length,
    candidateRows: candidate.length,
    baselineHash: digest(baselineCanonical),
    candidateHash: digest(candidate.map((row) => row.contentHash)),
    baselineTotal: baselineCanonical
      .reduce((sum, row) => sum.plus(row.value || 0), new Prisma.Decimal(0))
      .toFixed(6),
    candidateTotal: candidate
      .reduce((sum, row) => sum.plus(row.value), new Prisma.Decimal(0))
      .toFixed(6),
  };
}

export async function verifyApprovedFleetLaborIntegrity(
  db: Prisma.TransactionClient | PrismaService,
  approval: {
    id: string;
    competence: Date;
    rowCount: number;
    totalCost: Prisma.Decimal;
    sourceHash: string;
    baselineHash: string;
    candidateHash: string;
    baselineSyncRunId: string;
    syncRunId: string;
    parityVerifiedAt: Date;
    syncRun: {
      status: string;
      sourceHash: string | null;
      queryCode: string;
      ruleVersion: string;
      companyId: string;
      unitId: string;
      finishedAt: Date | null;
    };
    reversal?: { id: string } | null;
  },
  scope: {
    companyId: string;
    unitId: string;
    queryCode: string;
    ruleVersion: string;
  },
) {
  if (
    approval.reversal ||
    approval.syncRun.status !== 'STAGED' ||
    approval.syncRun.sourceHash !== approval.sourceHash ||
    approval.syncRun.companyId !== scope.companyId ||
    approval.syncRun.unitId !== scope.unitId ||
    approval.syncRun.queryCode !== scope.queryCode ||
    approval.syncRun.ruleVersion !== scope.ruleVersion
  )
    return false;
  const [rows, manifest, currentBaseline, sourceRun] = await Promise.all([
    db.totvsFleetLaborCost.findMany({ where: { approvalId: approval.id } }),
    db.totvsEmployeeCostRunManifest.findUnique({
      where: {
        syncRunId_competence: {
          syncRunId: approval.baselineSyncRunId,
          competence: approval.competence,
        },
      },
      select: {
        rowCount: true,
        contentHash: true,
        memberships: {
          select: {
            aggregate: {
              select: {
                id: true,
                companyCode: true,
                employeeNumber: true,
                employeeKey: true,
                competence: true,
                period: true,
                totalGeneralLine: true,
                contentHash: true,
                sourceRows: true,
                allocationRows: true,
                fixedAllocationValue: true,
                allocationClosed: true,
                officialCostEligible: true,
                pendingReason: true,
                syncRunId: true,
                isCurrent: true,
                active: true,
                syncRun: { select: { status: true, rejectedRows: true } },
              },
            },
          },
        },
      },
    }),
    db.totvsEmployeeCostAggregate.findMany({
      where: {
        companyId: scope.companyId,
        unitId: scope.unitId,
        source: 'TOTVS_RM',
        queryCode: 'IND.BI.0025',
        competence: approval.competence,
        isCurrent: true,
        active: true,
      },
      select: {
        id: true,
        companyCode: true,
        employeeNumber: true,
        employeeKey: true,
        competence: true,
        period: true,
        totalGeneralLine: true,
        contentHash: true,
        sourceRows: true,
        allocationRows: true,
        fixedAllocationValue: true,
        allocationClosed: true,
        officialCostEligible: true,
        pendingReason: true,
        syncRunId: true,
        syncRun: { select: { status: true, rejectedRows: true } },
      },
    }),
    db.totvsEmployeeSyncRun.findUnique({
      where: { id: approval.baselineSyncRunId },
      select: {
        companyId: true,
        unitId: true,
        queryCode: true,
        contextCode: true,
        status: true,
        rejectedRows: true,
        finishedAt: true,
      },
    }),
  ]);
  const baseline =
    manifest?.memberships.map((membership) => membership.aggregate) || [];
  if (
    rows.length !== approval.rowCount ||
    !rows.every(
      (row) =>
        row.isCurrent &&
        row.active &&
        row.competence.getTime() === approval.competence.getTime(),
    )
  )
    return false;
  if (
    !sourceRun ||
    sourceRun.companyId !== scope.companyId ||
    sourceRun.unitId !== scope.unitId ||
    sourceRun.queryCode !== 'IND.BI.0025' ||
    sourceRun.contextCode !== '0/P' ||
    sourceRun.status !== 'SUCCEEDED' ||
    sourceRun.rejectedRows !== 0 ||
    !manifest ||
    manifest.rowCount !== baseline.length ||
    !sourceRun.finishedAt ||
    !approval.syncRun.finishedAt
  )
    return false;
  let manifestFingerprint: ReturnType<typeof fingerprint0025Manifest>;
  try {
    manifestFingerprint = fingerprint0025Manifest(baseline);
  } catch {
    return false;
  }
  if (manifestFingerprint.contentHash !== manifest.contentHash) return false;
  const observedIds = baseline.map((row) => row.id).sort();
  const currentIds = currentBaseline.map((row) => row.id).sort();
  if (
    observedIds.length !== currentIds.length ||
    observedIds.some((id, index) => id !== currentIds[index]) ||
    baseline.some((row) => !row.isCurrent || !row.active)
  )
    return false;
  const parityAt = approval.parityVerifiedAt.getTime();
  const dedicatedAt = approval.syncRun.finishedAt.getTime();
  const baselineAt = sourceRun.finishedAt.getTime();
  const maxAge = 36 * 60 * 60_000;
  const futureSkew = 5 * 60_000;
  if (
    parityAt < dedicatedAt - futureSkew ||
    parityAt - dedicatedAt > maxAge ||
    parityAt < baselineAt - futureSkew ||
    parityAt - baselineAt > maxAge ||
    Math.abs(dedicatedAt - baselineAt) > maxAge
  )
    return false;
  try {
    const fingerprint = fingerprintFleetLaborFacts(rows, {
      ...scope,
      syncRunId: approval.syncRunId,
    });
    const parity = compareFleetLaborParity(fingerprint.entries, baseline);
    return (
      parity.matching &&
      fingerprint.sourceHash === approval.candidateHash &&
      parity.candidateHash === approval.candidateHash &&
      parity.baselineHash === approval.baselineHash &&
      new Prisma.Decimal(parity.candidateTotal).equals(approval.totalCost)
    );
  } catch {
    return false;
  }
}
