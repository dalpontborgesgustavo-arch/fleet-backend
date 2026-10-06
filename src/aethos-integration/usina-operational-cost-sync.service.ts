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
  normalizeUsinaOperationalCostEnvelope,
  normalizeUsinaOperationalCostRows,
  NormalizedOperationalCostRow,
  USINA_OPERATIONAL_COST_DATASETS,
} from './usina-operational-cost-sync.rules';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function data(row: NormalizedOperationalCostRow, runId: string, now: Date) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    dataset: row.dataset,
    sourceRecordId: row.sourceRecordId,
    sourceDocumentId: row.sourceDocumentId,
    sourceDocumentType: row.sourceDocumentType,
    aethosVehicleId: row.aethosVehicleId,
    fleetNumber: row.fleetNumber,
    accountPlanId: row.accountPlanId,
    accountPlanDescription: row.accountPlanDescription,
    internalConsumptionId: row.internalConsumptionId,
    internalConsumptionItemId: row.internalConsumptionItemId,
    materialEntryId: row.materialEntryId,
    materialEntryItemId: row.materialEntryItemId,
    sourceNoteNumber: row.sourceNoteNumber,
    receivedDate: row.receivedDate,
    aethosItemId: row.aethosItemId,
    itemDescription: row.itemDescription,
    itemCategoryId: row.itemCategoryId,
    itemCategoryDescription: row.itemCategoryDescription,
    sourceDirection: row.sourceDirection,
    selectionBasis: row.selectionBasis,
    costClass: row.costClass,
    occurredAt: row.occurredAt,
    occurredDate: row.occurredDate,
    competence: row.competence,
    amount: row.amount,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    quantityOriginal: row.quantityOriginal,
    quantityOriginalUnit: row.quantityOriginalUnit,
    quantityTon: row.quantityTon,
    unitPriceOriginal: row.unitPriceOriginal,
    unitPriceTon: row.unitPriceTon,
    sourceItemTotal: row.sourceItemTotal,
    quantityNormalizationBasis: row.quantityNormalizationBasis,
    priceNormalizationBasis: row.priceNormalizationBasis,
    competenceBasis: row.competenceBasis,
    aethosCompanyId: row.aethosCompanyId,
    supplierId: row.supplierId,
    debitCreditFlag: row.debitCreditFlag,
    sourceStatus: row.sourceStatus,
    limitationNote: row.limitationNote,
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
export class UsinaOperationalCostSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(body: unknown) {
    const envelope = normalizeUsinaOperationalCostEnvelope(body);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [envelope.dataset]);
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
          const same =
            run.syncMode === envelope.syncMode &&
            run.generatedAt.toISOString() ===
              envelope.generatedAt.toISOString() &&
            run.scopeCompanyId === envelope.scope.company &&
            run.scopeUnitId === envelope.scope.unit &&
            run.scopeDateFrom.toISOString().slice(0, 10) ===
              envelope.scope.dateFrom.toISOString().slice(0, 10) &&
            run.scopeDateTo.toISOString().slice(0, 10) ===
              envelope.scope.dateTo.toISOString().slice(0, 10);
          if (!same)
            throw new BadRequestException(
              'syncRunId reutilizado com outro contrato',
            );
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
              'Primeiro lote deve ser batchNumber 1',
            );
          run = await tx.usinaSyncRun.create({
            data: {
              dataset: envelope.dataset,
              syncRunId: envelope.syncRunId,
              syncMode: envelope.syncMode,
              generatedAt: envelope.generatedAt,
              scopeCompanyId: envelope.scope.company,
              scopeUnitId: envelope.scope.unit,
              scopeDateFrom: envelope.scope.dateFrom,
              scopeDateTo: envelope.scope.dateTo,
            },
          });
        }
        const now = new Date();
        const normalized = normalizeUsinaOperationalCostRows(
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
        let upserted = 0;
        let unchanged = 0;
        let explicitDeactivated = 0;
        for (const row of normalized.accepted) {
          const existing = await tx.usinaOperationalCostFact.findUnique({
            where: {
              source_dataset_sourceRecordId: {
                source: row.source,
                dataset: row.dataset,
                sourceRecordId: row.sourceRecordId,
              },
            },
          });
          const factData = data(row, run.id, now);
          if (!existing) {
            const created = await tx.usinaOperationalCostFact.create({
              data: factData,
            });
            await tx.usinaOperationalCostFactAudit.create({
              data: {
                factId: created.id,
                operation: row.active ? 'CREATE' : 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                afterData: snapshot(created),
              },
            });
            upserted += 1;
            if (!row.active) explicitDeactivated += 1;
          } else if (
            existing.contentHash === row.contentHash &&
            existing.active === row.active
          ) {
            await tx.usinaOperationalCostFact.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const updated = await tx.usinaOperationalCostFact.update({
              where: { id: existing.id },
              data: factData,
            });
            await tx.usinaOperationalCostFactAudit.create({
              data: {
                factId: existing.id,
                operation: row.active ? 'UPDATE' : 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
            upserted += 1;
            if (existing.active && !row.active) explicitDeactivated += 1;
          }
        }
        let absentDeactivated = 0;
        if (envelope.isLastBatch && envelope.syncMode === 'full') {
          const stale = await tx.usinaOperationalCostFact.findMany({
            where: {
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              dataset: envelope.dataset,
              competence: {
                gte: envelope.scope.dateFrom,
                lte: envelope.scope.dateTo,
              },
              active: true,
              OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
            },
          });
          for (const existing of stale) {
            const updated = await tx.usinaOperationalCostFact.update({
              where: { id: existing.id },
              data: {
                active: false,
                deactivatedAt: now,
                deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`,
                syncedAt: now,
              },
            });
            await tx.usinaOperationalCostFactAudit.create({
              data: {
                factId: existing.id,
                operation: 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
          }
          absentDeactivated = stale.length;
        }
        const deactivated = explicitDeactivated + absentDeactivated;
        const grouped = await tx.usinaOperationalCostFact.groupBy({
          by: ['competence', 'costClass'],
          where: {
            companyId: envelope.scope.company,
            unitId: envelope.scope.unit,
            dataset: envelope.dataset,
            competence: {
              gte: envelope.scope.dateFrom,
              lte: envelope.scope.dateTo,
            },
            active: true,
          },
          _count: { _all: true },
          _sum: { amount: true, quantity: true },
          orderBy: [{ competence: 'asc' }, { costClass: 'asc' }],
        });
        const reconciliation = grouped.map((entry: any) => ({
          competence: entry.competence.toISOString().slice(0, 10),
          costClass: entry.costClass,
          count: entry._count._all,
          amount: entry._sum.amount?.toFixed(6) ?? null,
          quantity: entry._sum.quantity?.toFixed(6) ?? null,
        }));
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
    await expireStaleUsinaSyncRuns(
      this.prisma,
      USINA_OPERATIONAL_COST_DATASETS,
    );
    const [active, lastRuns] = await Promise.all([
      this.prisma.usinaOperationalCostFact.groupBy({
        by: ['dataset', 'costClass'],
        where: { active: true },
        _count: { _all: true },
        _sum: { amount: true, quantity: true },
        orderBy: [{ dataset: 'asc' }, { costClass: 'asc' }],
      }),
      Promise.all(
        USINA_OPERATIONAL_COST_DATASETS.map((dataset) =>
          this.prisma.usinaSyncRun.findFirst({
            where: { dataset },
            orderBy: { createdAt: 'desc' },
            select: {
              dataset: true,
              syncRunId: true,
              status: true,
              receivedCount: true,
              acceptedCount: true,
              upsertedCount: true,
              unchangedCount: true,
              rejectedCount: true,
              deactivatedCount: true,
              lastBatchNumber: true,
              completedAt: true,
              failedAt: true,
              failureReason: true,
            },
          }),
        ),
      ),
    ]);
    return {
      operationalCosts: {
        active: active.map((entry: any) => ({
          dataset: entry.dataset,
          costClass: entry.costClass,
          count: entry._count._all,
          amount: entry._sum.amount?.toFixed(6) ?? null,
          quantity: entry._sum.quantity?.toFixed(6) ?? null,
        })),
        lastRuns,
      },
    };
  }
}
