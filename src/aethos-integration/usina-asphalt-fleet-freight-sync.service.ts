import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_ASPHALT_FLEET_FREIGHT_DATASET } from '../usina-asphalt-teams/usina-asphalt-team-fleet.rules';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';
import { expireStaleUsinaSyncRuns } from './usina-sync-run-policy';
import {
  normalizeUsinaAsphaltFleetFreightEnvelope,
  normalizeUsinaAsphaltFleetFreightRows,
  NormalizedAsphaltFleetFreightRow,
} from './usina-asphalt-fleet-freight-sync.rules';

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
}

function factData(
  row: NormalizedAsphaltFleetFreightRow,
  runId: string,
  now: Date,
) {
  return {
    companyId: USINA_COMPANY_ID,
    unitId: USINA_UNIT_ID,
    source: row.source,
    dataset: row.dataset,
    sourceRecordId: row.sourceRecordId,
    sourceKind: row.sourceKind,
    sourceDocumentId: row.sourceDocumentId,
    sourceInstallmentId: row.sourceInstallmentId,
    occurredAt: row.occurredAt,
    occurredDate: row.occurredDate,
    competence: row.competence,
    aethosVehicleId: row.aethosVehicleId,
    fleetNumber: row.fleetNumber,
    plate: row.plate,
    freightTypeId: row.freightTypeId,
    principalItemId: row.principalItemId,
    freightTypeDescription: row.freightTypeDescription,
    quantity: row.quantity,
    unit: row.unit,
    amount: row.amount,
    sourceStatus: row.sourceStatus,
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
export class UsinaAsphaltFleetFreightSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRunContract(
    run: any,
    envelope: ReturnType<typeof normalizeUsinaAsphaltFleetFreightEnvelope>,
  ) {
    const same =
      run.syncMode === envelope.syncMode &&
      run.generatedAt.toISOString() === envelope.generatedAt.toISOString() &&
      run.scopeCompanyId === envelope.scope.company &&
      run.scopeUnitId === envelope.scope.unit &&
      run.scopeDateFrom.toISOString().slice(0, 10) ===
        envelope.scope.dateFrom.toISOString().slice(0, 10) &&
      run.scopeDateTo.toISOString().slice(0, 10) ===
        envelope.scope.dateTo.toISOString().slice(0, 10);
    if (!same) {
      throw new BadRequestException('syncRunId ja utilizado com outro contrato ou scope');
    }
  }

  private async reconciliation(tx: Prisma.TransactionClient, envelope: any) {
    const grouped = await tx.usinaAsphaltFleetFreightFact.groupBy({
      by: ['competence'],
      where: {
        companyId: USINA_COMPANY_ID,
        unitId: USINA_UNIT_ID,
        dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET,
        occurredDate: {
          gte: envelope.scope.dateFrom,
          lte: envelope.scope.dateTo,
        },
        active: true,
      },
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { competence: 'asc' },
    });
    return grouped.map((entry) => ({
      competence: entry.competence.toISOString().slice(0, 10),
      documents: entry._count._all,
      amount: entry._sum.amount?.toFixed(6) ?? '0.000000',
    }));
  }

  async sync(body: unknown) {
    const envelope = normalizeUsinaAsphaltFleetFreightEnvelope(body);
    const payloadHash = hashCanonicalValue(body);
    await expireStaleUsinaSyncRuns(this.prisma, [
      USINA_ASPHALT_FLEET_FREIGHT_DATASET,
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
            if (replay.payloadHash !== payloadHash) {
              throw new BadRequestException(
                'batchNumber ja processado com outro payload',
              );
            }
            return { ...(replay.response as Record<string, unknown>), replayed: true };
          }
          if (run.status !== 'IN_PROGRESS') {
            throw new BadRequestException(`syncRunId ${run.status.toLowerCase()}`);
          }
          if (envelope.batchNumber !== (run.lastBatchNumber || 0) + 1) {
            throw new BadRequestException(
              `Proximo batchNumber esperado: ${(run.lastBatchNumber || 0) + 1}`,
            );
          }
        } else {
          if (envelope.batchNumber !== 1) {
            throw new BadRequestException('O primeiro lote deve usar batchNumber 1');
          }
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
              scopeMetadata: {
                sourceProcedure: 'PROC_REL_GERENCIAMENTO_FRETE',
                sourceBlock: 'FATURAMENTO',
              },
            },
          });
        }

        const normalized = normalizeUsinaAsphaltFleetFreightRows(
          envelope.rows,
          envelope.scope,
        );
        const now = new Date();
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
          const existing = await tx.usinaAsphaltFleetFreightFact.findUnique({
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
            const created = await tx.usinaAsphaltFleetFreightFact.create({ data });
            await tx.usinaAsphaltFleetFreightFactAudit.create({
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
            await tx.usinaAsphaltFleetFreightFact.update({
              where: { id: existing.id },
              data: { lastSeenRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const updated = await tx.usinaAsphaltFleetFreightFact.update({
              where: { id: existing.id },
              data,
            });
            await tx.usinaAsphaltFleetFreightFactAudit.create({
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
          const stale = await tx.usinaAsphaltFleetFreightFact.findMany({
            where: {
              companyId: envelope.scope.company,
              unitId: envelope.scope.unit,
              source: 'AETHOS',
              dataset: envelope.dataset,
              occurredDate: {
                gte: envelope.scope.dateFrom,
                lte: envelope.scope.dateTo,
              },
              active: true,
              OR: [{ lastSeenRunId: null }, { lastSeenRunId: { not: run.id } }],
            },
          });
          for (const existing of stale) {
            const updated = await tx.usinaAsphaltFleetFreightFact.update({
              where: { id: existing.id },
              data: {
                active: false,
                deactivatedAt: now,
                deactivationReason: `ABSENT_FROM_FULL:${envelope.syncRunId}`,
                syncedAt: now,
              },
            });
            await tx.usinaAsphaltFleetFreightFactAudit.create({
              data: {
                factId: existing.id,
                operation: 'DEACTIVATE',
                syncRunId: envelope.syncRunId,
                beforeData: snapshot(existing),
                afterData: snapshot(updated),
              },
            });
          }
          deactivated += stale.length;
        }

        const finalized = envelope.isLastBatch;
        const reconciliation = await this.reconciliation(tx, envelope);
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
      USINA_ASPHALT_FLEET_FREIGHT_DATASET,
    ]);
    const [activeFacts, lastRun, lastFact] = await Promise.all([
      this.prisma.usinaAsphaltFleetFreightFact.count({ where: { active: true } }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.usinaAsphaltFleetFreightFact.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
    ]);
    return {
      usinaAsphaltFleetFreightsEndpoint:
        '/integrations/aethos/usina/asphalt-team-fleet-freights/sync',
      asphaltTeamFleetFreights: {
        activeFacts,
        lastSyncAt: lastFact?.syncedAt ?? null,
        lastRun,
      },
    };
  }
}
