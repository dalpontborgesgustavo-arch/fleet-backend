import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { expireStaleUsinaSyncRuns } from '../aethos-integration/usina-sync-run-policy';
import { hashCanonicalValue } from '../aethos-integration/usina-production-sync.rules';
import {
  COST_PURCHASE_EXPENSE_DATASET,
  COST_PURCHASE_FUEL_DATASET,
  COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
  COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
  COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
} from './cost-purchases.rules';
import {
  CostPurchaseSyncDataset,
  normalizeCostPurchaseEnvelope,
  normalizeCostPurchaseRows,
} from './cost-purchases-sync.rules';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

@Injectable()
export class CostPurchasesSyncService {
  constructor(private readonly prisma: PrismaService) {}

  syncExpenses(body: unknown) {
    return this.sync(body, COST_PURCHASE_EXPENSE_DATASET);
  }

  syncFuel(body: unknown) {
    return this.sync(body, COST_PURCHASE_FUEL_DATASET);
  }

  syncManagerialEntries(body: unknown) {
    return this.sync(body, COST_PURCHASE_MANAGERIAL_ENTRY_DATASET);
  }

  syncInternalConsumption(body: unknown) {
    return this.sync(body, COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET);
  }

  syncPreventiveOrders(body: unknown) {
    return this.sync(body, COST_PURCHASE_PREVENTIVE_ORDER_DATASET);
  }

  async status() {
    const runs = await this.prisma.usinaSyncRun.findMany({
      where: {
        dataset: {
          in: [
            COST_PURCHASE_EXPENSE_DATASET,
            COST_PURCHASE_FUEL_DATASET,
            COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
            COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
            COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
          ],
        },
      },
      distinct: ['dataset'],
      orderBy: [{ dataset: 'asc' }, { generatedAt: 'desc' }],
      select: {
        dataset: true,
        status: true,
        generatedAt: true,
        completedAt: true,
        acceptedCount: true,
        upsertedCount: true,
        rejectedCount: true,
        deactivatedCount: true,
      },
    });
    return { costPurchases: runs };
  }

  private delegates(
    tx: Prisma.TransactionClient,
    dataset: CostPurchaseSyncDataset,
  ) {
    const client = tx as any;
    if (dataset === COST_PURCHASE_EXPENSE_DATASET) {
      return {
        fact: client.costPurchaseVehicleExpenseFact,
        audit: client.costPurchaseVehicleExpenseFactAudit,
      };
    }
    if (dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET) {
      return {
        fact: client.costPurchaseManagerialEntryFact,
        audit: client.costPurchaseManagerialEntryFactAudit,
      };
    }
    if (dataset === COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET) {
      return {
        fact: client.costPurchaseInternalConsumptionFact,
        audit: client.costPurchaseInternalConsumptionFactAudit,
      };
    }
    if (dataset === COST_PURCHASE_PREVENTIVE_ORDER_DATASET) {
      return {
        fact: client.costPurchasePreventiveOrderFact,
        audit: client.costPurchasePreventiveOrderFactAudit,
      };
    }
    return {
      fact: client.costPurchaseVehicleFuelFact,
      audit: client.costPurchaseVehicleFuelFactAudit,
    };
  }

  private assertRunContract(run: any, envelope: any) {
    const metadata = (run.scopeMetadata || {}) as Record<string, unknown>;
    const storedVehicleIds = Array.isArray(metadata.aethosVehicleIds)
      ? metadata.aethosVehicleIds.map(Number).sort((a, b) => a - b)
      : [];
    const incomingVehicleIds = [...envelope.scope.aethosVehicleIds].sort(
      (a: number, b: number) => a - b,
    );
    const same =
      run.syncMode === envelope.syncMode &&
      run.generatedAt.toISOString() === envelope.generatedAt.toISOString() &&
      run.scopeCompanyId === envelope.scope.company &&
      run.scopeUnitId === envelope.scope.unit &&
      run.scopeDateFrom.toISOString().slice(0, 10) ===
        envelope.scope.dateFrom.toISOString().slice(0, 10) &&
      run.scopeDateTo.toISOString().slice(0, 10) ===
        envelope.scope.dateTo.toISOString().slice(0, 10) &&
      JSON.stringify(storedVehicleIds) === JSON.stringify(incomingVehicleIds);
    if (!same) {
      throw new BadRequestException(
        'syncRunId ja utilizado com outro contrato ou scope',
      );
    }
  }

  private factData(
    dataset: CostPurchaseSyncDataset,
    row: any,
    envelope: ReturnType<typeof normalizeCostPurchaseEnvelope>,
    runId: string,
    now: Date,
  ) {
    if (dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET) {
      return {
        companyId: envelope.scope.company,
        unitId: envelope.scope.unit,
        dataset,
        source: row.source,
        sourceRecordId: row.sourceRecordId,
        sourceHeaderId: row.sourceHeaderId,
        sourceItemId: row.sourceItemId,
        documentDate: row.documentDate,
        competence: row.competence,
        documentNumber: row.documentNumber,
        sourceStatus: row.sourceStatus,
        sourceOrderId: row.sourceOrderId,
        sourceOrderItemId: row.sourceOrderItemId,
        sourceOrderStatus: row.sourceOrderStatus,
        aethosItemId: row.aethosItemId,
        unit: row.unit,
        quantity: row.quantity,
        totalValue: row.totalValue,
        contentHash: row.contentHash,
        raw: row.raw,
        active: row.active,
        deactivatedAt: row.active ? null : now,
        deactivationReason: row.active ? null : 'SOURCE_CANCELLED',
        lastSeenRunId: runId,
        syncedAt: now,
      };
    }
    if (dataset === COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET) {
      return {
        companyId: envelope.scope.company,
        unitId: envelope.scope.unit,
        dataset,
        source: row.source,
        sourceRecordId: row.sourceRecordId,
        sourceHeaderId: row.sourceHeaderId,
        sourceItemId: row.sourceItemId,
        documentDate: row.documentDate,
        competence: row.competence,
        documentNumber: row.documentNumber,
        planAccountId: row.planAccountId,
        categoryId: row.categoryId,
        aethosItemId: row.aethosItemId,
        aethosVehicleId: row.aethosVehicleId,
        assetCode: row.assetCode,
        quantity: row.quantity,
        unit: row.unit,
        amount: row.amount,
        sourceUpdatedAt: row.sourceUpdatedAt,
        sourceContentHash: row.sourceContentHash,
        contentHash: row.contentHash,
        raw: row.raw,
        active: row.active,
        deactivatedAt: row.active ? null : now,
        deactivationReason: row.active ? null : 'SOURCE_INACTIVE',
        lastSeenRunId: runId,
        syncedAt: now,
      };
    }
    if (dataset === COST_PURCHASE_PREVENTIVE_ORDER_DATASET) {
      return {
        companyId: envelope.scope.company,
        unitId: envelope.scope.unit,
        dataset,
        source: row.source,
        sourceRecordId: row.sourceRecordId,
        orderId: row.orderId,
        documentDate: row.documentDate,
        competence: row.competence,
        documentNumber: row.documentNumber,
        aethosVehicleId: row.aethosVehicleId,
        assetCode: row.assetCode,
        amount: row.amount,
        preventiveLinkIds: row.preventiveLinkIds,
        sourceUpdatedAt: row.sourceUpdatedAt,
        sourceContentHash: row.sourceContentHash,
        contentHash: row.contentHash,
        raw: row.raw,
        active: row.active,
        deactivatedAt: row.active ? null : now,
        deactivationReason: row.active ? null : 'SOURCE_INACTIVE',
        lastSeenRunId: runId,
        syncedAt: now,
      };
    }
    const common = {
      companyId: envelope.scope.company,
      unitId: envelope.scope.unit,
      dataset,
      source: row.source,
      sourceRecordId: row.sourceRecordId,
      competence: row.competence,
      aethosVehicleId: row.aethosVehicleId,
      documentDate: row.documentDate,
      desiredAverage: row.desiredAverage,
      contentHash: row.contentHash,
      raw: row.raw,
      active: row.active,
      deactivatedAt: row.active ? null : now,
      deactivationReason: row.active ? null : 'SOURCE_INACTIVE',
      lastSeenRunId: runId,
      syncedAt: now,
    };
    if (dataset === COST_PURCHASE_EXPENSE_DATASET) {
      return {
        ...common,
        documentNumber: row.documentNumber,
        amount: row.amount,
      };
    }
    return {
      ...common,
      fuelAmount: row.fuelAmount,
      liters: row.liters,
      initialKm: row.initialKm,
      currentKm: row.currentKm,
      usesHourMeter: row.usesHourMeter,
      sourceAverage: row.sourceAverage,
      planAccountId: row.planAccountId,
    };
  }

  private async reconciliation(
    tx: Prisma.TransactionClient,
    dataset: CostPurchaseSyncDataset,
    envelope: any,
  ) {
    const delegates = this.delegates(tx, dataset);
    const rows = await delegates.fact.findMany({
      where: {
        companyId: envelope.scope.company,
        unitId: envelope.scope.unit,
        dataset,
        competence: {
          gte: monthStart(envelope.scope.dateFrom),
          lte: monthStart(envelope.scope.dateTo),
        },
        active: true,
        ...(envelope.scope.aethosVehicleIds.length
          ? { aethosVehicleId: { in: envelope.scope.aethosVehicleIds } }
          : {}),
      },
      select:
        dataset === COST_PURCHASE_EXPENSE_DATASET
          ? { competence: true, amount: true }
          : dataset === COST_PURCHASE_FUEL_DATASET
            ? { competence: true, fuelAmount: true, liters: true }
            : dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET
              ? { competence: true, totalValue: true }
              : { competence: true, amount: true },
    });
    const grouped = new Map<
      string,
      { rows: number; amount: Prisma.Decimal; liters: Prisma.Decimal }
    >();
    for (const row of rows) {
      const key = row.competence.toISOString().slice(0, 10);
      const current = grouped.get(key) || {
        rows: 0,
        amount: new Prisma.Decimal(0),
        liters: new Prisma.Decimal(0),
      };
      current.rows += 1;
      current.amount = current.amount.plus(
        row.amount ?? row.fuelAmount ?? row.totalValue ?? 0,
      );
      current.liters = current.liters.plus(row.liters ?? 0);
      grouped.set(key, current);
    }
    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([competence, value]) => ({
        competence,
        rows: value.rows,
        amount: value.amount.toFixed(6),
        ...(dataset === COST_PURCHASE_FUEL_DATASET
          ? { liters: value.liters.toFixed(6) }
          : {}),
      }));
  }

  private async sync(body: unknown, dataset: CostPurchaseSyncDataset) {
    const envelope = normalizeCostPurchaseEnvelope(body, dataset);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [dataset]);
    return this.prisma.$transaction(
      async (tx) => {
        let run = await tx.usinaSyncRun.findUnique({
          where: {
            dataset_syncRunId: {
              dataset,
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
            if (replay.payloadHash !== payloadHash) {
              throw new BadRequestException(
                'batchNumber ja processado com outro payload',
              );
            }
            return {
              ...(replay.response as Record<string, unknown>),
              replayed: true,
            };
          }
          if (run.status !== 'IN_PROGRESS') {
            throw new BadRequestException(
              `syncRunId ${run.status.toLowerCase()}`,
            );
          }
          if (envelope.batchNumber !== (run.lastBatchNumber || 0) + 1) {
            throw new BadRequestException(
              `Proximo batchNumber esperado: ${(run.lastBatchNumber || 0) + 1}`,
            );
          }
        } else {
          if (envelope.batchNumber !== 1) {
            throw new BadRequestException(
              'O primeiro lote deve usar batchNumber 1',
            );
          }
          run = await tx.usinaSyncRun.create({
            data: {
              dataset,
              syncRunId: envelope.syncRunId,
              syncMode: envelope.syncMode,
              generatedAt: envelope.generatedAt,
              scopeCompanyId: envelope.scope.company,
              scopeUnitId: envelope.scope.unit,
              scopeDateFrom: envelope.scope.dateFrom,
              scopeDateTo: envelope.scope.dateTo,
              scopeMetadata: {
                aethosVehicleIds: envelope.scope.aethosVehicleIds,
                source: 'AETHOS_READ_ONLY_EXPORT',
              },
            },
          });
        }

        const normalized = normalizeCostPurchaseRows(
          dataset,
          envelope.rows,
          envelope.scope,
        );
        const now = new Date();
        if (normalized.rejected.length) {
          const failureReason = `${normalized.rejected.length} linha(s) rejeitada(s) no lote ${envelope.batchNumber}`;
          const response = {
            ok: false,
            dataset,
            syncRunId: envelope.syncRunId,
            batchNumber: envelope.batchNumber,
            received: envelope.rows.length,
            accepted: normalized.accepted.length,
            upserted: 0,
            unchanged: 0,
            rejected: normalized.rejected.length,
            deactivated: 0,
            rejectedRows: normalized.rejected,
            finalized: false,
            runStatus: 'FAILED',
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

        const delegates = this.delegates(tx, dataset);
        let upserted = 0;
        let unchanged = 0;
        let deactivated = 0;
        let quarantined = 0;
        let staleIgnored = 0;
        for (const row of normalized.accepted) {
          const gasolineVolumeAnomaly =
            dataset === COST_PURCHASE_FUEL_DATASET &&
            (row as any).planAccountId === 131 &&
            (row as any).liters.gt(500);
          const quarantineKey = {
            source_companyId_unitId_dataset_sourceRecordId: {
              source: row.source,
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              dataset,
              sourceRecordId: row.sourceRecordId,
            },
          };
          if (gasolineVolumeAnomaly) {
            const existingQuarantine =
              await tx.costPurchaseManagerialQuarantine.findUnique({
                where: quarantineKey,
              });
            const quarantineData = {
              source: row.source,
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              dataset,
              sourceRecordId: row.sourceRecordId,
              competence: row.competence,
              reasonCode: 'GASOLINE_LITERS_GT_500',
              reasonDetail:
                'Lançamento individual de gasolina superior a 500 litros',
              payloadHash: row.contentHash,
              raw: row.raw,
              active: true,
              resolvedAt: null,
              resolvedBy: null,
              syncRunId: envelope.syncRunId,
            };
            const saved = existingQuarantine
              ? await tx.costPurchaseManagerialQuarantine.update({
                  where: { id: existingQuarantine.id },
                  data: quarantineData,
                })
              : await tx.costPurchaseManagerialQuarantine.create({
                  data: quarantineData,
                });
            await tx.costPurchaseManagerialQuarantineAudit.create({
              data: {
                quarantineId: saved.id,
                operation: existingQuarantine ? 'UPDATE' : 'CREATE',
                syncRunId: envelope.syncRunId,
                beforeData: existingQuarantine
                  ? snapshot(existingQuarantine)
                  : undefined,
                afterData: snapshot(saved),
              },
            });
            const existingFact = await delegates.fact.findUnique({
              where: quarantineKey,
            });
            if (existingFact?.active) {
              const deactivatedFact = await delegates.fact.update({
                where: { id: existingFact.id },
                data: {
                  active: false,
                  deactivatedAt: now,
                  deactivationReason: 'QUARANTINED_GASOLINE_VOLUME',
                  lastSeenRunId: run.id,
                  syncedAt: now,
                },
              });
              await delegates.audit.create({
                data: {
                  factId: existingFact.id,
                  operation: 'DEACTIVATE',
                  syncRunId: envelope.syncRunId,
                  beforeData: snapshot(existingFact),
                  afterData: snapshot(deactivatedFact),
                },
              });
              deactivated += 1;
            }
            quarantined += 1;
            continue;
          }
          if (dataset === COST_PURCHASE_FUEL_DATASET) {
            const existingQuarantine =
              await tx.costPurchaseManagerialQuarantine.findUnique({
                where: quarantineKey,
              });
            if (existingQuarantine?.active) {
              const resolved = await tx.costPurchaseManagerialQuarantine.update(
                {
                  where: { id: existingQuarantine.id },
                  data: {
                    active: false,
                    resolvedAt: now,
                    resolvedBy: 'SOURCE_CORRECTION',
                    syncRunId: envelope.syncRunId,
                  },
                },
              );
              await tx.costPurchaseManagerialQuarantineAudit.create({
                data: {
                  quarantineId: resolved.id,
                  operation: 'RESOLVE',
                  syncRunId: envelope.syncRunId,
                  beforeData: snapshot(existingQuarantine),
                  afterData: snapshot(resolved),
                },
              });
            }
          }
          const existing = await delegates.fact.findUnique({
            where: {
              source_companyId_unitId_dataset_sourceRecordId: {
                source: row.source,
                companyId: envelope.scope.company,
                unitId: envelope.scope.unit,
                dataset,
                sourceRecordId: row.sourceRecordId,
              },
            },
          });
          if (
            dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET &&
            existing?.lastSeenRunId
          ) {
            const previousRun = await tx.usinaSyncRun.findUnique({
              where: { id: existing.lastSeenRunId },
              select: { generatedAt: true },
            });
            if (
              previousRun &&
              previousRun.generatedAt.getTime() > envelope.generatedAt.getTime()
            ) {
              staleIgnored += 1;
              continue;
            }
            if (
              previousRun &&
              previousRun.generatedAt.getTime() ===
                envelope.generatedAt.getTime() &&
              existing.lastSeenRunId !== run.id &&
              (existing.contentHash !== row.contentHash ||
                existing.active !== row.active)
            ) {
              throw new BadRequestException(
                'cargas gerenciais com generatedAt igual e conteudo divergente',
              );
            }
          }
          const data = this.factData(dataset, row, envelope, run.id, now);
          if (!existing) {
            const created = await delegates.fact.create({ data });
            await delegates.audit.create({
              data: {
                factId: created.id,
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
            await delegates.fact.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const updated = await delegates.fact.update({
              where: { id: existing.id },
              data,
            });
            await delegates.audit.create({
              data: {
                factId: existing.id,
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
          const stale = await delegates.fact.findMany({
            where: {
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              dataset,
              competence: {
                gte: monthStart(envelope.scope.dateFrom),
                lte: monthStart(envelope.scope.dateTo),
              },
              active: true,
              NOT: { lastSeenRunId: run.id },
              ...(envelope.scope.aethosVehicleIds.length
                ? { aethosVehicleId: { in: envelope.scope.aethosVehicleIds } }
                : {}),
            },
          });
          for (const fact of stale) {
            if (
              dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET &&
              fact.lastSeenRunId
            ) {
              const previousRun = await tx.usinaSyncRun.findUnique({
                where: { id: fact.lastSeenRunId },
                select: { generatedAt: true },
              });
              if (
                previousRun &&
                previousRun.generatedAt.getTime() >
                  envelope.generatedAt.getTime()
              ) {
                staleIgnored += 1;
                continue;
              }
            }
            const updated = await delegates.fact.update({
              where: { id: fact.id },
              data: {
                active: false,
                deactivatedAt: now,
                deactivationReason: 'ABSENT_FROM_FULL_SYNC',
                lastSeenRunId: run.id,
                syncedAt: now,
              },
            });
            await delegates.audit.create({
              data: {
                factId: fact.id,
                operation: 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(fact),
                afterData: snapshot(updated),
              },
            });
            deactivated += 1;
          }
        }

        const finalized = envelope.isLastBatch;
        const reconciliation = finalized
          ? await this.reconciliation(tx, dataset, envelope)
          : [];
        const response = {
          ok: true,
          dataset,
          syncRunId: envelope.syncRunId,
          batchNumber: envelope.batchNumber,
          received: envelope.rows.length,
          accepted: normalized.accepted.length,
          upserted,
          unchanged,
          rejected: 0,
          deactivated,
          quarantined,
          staleIgnored,
          finalized,
          runStatus: finalized ? 'COMPLETED' : 'IN_PROGRESS',
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
          },
        });
        return response;
      },
      {
        timeout: 120000,
        ...(dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET
          ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          : {}),
      },
    );
  }
}
