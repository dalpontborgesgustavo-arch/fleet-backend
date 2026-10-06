import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashCanonicalValue, USINA_COMPANY_ID, USINA_UNIT_ID } from './usina-production-sync.rules';
import {
  normalizeUsinaMaterialEnvelope,
  normalizeUsinaMaterialRows,
  NormalizedMaterialRow,
  USINA_MATERIAL_DATASETS,
} from './usina-material-receipt-sync.rules';
import { expireStaleUsinaSyncRuns } from './usina-sync-run-policy';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function factData(row: NormalizedMaterialRow, runId: string, now: Date) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    dataset: row.dataset,
    sourceRecordId: row.sourceRecordId,
    sourceDocumentId: row.sourceDocumentId,
    sourceLineId: row.sourceLineId,
    sourceFreightTypeId: row.sourceFreightTypeId,
    aethosMaterialId: row.aethosMaterialId,
    materialDescription: row.materialDescription,
    materialClass: row.materialClass,
    reportingFamily: row.reportingFamily,
    movementType: row.movementType,
    occurredAt: row.occurredAt,
    occurredDate: row.occurredDate,
    competence: row.competence,
    quantityOriginal: row.quantityOriginal,
    quantityUnit: row.quantityUnit,
    quantityTon: row.quantityTon,
    materialUnitCost: row.materialUnitCost,
    materialAmount: row.materialAmount,
    freightQuantity: row.freightQuantity,
    freightUnitCost: row.freightUnitCost,
    freightAmount: row.freightAmount,
    totalAmount: row.totalAmount,
    sourceUsedQuantity: row.sourceUsedQuantity,
    sourceBalanceQuantity: row.sourceBalanceQuantity,
    sourceDiscountAmount: row.sourceDiscountAmount,
    aethosCompanyId: row.aethosCompanyId,
    supplierId: row.supplierId,
    documentPartyId: row.documentPartyId,
    physicalSourcePartyId: row.physicalSourcePartyId,
    sourceTicketId: row.sourceTicketId,
    entryExitFlag: row.entryExitFlag,
    sourceStatus: row.sourceStatus,
    tareTon: row.tareTon,
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
export class UsinaMaterialReceiptSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRunContract(
    run: any,
    envelope: ReturnType<typeof normalizeUsinaMaterialEnvelope>,
  ) {
    const same =
      run.syncMode === envelope.syncMode &&
      run.generatedAt.toISOString() === envelope.generatedAt.toISOString() &&
      run.scopeCompanyId === envelope.scope.company &&
      run.scopeUnitId === envelope.scope.unit &&
      run.scopeDateFrom.toISOString().slice(0, 10) === envelope.scope.dateFrom.toISOString().slice(0, 10) &&
      run.scopeDateTo.toISOString().slice(0, 10) === envelope.scope.dateTo.toISOString().slice(0, 10);
    if (!same)
      throw new BadRequestException('syncRunId ja utilizado com outro modo, data de geracao ou scope');
  }

  async sync(body: unknown) {
    const envelope = normalizeUsinaMaterialEnvelope(body);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [envelope.dataset]);

    return this.prisma.$transaction(
      async (tx) => {
        let run = await tx.usinaSyncRun.findUnique({
          where: { dataset_syncRunId: { dataset: envelope.dataset, syncRunId: envelope.syncRunId } },
        });
        if (run) {
          this.assertRunContract(run, envelope);
          const replay = await tx.usinaSyncBatch.findUnique({
            where: { runId_batchNumber: { runId: run.id, batchNumber: envelope.batchNumber } },
          });
          if (replay) {
            if (replay.payloadHash !== payloadHash)
              throw new BadRequestException('batchNumber ja processado com outro payload');
            return { ...(replay.response as Record<string, unknown>), replayed: true };
          }
          if (run.status === 'COMPLETED')
            throw new BadRequestException('syncRunId ja foi finalizado');
          if (run.status === 'FAILED')
            throw new BadRequestException('syncRunId falhou; inicie a correcao com um novo syncRunId');
          const expectedBatch = (run.lastBatchNumber || 0) + 1;
          if (envelope.batchNumber !== expectedBatch)
            throw new BadRequestException(`Proximo batchNumber esperado: ${expectedBatch}`);
        } else {
          if (envelope.batchNumber !== 1)
            throw new BadRequestException('O primeiro lote do syncRunId deve usar batchNumber 1');
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
        const normalized = normalizeUsinaMaterialRows(envelope.rows, envelope);
        if (normalized.rejected.length > 0) {
          const failureReason = `${normalized.rejected.length} linha(s) rejeitada(s) no lote ${envelope.batchNumber}`;
          const response = {
            ok: false,
            dataset: envelope.dataset,
            syncRunId: envelope.syncRunId,
            batchNumber: envelope.batchNumber,
            syncMode: envelope.syncMode,
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
              completedAt: null,
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
          const existing = await tx.usinaMaterialReceiptFact.findUnique({
            where: {
              source_dataset_sourceRecordId: {
                source: row.source,
                dataset: row.dataset,
                sourceRecordId: row.sourceRecordId,
              },
            },
          });
          const data = factData(row, run.id, now);
          if (!existing) {
            const created = await tx.usinaMaterialReceiptFact.create({ data });
            await tx.usinaMaterialReceiptFactAudit.create({
              data: {
                factId: created.id,
                operation: row.active ? 'CREATE' : 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                afterData: snapshot(created),
              },
            });
            upserted += 1;
            if (!row.active) explicitDeactivated += 1;
            continue;
          }
          if (existing.contentHash === row.contentHash && existing.active === row.active) {
            await tx.usinaMaterialReceiptFact.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
            continue;
          }
          const updated = await tx.usinaMaterialReceiptFact.update({
            where: { id: existing.id },
            data,
          });
          await tx.usinaMaterialReceiptFactAudit.create({
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

        let absentDeactivated = 0;
        if (envelope.isLastBatch && envelope.syncMode === 'full') {
          const stale = await tx.usinaMaterialReceiptFact.findMany({
            where: {
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              source: 'AETHOS',
              dataset: envelope.dataset,
              occurredDate: { gte: envelope.scope.dateFrom, lte: envelope.scope.dateTo },
              active: true,
              OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
            },
          });
          for (const existing of stale) {
            const updated = await tx.usinaMaterialReceiptFact.update({
              where: { id: existing.id },
              data: {
              active: false,
              deactivatedAt: now,
              deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`,
              syncedAt: now,
              },
            });
            await tx.usinaMaterialReceiptFactAudit.create({
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
        const grouped = await tx.usinaMaterialReceiptFact.groupBy({
          by: ['competence', 'materialClass', 'movementType'],
          where: {
            companyId: envelope.scope.company,
            unitId: envelope.scope.unit,
            source: 'AETHOS',
            dataset: envelope.dataset,
            occurredDate: { gte: envelope.scope.dateFrom, lte: envelope.scope.dateTo },
            active: true,
          },
          _count: { _all: true },
          _sum: {
            quantityTon: true,
            materialAmount: true,
            freightAmount: true,
            totalAmount: true,
          },
          orderBy: [{ competence: 'asc' }, { materialClass: 'asc' }, { movementType: 'asc' }],
        });
        const reconciliation = grouped.map((entry: any) => ({
          competence: entry.competence.toISOString().slice(0, 10),
          materialClass: entry.materialClass,
          movementType: entry.movementType,
          count: entry._count._all,
          quantityTon: entry._sum.quantityTon?.toFixed(6) ?? null,
          materialAmount: entry._sum.materialAmount?.toFixed(6) ?? null,
          freightAmount: entry._sum.freightAmount?.toFixed(6) ?? null,
          totalAmount: entry._sum.totalAmount?.toFixed(6) ?? null,
        }));
        const finalized = envelope.isLastBatch;
        const response = {
          ok: true,
          dataset: envelope.dataset,
          syncRunId: envelope.syncRunId,
          batchNumber: envelope.batchNumber,
          syncMode: envelope.syncMode,
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
    await expireStaleUsinaSyncRuns(this.prisma, USINA_MATERIAL_DATASETS);
    const [counts, lastRuns] = await Promise.all([
      this.prisma.usinaMaterialReceiptFact.groupBy({
        by: ['dataset'],
        where: { active: true },
        _count: { _all: true },
        _sum: { quantityTon: true, materialAmount: true, freightAmount: true, totalAmount: true },
      }),
      Promise.all(
        USINA_MATERIAL_DATASETS.map((dataset) =>
          this.prisma.usinaSyncRun.findFirst({
            where: { dataset },
            orderBy: { createdAt: 'desc' },
            select: {
              dataset: true,
              syncRunId: true,
              syncMode: true,
              status: true,
              generatedAt: true,
              scopeDateFrom: true,
              scopeDateTo: true,
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
      materialReceipts: {
        active: counts.map((entry: any) => ({
          dataset: entry.dataset,
          count: entry._count._all,
          quantityTon: entry._sum.quantityTon?.toFixed(6) ?? null,
          materialAmount: entry._sum.materialAmount?.toFixed(6) ?? null,
          freightAmount: entry._sum.freightAmount?.toFixed(6) ?? null,
          totalAmount: entry._sum.totalAmount?.toFixed(6) ?? null,
        })),
        lastRuns,
      },
    };
  }
}
