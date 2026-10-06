import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashCanonicalValue, USINA_COMPANY_ID, USINA_UNIT_ID } from './usina-production-sync.rules';
import {
  normalizeUsinaMaterialExceptionEnvelope,
  normalizeUsinaMaterialExceptionRows,
  NormalizedMaterialExceptionRow,
  USINA_MATERIAL_EXCEPTION_DATASET,
} from './usina-material-receipt-exception-sync.rules';
import { expireStaleUsinaSyncRuns } from './usina-sync-run-policy';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry));
}

function factData(row: NormalizedMaterialExceptionRow, runId: string, now: Date) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    dataset: row.dataset,
    sourceRecordId: row.sourceRecordId,
    sourceTicketId: row.sourceTicketId,
    sourceVehicleWeighingId: row.sourceVehicleWeighingId,
    occurredAt: row.occurredAt,
    occurredDate: row.occurredDate,
    competence: row.competence,
    finalizedAt: row.finalizedAt,
    plate: row.plate,
    sourcePartyId: row.sourcePartyId,
    sourcePartyName: row.sourcePartyName,
    aethosItemId: row.aethosItemId,
    itemDescription: row.itemDescription,
    materialClass: row.materialClass,
    quantityOriginal: row.quantityOriginal,
    quantityUnit: row.quantityUnit,
    sourceDirection: row.sourceDirection,
    reasonCode: row.reasonCode,
    reason: row.reason,
    correlatedEntryId: row.correlatedEntryId,
    correlatedEntryItemId: row.correlatedEntryItemId,
    correlatedFreightTypeId: row.correlatedFreightTypeId,
    correlatedEntryQuantityOriginal: row.correlatedEntryQuantityOriginal,
    correlatedEntryQuantityUnit: row.correlatedEntryQuantityUnit,
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
export class UsinaMaterialReceiptExceptionSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRunContract(run: any, envelope: ReturnType<typeof normalizeUsinaMaterialExceptionEnvelope>) {
    const expectedMetadata = hashCanonicalValue({
      materialClass: envelope.scope.materialClass,
      sourcePartyId: envelope.scope.sourcePartyId,
    });
    const metadata = run.scopeMetadata as { hash?: string } | null;
    const same = run.syncMode === envelope.syncMode
      && run.generatedAt.toISOString() === envelope.generatedAt.toISOString()
      && run.scopeCompanyId === USINA_COMPANY_ID
      && run.scopeUnitId === USINA_UNIT_ID
      && run.scopeDateFrom.toISOString().slice(0, 10) === envelope.scope.dateFrom.toISOString().slice(0, 10)
      && run.scopeDateTo.toISOString().slice(0, 10) === envelope.scope.dateTo.toISOString().slice(0, 10)
      && metadata?.hash === expectedMetadata;
    if (!same) throw new BadRequestException('syncRunId ja utilizado com outro contrato ou scope');
  }

  async sync(body: unknown) {
    const envelope = normalizeUsinaMaterialExceptionEnvelope(body);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [USINA_MATERIAL_EXCEPTION_DATASET]);
    return this.prisma.$transaction(async (tx) => {
      let run = await tx.usinaSyncRun.findUnique({
        where: { dataset_syncRunId: { dataset: envelope.dataset, syncRunId: envelope.syncRunId } },
      });
      if (run) {
        this.assertRunContract(run, envelope);
        const replay = await tx.usinaSyncBatch.findUnique({
          where: { runId_batchNumber: { runId: run.id, batchNumber: envelope.batchNumber } },
        });
        if (replay) {
          if (replay.payloadHash !== payloadHash) throw new BadRequestException('batchNumber ja processado com outro payload');
          return { ...(replay.response as Record<string, unknown>), replayed: true };
        }
        if (run.status !== 'IN_PROGRESS') throw new BadRequestException(`syncRunId ${run.status.toLowerCase()}`);
        if (envelope.batchNumber !== (run.lastBatchNumber || 0) + 1)
          throw new BadRequestException(`Proximo batchNumber esperado: ${(run.lastBatchNumber || 0) + 1}`);
      } else {
        if (envelope.batchNumber !== 1) throw new BadRequestException('O primeiro lote deve usar batchNumber 1');
        run = await tx.usinaSyncRun.create({ data: {
          dataset: envelope.dataset,
          syncRunId: envelope.syncRunId,
          syncMode: envelope.syncMode,
          generatedAt: envelope.generatedAt,
          scopeCompanyId: USINA_COMPANY_ID,
          scopeUnitId: USINA_UNIT_ID,
          scopeDateFrom: envelope.scope.dateFrom,
          scopeDateTo: envelope.scope.dateTo,
          scopeMetadata: {
            materialClass: envelope.scope.materialClass,
            sourcePartyId: envelope.scope.sourcePartyId,
            hash: hashCanonicalValue({ materialClass: envelope.scope.materialClass, sourcePartyId: envelope.scope.sourcePartyId }),
          },
        } });
      }

      const now = new Date();
      const normalized = normalizeUsinaMaterialExceptionRows(envelope.rows, envelope);
      if (normalized.rejected.length) {
        const failureReason = `${normalized.rejected.length} linha(s) rejeitada(s) no lote ${envelope.batchNumber}`;
        const response = {
          ok: false, dataset: envelope.dataset, syncRunId: envelope.syncRunId, batchNumber: envelope.batchNumber,
          received: envelope.rows.length, accepted: normalized.accepted.length, applied: 0, upserted: 0,
          unchanged: 0, rejected: normalized.rejected.length, deactivated: 0,
          rejectedRows: normalized.rejected, finalized: false, failed: true, runStatus: 'FAILED',
          failureReason, reconciliation: [], replayed: false,
        };
        await tx.usinaSyncBatch.create({ data: {
          runId: run.id, batchNumber: envelope.batchNumber, payloadHash,
          receivedCount: envelope.rows.length, acceptedCount: normalized.accepted.length,
          upsertedCount: 0, unchangedCount: 0, rejectedCount: normalized.rejected.length,
          deactivatedCount: 0, response: response as unknown as Prisma.InputJsonValue,
        } });
        await tx.usinaSyncRun.update({ where: { id: run.id }, data: {
          status: 'FAILED', receivedCount: { increment: envelope.rows.length },
          acceptedCount: { increment: normalized.accepted.length }, rejectedCount: { increment: normalized.rejected.length },
          lastBatchNumber: envelope.batchNumber, failedAt: now, failureReason,
        } });
        return response;
      }

      let upserted = 0;
      let unchanged = 0;
      let deactivated = 0;
      for (const row of normalized.accepted) {
        const existing = await tx.usinaMaterialReceiptException.findUnique({
          where: { source_sourceRecordId: { source: row.source, sourceRecordId: row.sourceRecordId } },
        });
        const data = factData(row, run.id, now);
        if (!existing) {
          const created = await tx.usinaMaterialReceiptException.create({ data });
          await tx.usinaMaterialReceiptExceptionAudit.create({ data: {
            exceptionId: created.id, operation: 'CREATE', syncRunId: envelope.syncRunId, afterData: snapshot(created),
          } });
          upserted += 1;
          if (!row.active) deactivated += 1;
        } else if (existing.contentHash === row.contentHash && existing.active === row.active) {
          await tx.usinaMaterialReceiptException.update({ where: { id: existing.id }, data: { lastSeenRunId: run.id, syncedAt: now } });
          unchanged += 1;
        } else {
          const updated = await tx.usinaMaterialReceiptException.update({ where: { id: existing.id }, data });
          await tx.usinaMaterialReceiptExceptionAudit.create({ data: {
            exceptionId: existing.id, operation: row.active ? 'UPDATE' : 'DEACTIVATE', syncRunId: envelope.syncRunId,
            beforeData: snapshot(existing), afterData: snapshot(updated),
          } });
          upserted += 1;
          if (existing.active && !row.active) deactivated += 1;
        }
      }

      if (envelope.isLastBatch) {
        const stale = await tx.usinaMaterialReceiptException.findMany({ where: {
          companyId: USINA_COMPANY_ID, unitId: USINA_UNIT_ID, source: 'AETHOS', dataset: envelope.dataset,
          sourcePartyId: envelope.scope.sourcePartyId, materialClass: envelope.scope.materialClass,
          occurredDate: { gte: envelope.scope.dateFrom, lte: envelope.scope.dateTo }, active: true,
          OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
        } });
        for (const existing of stale) {
          const updated = await tx.usinaMaterialReceiptException.update({ where: { id: existing.id }, data: {
            active: false, deactivatedAt: now, deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`, syncedAt: now,
          } });
          await tx.usinaMaterialReceiptExceptionAudit.create({ data: {
            exceptionId: existing.id, operation: 'DEACTIVATE', syncRunId: envelope.syncRunId,
            beforeData: snapshot(existing), afterData: snapshot(updated),
          } });
        }
        deactivated += stale.length;
      }

      const grouped = await tx.usinaMaterialReceiptException.groupBy({
        by: ['reasonCode'],
        where: {
          companyId: USINA_COMPANY_ID, unitId: USINA_UNIT_ID, source: 'AETHOS', dataset: envelope.dataset,
          sourcePartyId: envelope.scope.sourcePartyId, materialClass: envelope.scope.materialClass,
          occurredDate: { gte: envelope.scope.dateFrom, lte: envelope.scope.dateTo }, active: true,
        },
        _count: { _all: true }, _sum: { quantityOriginal: true }, orderBy: { reasonCode: 'asc' },
      });
      const finalized = envelope.isLastBatch;
      const response = {
        ok: true, dataset: envelope.dataset, syncRunId: envelope.syncRunId, batchNumber: envelope.batchNumber,
        received: envelope.rows.length, accepted: normalized.accepted.length, applied: normalized.accepted.length,
        upserted, unchanged, rejected: 0, deactivated, rejectedRows: [], finalized, failed: false,
        runStatus: finalized ? 'COMPLETED' : 'IN_PROGRESS', failureReason: null,
        reconciliation: grouped.map((entry) => ({
          reasonCode: entry.reasonCode, count: entry._count._all,
          quantityOriginal: entry._sum.quantityOriginal?.toFixed(6) ?? null,
        })), replayed: false,
      };
      await tx.usinaSyncBatch.create({ data: {
        runId: run.id, batchNumber: envelope.batchNumber, payloadHash,
        receivedCount: envelope.rows.length, acceptedCount: normalized.accepted.length,
        upsertedCount: upserted, unchangedCount: unchanged, rejectedCount: 0, deactivatedCount: deactivated,
        response: response as unknown as Prisma.InputJsonValue,
      } });
      await tx.usinaSyncRun.update({ where: { id: run.id }, data: {
        status: finalized ? 'COMPLETED' : 'IN_PROGRESS', receivedCount: { increment: envelope.rows.length },
        acceptedCount: { increment: normalized.accepted.length }, upsertedCount: { increment: upserted },
        unchangedCount: { increment: unchanged }, deactivatedCount: { increment: deactivated },
        lastBatchNumber: envelope.batchNumber, completedAt: finalized ? now : null, failedAt: null, failureReason: null,
      } });
      return response;
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  async status() {
    await expireStaleUsinaSyncRuns(this.prisma, [USINA_MATERIAL_EXCEPTION_DATASET]);
    const [active, lastRun] = await Promise.all([
      this.prisma.usinaMaterialReceiptException.groupBy({
        by: ['reasonCode'], where: { active: true }, _count: { _all: true }, _sum: { quantityOriginal: true },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: USINA_MATERIAL_EXCEPTION_DATASET }, orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { materialReceiptExceptions: {
      active: active.map((entry) => ({ reasonCode: entry.reasonCode, count: entry._count._all, quantityOriginal: entry._sum.quantityOriginal?.toFixed(6) ?? null })),
      lastRun,
    } };
  }
}
