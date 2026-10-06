import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';
import { expireStaleUsinaSyncRuns } from './usina-sync-run-policy';
import {
  normalizeUsinaFleetMaintenanceLaborAllocationEnvelope,
  normalizeUsinaFleetMaintenanceLaborAllocationRows,
  NormalizedFleetMaintenanceLaborAllocationRow,
  USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET,
} from './usina-fleet-maintenance-labor-allocation-sync.rules';
import { TotvsFleetMaintenanceReferenceService } from './totvs-fleet-maintenance-reference.service';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function allocationData(
  row: NormalizedFleetMaintenanceLaborAllocationRow,
  runId: string,
  now: Date,
) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    sourceRecordId: row.sourceRecordId,
    competence: row.competence,
    aethosVehicleId: row.aethosVehicleId,
    fleetNumber: row.fleetNumber,
    targetCostClass: row.targetCostClass,
    vehicleExpenseAmount: row.vehicleExpenseAmount,
    rateGroup: row.rateGroup,
    groupShare: row.groupShare,
    groupExpenseBase: row.groupExpenseBase,
    eligibleLaborPoolAmount: row.eligibleLaborPoolAmount,
    allocatedLaborAmount: row.allocatedLaborAmount,
    expectedLineAmount: row.expectedLineAmount,
    sourceSentence: row.sourceSentence,
    sourceGeneratedAt: row.sourceGeneratedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    contentHash: row.contentHash,
    raw: row.raw,
    active: row.active,
    deactivatedAt: row.active ? null : now,
    deactivationReason: row.active ? null : 'SOURCE_INACTIVE',
    lastSeenRunId: runId,
    syncedAt: now,
  };
}

@Injectable()
export class UsinaFleetMaintenanceLaborAllocationSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceService: TotvsFleetMaintenanceReferenceService,
  ) {}

  private async monthlyConfigurationContract(
    envelope: ReturnType<
      typeof normalizeUsinaFleetMaintenanceLaborAllocationEnvelope
    >,
  ) {
    const dateFrom = envelope.scope.dateFrom.toISOString().slice(0, 10);
    const dateTo = envelope.scope.dateTo.toISOString().slice(0, 10);
    const contract = await this.referenceService.monthlyConfigurationContract(
      dateFrom,
      dateTo,
    );
    if (
      contract.monthlyConfigurationsHash !==
      envelope.scope.monthlyConfigurationsHash
    ) {
      throw new BadRequestException(
        'Configuracao mensal vigente mudou; obtenha uma nova referencia antes da carga',
      );
    }
    const missing = contract.monthlyConfigurations.filter(
      (entry) => entry.coverage !== 'CONFIRMED',
    );
    if (missing.length) {
      throw new BadRequestException(
        `Configuracao mensal confirmada ausente: ${missing
          .map((entry) => entry.competence)
          .join(', ')}`,
      );
    }
    const expectedIds = [
      ...new Set(
        contract.monthlyConfigurations.flatMap((entry) =>
          entry.targets.map((target) => target.aethosVehicleId),
        ),
      ),
    ].sort((left, right) => left - right);
    const receivedIds = [...envelope.scope.aethosVehicleIds].sort(
      (left, right) => left - right,
    );
    if (JSON.stringify(expectedIds) !== JSON.stringify(receivedIds)) {
      throw new BadRequestException(
        'scope.aethosVehicleIds deve corresponder exatamente as configuracoes mensais vigentes',
      );
    }
    return contract;
  }

  private assertRowsMatchMonthlyConfiguration(
    rows: NormalizedFleetMaintenanceLaborAllocationRow[],
    contract: Awaited<
      ReturnType<
        TotvsFleetMaintenanceReferenceService['monthlyConfigurationContract']
      >
    >,
  ) {
    const targets = new Map<string, string>();
    for (const config of contract.monthlyConfigurations) {
      for (const target of config.targets) {
        targets.set(
          `${config.competence}|${target.aethosVehicleId}`,
          `${target.fleetNumber}|${target.targetCostClass}`,
        );
      }
    }
    for (const row of rows) {
      const competence = row.competence.toISOString().slice(0, 10);
      const expected = targets.get(`${competence}|${row.aethosVehicleId}`);
      const actual = `${row.fleetNumber}|${row.targetCostClass}`;
      if (!expected || expected !== actual) {
        throw new BadRequestException(
          `Veiculo ${row.aethosVehicleId} nao corresponde a configuracao mensal de ${competence}`,
        );
      }
    }
  }

  private async assertFullRunCoverage(
    tx: Prisma.TransactionClient,
    runId: string,
    contract: Awaited<
      ReturnType<
        TotvsFleetMaintenanceReferenceService['monthlyConfigurationContract']
      >
    >,
  ) {
    const expected = contract.monthlyConfigurations
      .flatMap((config) =>
        config.targets.map(
          (target) =>
            `${config.competence}|${target.aethosVehicleId}|${target.fleetNumber}|${target.targetCostClass}`,
        ),
      )
      .sort();
    const seen = await tx.usinaFleetMaintenanceLaborAllocation.findMany({
      where: {
        companyId: USINA_COMPANY_ID,
        unitId: USINA_UNIT_ID,
        source: 'AETHOS',
        lastSeenRunId: runId,
        active: true,
      },
      select: {
        competence: true,
        aethosVehicleId: true,
        fleetNumber: true,
        targetCostClass: true,
      },
    });
    const actual = seen
      .map(
        (row) =>
          `${row.competence.toISOString().slice(0, 10)}|${row.aethosVehicleId}|${row.fleetNumber}|${row.targetCostClass}`,
      )
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new BadRequestException(
        'Carga full nao cobre exatamente todos os destinos das configuracoes mensais vigentes',
      );
    }
  }

  private assertRunContract(
    run: any,
    envelope: ReturnType<
      typeof normalizeUsinaFleetMaintenanceLaborAllocationEnvelope
    >,
  ) {
    const expectedHash = hashCanonicalValue({
      aethosVehicleIds: envelope.scope.aethosVehicleIds,
      monthlyConfigurationsHash: envelope.scope.monthlyConfigurationsHash,
      sourceSentence: 'IND.BI.0035',
    });
    const metadata = run.scopeMetadata as { hash?: string } | null;
    const same =
      run.syncMode === envelope.syncMode &&
      run.generatedAt.toISOString() === envelope.generatedAt.toISOString() &&
      run.scopeCompanyId === USINA_COMPANY_ID &&
      run.scopeUnitId === USINA_UNIT_ID &&
      run.scopeDateFrom.toISOString().slice(0, 10) ===
        envelope.scope.dateFrom.toISOString().slice(0, 10) &&
      run.scopeDateTo.toISOString().slice(0, 10) ===
        envelope.scope.dateTo.toISOString().slice(0, 10) &&
      metadata?.hash === expectedHash;
    if (!same)
      throw new BadRequestException(
        'syncRunId ja utilizado com outro contrato ou scope',
      );
  }

  private async reconciliation(tx: Prisma.TransactionClient, envelope: any) {
    const grouped = await tx.usinaFleetMaintenanceLaborAllocation.groupBy({
      by: ['competence', 'targetCostClass'],
      where: {
        companyId: USINA_COMPANY_ID,
        unitId: USINA_UNIT_ID,
        source: 'AETHOS',
        competence: {
          gte: envelope.scope.dateFrom,
          lte: envelope.scope.dateTo,
        },
        active: true,
      },
      _count: { _all: true },
      _sum: {
        vehicleExpenseAmount: true,
        allocatedLaborAmount: true,
        expectedLineAmount: true,
      },
      orderBy: [{ competence: 'asc' }, { targetCostClass: 'asc' }],
    });
    return grouped.map((entry) => ({
      competence: entry.competence.toISOString().slice(0, 10),
      targetCostClass: entry.targetCostClass,
      vehicles: entry._count._all,
      vehicleExpenseAmount:
        entry._sum.vehicleExpenseAmount?.toFixed(12) ?? '0.000000000000',
      allocatedLaborAmount:
        entry._sum.allocatedLaborAmount?.toFixed(12) ?? '0.000000000000',
      expectedLineAmount:
        entry._sum.expectedLineAmount?.toFixed(12) ?? '0.000000000000',
    }));
  }

  async sync(body: unknown) {
    const envelope =
      normalizeUsinaFleetMaintenanceLaborAllocationEnvelope(body);
    const monthlyConfigurationContract =
      await this.monthlyConfigurationContract(envelope);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [
      USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET,
    ]);
    return this.prisma.$transaction(
      async (tx) => {
        let run = await tx.usinaSyncRun.findUnique({
          where: {
            dataset_syncRunId: {
              dataset: envelope.dataset,
              syncRunId: envelope.syncRunId,
            },
          },
        });
        if (run) {
          this.assertRunContract(run, envelope);
          const replay = await tx.usinaSyncBatch.findUnique({
            where: {
              runId_batchNumber: {
                runId: run.id,
                batchNumber: envelope.batchNumber,
              },
            },
          });
          if (replay) {
            if (replay.payloadHash !== payloadHash)
              throw new BadRequestException(
                'batchNumber ja processado com outro payload',
              );
            return {
              ...(replay.response as Record<string, unknown>),
              replayed: true,
            };
          }
          if (run.status !== 'IN_PROGRESS')
            throw new BadRequestException(
              `syncRunId ${run.status.toLowerCase()}`,
            );
          if (envelope.batchNumber !== (run.lastBatchNumber || 0) + 1)
            throw new BadRequestException(
              `Proximo batchNumber esperado: ${(run.lastBatchNumber || 0) + 1}`,
            );
        } else {
          if (envelope.batchNumber !== 1)
            throw new BadRequestException(
              'O primeiro lote deve usar batchNumber 1',
            );
          run = await tx.usinaSyncRun.create({
            data: {
              dataset: envelope.dataset,
              syncRunId: envelope.syncRunId,
              syncMode: envelope.syncMode,
              generatedAt: envelope.generatedAt,
              scopeCompanyId: USINA_COMPANY_ID,
              scopeUnitId: USINA_UNIT_ID,
              scopeDateFrom: envelope.scope.dateFrom,
              scopeDateTo: envelope.scope.dateTo,
              scopeMetadata: {
                aethosVehicleIds: envelope.scope.aethosVehicleIds,
                monthlyConfigurationsHash:
                  envelope.scope.monthlyConfigurationsHash,
                sourceSentence: 'IND.BI.0035',
                hash: hashCanonicalValue({
                  aethosVehicleIds: envelope.scope.aethosVehicleIds,
                  monthlyConfigurationsHash:
                    envelope.scope.monthlyConfigurationsHash,
                  sourceSentence: 'IND.BI.0035',
                }),
              },
            },
          });
        }

        const now = new Date();
        const normalized = normalizeUsinaFleetMaintenanceLaborAllocationRows(
          envelope.rows,
          envelope,
        );
        if (normalized.rejected.length) {
          const failureReason = `${normalized.rejected.length} linha(s) rejeitada(s) no lote ${envelope.batchNumber}`;
          const response = {
            ok: false,
            dataset: envelope.dataset,
            syncRunId: envelope.syncRunId,
            batchNumber: envelope.batchNumber,
            received: envelope.rows.length,
            accepted: normalized.accepted.length,
            applied: 0,
            upserted: 0,
            unchanged: 0,
            rejected: normalized.rejected.length,
            deactivated: 0,
            rejectedRows: normalized.rejected,
            finalized: false,
            failed: true,
            runStatus: 'FAILED',
            failureReason,
            reconciliation: [],
            replayed: false,
          };
          await tx.usinaSyncBatch.create({
            data: {
              runId: run.id,
              batchNumber: envelope.batchNumber,
              payloadHash,
              receivedCount: envelope.rows.length,
              acceptedCount: normalized.accepted.length,
              upsertedCount: 0,
              unchangedCount: 0,
              rejectedCount: normalized.rejected.length,
              deactivatedCount: 0,
              response: response as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.usinaSyncRun.update({
            where: { id: run.id },
            data: {
              status: 'FAILED',
              receivedCount: { increment: envelope.rows.length },
              acceptedCount: { increment: normalized.accepted.length },
              rejectedCount: { increment: normalized.rejected.length },
              lastBatchNumber: envelope.batchNumber,
              failedAt: now,
              failureReason,
            },
          });
          return response;
        }
        this.assertRowsMatchMonthlyConfiguration(
          normalized.accepted,
          monthlyConfigurationContract,
        );

        let upserted = 0;
        let unchanged = 0;
        let deactivated = 0;
        for (const row of normalized.accepted) {
          const existing =
            await tx.usinaFleetMaintenanceLaborAllocation.findUnique({
              where: {
                source_sourceRecordId: {
                  source: row.source,
                  sourceRecordId: row.sourceRecordId,
                },
              },
            });
          const data = allocationData(row, run.id, now);
          if (!existing) {
            const created =
              await tx.usinaFleetMaintenanceLaborAllocation.create({ data });
            await tx.usinaFleetMaintenanceLaborAllocationAudit.create({
              data: {
                allocationId: created.id,
                operation: 'CREATE',
                syncRunId: envelope.syncRunId,
                afterData: snapshot(created),
              },
            });
            upserted += 1;
            if (!row.active) deactivated += 1;
          } else if (
            existing.contentHash === row.contentHash &&
            existing.active === row.active
          ) {
            await tx.usinaFleetMaintenanceLaborAllocation.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const updated =
              await tx.usinaFleetMaintenanceLaborAllocation.update({
                where: { id: existing.id },
                data,
              });
            await tx.usinaFleetMaintenanceLaborAllocationAudit.create({
              data: {
                allocationId: existing.id,
                operation: row.active ? 'UPDATE' : 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
            upserted += 1;
            if (existing.active && !row.active) deactivated += 1;
          }
        }

        if (envelope.isLastBatch && envelope.syncMode === 'full') {
          await this.assertFullRunCoverage(
            tx,
            run.id,
            monthlyConfigurationContract,
          );
          const stale = await tx.usinaFleetMaintenanceLaborAllocation.findMany({
            where: {
              companyId: USINA_COMPANY_ID,
              unitId: USINA_UNIT_ID,
              source: 'AETHOS',
              competence: {
                gte: envelope.scope.dateFrom,
                lte: envelope.scope.dateTo,
              },
              active: true,
              OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
            },
          });
          for (const existing of stale) {
            const updated =
              await tx.usinaFleetMaintenanceLaborAllocation.update({
                where: { id: existing.id },
                data: {
                  active: false,
                  deactivatedAt: now,
                  deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`,
                  syncedAt: now,
                },
              });
            await tx.usinaFleetMaintenanceLaborAllocationAudit.create({
              data: {
                allocationId: existing.id,
                operation: 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
          }
          deactivated += stale.length;
        }

        const reconciliation = await this.reconciliation(tx, envelope);
        const finalized = envelope.isLastBatch;
        const response = {
          ok: true,
          dataset: envelope.dataset,
          syncRunId: envelope.syncRunId,
          batchNumber: envelope.batchNumber,
          received: envelope.rows.length,
          accepted: normalized.accepted.length,
          applied: normalized.accepted.length,
          upserted,
          unchanged,
          rejected: 0,
          deactivated,
          rejectedRows: [],
          finalized,
          failed: false,
          runStatus: finalized ? 'COMPLETED' : 'IN_PROGRESS',
          failureReason: null,
          reconciliation,
          replayed: false,
        };
        await tx.usinaSyncBatch.create({
          data: {
            runId: run.id,
            batchNumber: envelope.batchNumber,
            payloadHash,
            receivedCount: envelope.rows.length,
            acceptedCount: normalized.accepted.length,
            upsertedCount: upserted,
            unchangedCount: unchanged,
            rejectedCount: 0,
            deactivatedCount: deactivated,
            response: response as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.usinaSyncRun.update({
          where: { id: run.id },
          data: {
            status: finalized ? 'COMPLETED' : 'IN_PROGRESS',
            receivedCount: { increment: envelope.rows.length },
            acceptedCount: { increment: normalized.accepted.length },
            upsertedCount: { increment: upserted },
            unchangedCount: { increment: unchanged },
            deactivatedCount: { increment: deactivated },
            lastBatchNumber: envelope.batchNumber,
            completedAt: finalized ? now : null,
            failedAt: null,
            failureReason: null,
          },
        });
        return response;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async status() {
    await expireStaleUsinaSyncRuns(this.prisma, [
      USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET,
    ]);
    const [activeCount, grouped, lastRun] = await Promise.all([
      this.prisma.usinaFleetMaintenanceLaborAllocation.count({
        where: { active: true },
      }),
      this.prisma.usinaFleetMaintenanceLaborAllocation.groupBy({
        by: ['competence', 'targetCostClass'],
        where: { active: true },
        _count: { _all: true },
        _sum: {
          vehicleExpenseAmount: true,
          allocatedLaborAmount: true,
          expectedLineAmount: true,
        },
        orderBy: [{ competence: 'asc' }, { targetCostClass: 'asc' }],
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: {
          dataset: USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      usinaFleetMaintenanceLaborAllocationsEndpoint:
        '/integrations/aethos/usina/fleet-maintenance-labor-allocations/sync',
      fleetMaintenanceLaborAllocations: {
        activeCount,
        reconciliation: grouped.map((entry) => ({
          competence: entry.competence.toISOString().slice(0, 10),
          targetCostClass: entry.targetCostClass,
          vehicles: entry._count._all,
          vehicleExpenseAmount:
            entry._sum.vehicleExpenseAmount?.toFixed(12) ?? '0.000000000000',
          allocatedLaborAmount:
            entry._sum.allocatedLaborAmount?.toFixed(12) ?? '0.000000000000',
          expectedLineAmount:
            entry._sum.expectedLineAmount?.toFixed(12) ?? '0.000000000000',
        })),
        lastRun,
      },
    };
  }
}
