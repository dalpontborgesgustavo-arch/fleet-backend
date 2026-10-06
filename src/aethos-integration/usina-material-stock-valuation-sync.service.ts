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
  normalizeUsinaMaterialStockValuationEnvelope,
  normalizeUsinaMaterialStockValuationRows,
  NormalizedMaterialStockValuationRow,
  USINA_MATERIAL_STOCK_VALUATION_DATASET,
} from './usina-material-stock-valuation-sync.rules';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function valuationData(
  row: NormalizedMaterialStockValuationRow,
  runId: string,
  now: Date,
) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    aethosCompanyId: row.aethosCompanyId,
    aethosItemId: row.aethosItemId,
    competence: row.competence,
    quantityUnit: row.quantityUnit,
    openingQuantity: row.openingQuantity,
    validEntryQuantity: row.validEntryQuantity,
    validIssueQuantity: row.validIssueQuantity,
    cancellationAdjustmentQuantity: row.cancellationAdjustmentQuantity,
    netMovementQuantity: row.netMovementQuantity,
    closingQuantity: row.closingQuantity,
    openingAverageCost: row.openingAverageCost,
    closingAverageCost: row.closingAverageCost,
    sourceMaxMovementId: row.sourceMaxMovementId,
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
export class UsinaMaterialStockValuationSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRunContract(
    run: any,
    envelope: ReturnType<typeof normalizeUsinaMaterialStockValuationEnvelope>,
  ) {
    const expectedHash = hashCanonicalValue({
      companyId: envelope.scope.companyId,
      aethosItemIds: envelope.scope.aethosItemIds,
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

  async sync(body: unknown) {
    const envelope = normalizeUsinaMaterialStockValuationEnvelope(body);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [
      USINA_MATERIAL_STOCK_VALUATION_DATASET,
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
            return { ...(replay.response as Record<string, unknown>), replayed: true };
          }
          if (run.status !== 'IN_PROGRESS')
            throw new BadRequestException(`syncRunId ${run.status.toLowerCase()}`);
          if (envelope.batchNumber !== (run.lastBatchNumber || 0) + 1)
            throw new BadRequestException(
              `Proximo batchNumber esperado: ${(run.lastBatchNumber || 0) + 1}`,
            );
        } else {
          if (envelope.batchNumber !== 1)
            throw new BadRequestException('O primeiro lote deve usar batchNumber 1');
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
                companyId: envelope.scope.companyId,
                aethosItemIds: envelope.scope.aethosItemIds,
                hash: hashCanonicalValue({
                  companyId: envelope.scope.companyId,
                  aethosItemIds: envelope.scope.aethosItemIds,
                }),
              },
            },
          });
        }

        const now = new Date();
        const normalized = normalizeUsinaMaterialStockValuationRows(
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
        let deactivated = 0;
        for (const row of normalized.accepted) {
          const existing = await tx.usinaMaterialStockValuation.findUnique({
            where: {
              source_aethosCompanyId_aethosItemId_competence: {
                source: row.source,
                aethosCompanyId: row.aethosCompanyId,
                aethosItemId: row.aethosItemId,
                competence: row.competence,
              },
            },
          });
          const data = valuationData(row, run.id, now);
          if (!existing) {
            const created = await tx.usinaMaterialStockValuation.create({ data });
            await tx.usinaMaterialStockValuationAudit.create({
              data: {
                valuationId: created.id,
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
            await tx.usinaMaterialStockValuation.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const updated = await tx.usinaMaterialStockValuation.update({
              where: { id: existing.id },
              data,
            });
            await tx.usinaMaterialStockValuationAudit.create({
              data: {
                valuationId: existing.id,
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
          const stale = await tx.usinaMaterialStockValuation.findMany({
            where: {
              companyId: USINA_COMPANY_ID,
              unitId: USINA_UNIT_ID,
              source: 'AETHOS',
              aethosCompanyId: envelope.scope.companyId,
              aethosItemId: { in: envelope.scope.aethosItemIds },
              competence: {
                gte: envelope.scope.dateFrom,
                lte: envelope.scope.dateTo,
              },
              active: true,
              OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
            },
          });
          for (const existing of stale) {
            const updated = await tx.usinaMaterialStockValuation.update({
              where: { id: existing.id },
              data: {
                active: false,
                deactivatedAt: now,
                deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`,
                syncedAt: now,
              },
            });
            await tx.usinaMaterialStockValuationAudit.create({
              data: {
                valuationId: existing.id,
                operation: 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
          }
          deactivated += stale.length;
        }

        const active = await tx.usinaMaterialStockValuation.findMany({
          where: {
            companyId: USINA_COMPANY_ID,
            unitId: USINA_UNIT_ID,
            source: 'AETHOS',
            aethosCompanyId: envelope.scope.companyId,
            aethosItemId: { in: envelope.scope.aethosItemIds },
            competence: {
              gte: envelope.scope.dateFrom,
              lte: envelope.scope.dateTo,
            },
            active: true,
          },
          orderBy: [{ competence: 'asc' }, { aethosItemId: 'asc' }],
          select: {
            competence: true,
            aethosItemId: true,
            quantityUnit: true,
            openingQuantity: true,
            validEntryQuantity: true,
            validIssueQuantity: true,
            cancellationAdjustmentQuantity: true,
            netMovementQuantity: true,
            closingQuantity: true,
            openingAverageCost: true,
            closingAverageCost: true,
          },
        });
        const reconciliation = active.map((entry) => ({
          competence: entry.competence.toISOString().slice(0, 10),
          aethosItemId: entry.aethosItemId,
          quantityUnit: entry.quantityUnit,
          openingQuantity: entry.openingQuantity.toFixed(6),
          validEntryQuantity: entry.validEntryQuantity.toFixed(6),
          validIssueQuantity: entry.validIssueQuantity.toFixed(6),
          cancellationAdjustmentQuantity:
            entry.cancellationAdjustmentQuantity.toFixed(6),
          netMovementQuantity: entry.netMovementQuantity.toFixed(6),
          closingQuantity: entry.closingQuantity.toFixed(6),
          openingAverageCost: entry.openingAverageCost?.toFixed(6) ?? null,
          closingAverageCost: entry.closingAverageCost?.toFixed(6) ?? null,
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
    await expireStaleUsinaSyncRuns(this.prisma, [
      USINA_MATERIAL_STOCK_VALUATION_DATASET,
    ]);
    const [active, lastRun] = await Promise.all([
      this.prisma.usinaMaterialStockValuation.findMany({
        where: { active: true },
        orderBy: [{ competence: 'asc' }, { aethosItemId: 'asc' }],
        select: {
          competence: true,
          aethosCompanyId: true,
          aethosItemId: true,
          quantityUnit: true,
          closingQuantity: true,
          closingAverageCost: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: USINA_MATERIAL_STOCK_VALUATION_DATASET },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      materialStockValuations: {
        active: active.map((entry) => ({
          competence: entry.competence.toISOString().slice(0, 10),
          aethosCompanyId: entry.aethosCompanyId,
          aethosItemId: entry.aethosItemId,
          quantityUnit: entry.quantityUnit,
          closingQuantity: entry.closingQuantity.toFixed(6),
          closingAverageCost: entry.closingAverageCost?.toFixed(6) ?? null,
        })),
        lastRun,
      },
    };
  }
}
