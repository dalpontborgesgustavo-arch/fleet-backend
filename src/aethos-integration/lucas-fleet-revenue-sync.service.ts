import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LUCAS_FLEET_REVENUE_DATASET,
  LUCAS_FLEET_REVENUE_SOURCE,
  LucasFleetRevenueDecimal,
  lucasFleetRevenueDatasetHash,
  normalizeLucasFleetRevenueBatch,
  normalizeLucasFleetRevenueFinalize,
  reconcileLucasFleetRevenueAggregates,
} from './lucas-fleet-revenue-sync.rules';
import { hashCanonicalValue } from './usina-production-sync.rules';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'bigint') return entry.toString();
      if (entry instanceof Prisma.Decimal) return entry.toString();
      if (entry instanceof Date) return entry.toISOString();
      return entry;
    }),
  ) as Prisma.InputJsonValue;
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((entry, index) => entry === [...right].sort()[index])
  );
}

@Injectable()
export class LucasFleetRevenueSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRunContract(
    run: any,
    envelope: ReturnType<typeof normalizeLucasFleetRevenueBatch>,
  ) {
    const matches =
      run.schemaVersion === envelope.schemaVersion &&
      run.dataset === envelope.dataset &&
      run.source === envelope.source &&
      run.ruleVersion === envelope.ruleVersion &&
      run.ruleHash === envelope.ruleHash &&
      run.mode === envelope.mode &&
      run.generatedAt.getTime() === envelope.generatedAt.getTime() &&
      run.scopeDateFrom.getTime() === envelope.scope.dateFrom.getTime() &&
      run.scopeDateToExclusive.getTime() ===
        envelope.scope.dateToExclusive.getTime() &&
      sameStrings(run.scopeBranches, envelope.scope.branches) &&
      sameStrings(run.scopeCompanies, envelope.scope.companies) &&
      hashCanonicalValue(run.scopeMetadata) ===
        hashCanonicalValue(envelope.scope.metadata) &&
      run.snapshotStartedAt.getTime() ===
        envelope.snapshot.startedAt.getTime() &&
      run.snapshotFinishedAt.getTime() ===
        envelope.snapshot.finishedAt.getTime() &&
      run.snapshotComplete === envelope.snapshot.complete &&
      run.dryRun === envelope.dryRun &&
      run.allowedForPosting === envelope.allowedForPosting &&
      run.batchTotal === envelope.batch.total;
    if (!matches) {
      throw new BadRequestException(
        'runId reutilizado com outro contrato, regra, snapshot ou scope',
      );
    }
  }

  async sync(body: unknown) {
    const envelope = normalizeLucasFleetRevenueBatch(body);
    const serverPayloadHash = hashCanonicalValue(body);
    return this.prisma.$transaction(
      async (tx) => {
        let run = await tx.lucasFleetRevenueSyncRun.findUnique({
          where: {
            dataset_runId: {
              dataset: envelope.dataset,
              runId: envelope.runId,
            },
          },
        });

        if (run) {
          this.assertRunContract(run, envelope);
          const replay = await tx.lucasFleetRevenueSyncBatch.findUnique({
            where: {
              runDbId_batchNumber: {
                runDbId: run.id,
                batchNumber: envelope.batch.number,
              },
            },
          });
          if (replay) {
            if (replay.serverPayloadHash !== serverPayloadHash) {
              throw new BadRequestException(
                'batch.number ja processado com outro payload',
              );
            }
            return {
              ...(replay.response as Record<string, unknown>),
              replayed: true,
            };
          }
          if (run.status !== 'IN_PROGRESS') {
            throw new BadRequestException(`runId ${run.status.toLowerCase()}`);
          }
          const expectedBatch = run.receivedBatchCount + 1;
          if (envelope.batch.number !== expectedBatch) {
            throw new BadRequestException(
              `Proximo batch.number esperado: ${expectedBatch}`,
            );
          }
        } else {
          if (envelope.batch.number !== 1) {
            throw new BadRequestException(
              'O primeiro lote deve usar batch.number 1',
            );
          }
          run = await tx.lucasFleetRevenueSyncRun.create({
            data: {
              runId: envelope.runId,
              schemaVersion: envelope.schemaVersion,
              dataset: envelope.dataset,
              source: envelope.source,
              ruleVersion: envelope.ruleVersion,
              ruleHash: envelope.ruleHash,
              mode: envelope.mode,
              generatedAt: envelope.generatedAt,
              scopeDateFrom: envelope.scope.dateFrom,
              scopeDateToExclusive: envelope.scope.dateToExclusive,
              scopeBranches: envelope.scope.branches,
              scopeCompanies: envelope.scope.companies,
              scopeMetadata: envelope.scope.metadata,
              snapshotStartedAt: envelope.snapshot.startedAt,
              snapshotFinishedAt: envelope.snapshot.finishedAt,
              snapshotComplete: envelope.snapshot.complete,
              dryRun: envelope.dryRun,
              allowedForPosting: envelope.allowedForPosting,
              batchTotal: envelope.batch.total,
            },
          });
        }

        const locators = envelope.records.map((record) => record.nativeLocator);
        if (locators.length) {
          const existing = await tx.lucasFleetRevenueStagingFact.findFirst({
            where: { runDbId: run.id, nativeLocator: { in: locators } },
            select: { nativeLocator: true },
          });
          if (existing) {
            throw new BadRequestException(
              `nativeLocator repetido entre lotes: ${existing.nativeLocator}`,
            );
          }
        }

        if (envelope.records.length) {
          await tx.lucasFleetRevenueStagingFact.createMany({
            data: envelope.records.map((record) => ({
              runDbId: run!.id,
              nativeLocator: record.nativeLocator,
              sourceKind: record.sourceKind,
              nativeKey: record.nativeKey,
              companyId: record.companyId,
              sourceKey: record.sourceKey,
              aethosVehicleId: record.aethosVehicleId,
              eventDate: record.eventDate,
              competence: record.competence,
              amount: record.amount,
              sourceStatus: record.sourceStatus,
              active: record.active,
              sourceUpdatedAt: record.sourceUpdatedAt,
              planAccountId:
                record.planAccountId === null
                  ? null
                  : String(record.planAccountId),
              recordHash: record.recordHash,
              raw: record.raw,
            })),
          });
        }

        const response = {
          ok: true,
          schemaVersion: envelope.schemaVersion,
          dataset: envelope.dataset,
          runId: envelope.runId,
          batchNumber: envelope.batch.number,
          batchTotal: envelope.batch.total,
          accepted: envelope.records.length,
          staged: envelope.records.length,
          finalized: false,
          runStatus: 'IN_PROGRESS',
          producerPayloadHash: envelope.batch.payloadHash,
          serverPayloadHash,
          replayed: false,
        };
        await tx.lucasFleetRevenueSyncBatch.create({
          data: {
            runDbId: run.id,
            batchNumber: envelope.batch.number,
            batchTotal: envelope.batch.total,
            producerPayloadHash: envelope.batch.payloadHash,
            serverPayloadHash,
            recordCount: envelope.records.length,
            response: json(response),
          },
        });
        await tx.lucasFleetRevenueSyncRun.update({
          where: { id: run.id },
          data: {
            receivedBatchCount: { increment: 1 },
            receivedRecordCount: { increment: envelope.records.length },
          },
        });
        return response;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private async computedManifest(runDbId: string) {
    const rows = await this.prisma.lucasFleetRevenueStagingFact.findMany({
      where: { runDbId },
      orderBy: { nativeLocator: 'asc' },
      select: {
        nativeLocator: true,
        recordHash: true,
        amount: true,
        competence: true,
        sourceKind: true,
        companyId: true,
        aethosVehicleId: true,
        raw: true,
      },
    });
    const amountTotal = rows.reduce(
      (sum, row) =>
        row.amount === null ? sum : sum.add(row.amount.toString()),
      new LucasFleetRevenueDecimal(0),
    );
    return {
      recordCount: rows.length,
      uniqueNativeLocatorCount: new Set(rows.map((row) => row.nativeLocator))
        .size,
      nullAmountCount: rows.filter((row) => row.amount === null).length,
      duplicateNativeLocatorCount:
        rows.length - new Set(rows.map((row) => row.nativeLocator)).size,
      pendingCount: rows.filter((row) => {
        const raw = row.raw as Record<string, unknown> | null;
        return (
          Array.isArray(raw?.pendingReasons) && raw.pendingReasons.length > 0
        );
      }).length,
      amountTotal,
      datasetHash: lucasFleetRevenueDatasetHash(rows),
      rows,
    };
  }

  async finalize(runId: string, body: unknown) {
    const request = normalizeLucasFleetRevenueFinalize(body);
    if (request.runId !== runId) {
      throw new BadRequestException('runId da URL diverge do payload');
    }
    const run = await this.prisma.lucasFleetRevenueSyncRun.findUnique({
      where: { runId },
      include: { batches: { orderBy: { batchNumber: 'asc' } } },
    });
    if (!run) throw new NotFoundException('runId nao encontrado');
    if (
      run.schemaVersion !== request.schemaVersion ||
      run.dataset !== request.dataset ||
      run.source !== request.source ||
      run.ruleVersion !== request.ruleVersion ||
      run.ruleHash !== request.ruleHash ||
      run.mode !== request.mode ||
      run.generatedAt.getTime() !== request.generatedAt.getTime() ||
      hashCanonicalValue(run.scopeMetadata) !==
        hashCanonicalValue(request.scope) ||
      run.snapshotStartedAt.getTime() !==
        request.snapshot.startedAt.getTime() ||
      run.snapshotFinishedAt.getTime() !==
        request.snapshot.finishedAt.getTime() ||
      run.snapshotComplete !== request.snapshot.complete ||
      request.batches.length !== run.batchTotal ||
      request.batches.some(
        (batch, index) =>
          batch.number !== run.batches[index]?.batchNumber ||
          batch.total !== run.batches[index]?.batchTotal ||
          batch.recordCount !== run.batches[index]?.recordCount ||
          batch.payloadHash !== run.batches[index]?.producerPayloadHash,
      )
    ) {
      throw new BadRequestException('Contrato de finalizacao diverge do run');
    }
    if (run.status === 'COMPLETED') {
      if (
        hashCanonicalValue(run.manifest) !==
        hashCanonicalValue(request.manifest.raw)
      ) {
        throw new BadRequestException(
          'Manifesto diverge da finalizacao anterior',
        );
      }
      return this.readback(runId, true);
    }
    if (run.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`runId ${run.status.toLowerCase()}`);
    }
    if (!run.snapshotComplete || run.dryRun || !run.allowedForPosting) {
      throw new BadRequestException('run nao autorizado para finalizacao');
    }
    if (
      run.receivedBatchCount !== run.batchTotal ||
      run.batches.length !== run.batchTotal
    ) {
      throw new BadRequestException('Nem todos os lotes foram recebidos');
    }
    run.batches.forEach((batch, index) => {
      if (
        batch.batchNumber !== index + 1 ||
        batch.batchTotal !== run.batchTotal
      ) {
        throw new BadRequestException(
          'Sequencia de lotes incompleta ou inconsistente',
        );
      }
    });

    const computed = await this.computedManifest(run.id);
    const manifest = request.manifest;
    const scopeMetadata = run.scopeMetadata as Record<string, unknown>;
    const recheckedNativeLocators = Array.isArray(
      scopeMetadata.recheckedNativeLocators,
    )
      ? scopeMetadata.recheckedNativeLocators.map(String)
      : [];
    if (
      manifest.missingRecheckedNativeLocators.some(
        (locator) => !recheckedNativeLocators.includes(locator),
      )
    ) {
      throw new BadRequestException(
        'Manifesto tenta desativar nativeLocator que nao foi relido no scope',
      );
    }
    const mismatches: string[] = [];
    if (manifest.recordCount !== computed.recordCount)
      mismatches.push('recordCount');
    if (
      manifest.uniqueNativeLocatorCount !== computed.uniqueNativeLocatorCount
    ) {
      mismatches.push('uniqueNativeLocatorCount');
    }
    if (manifest.nullAmountCount !== computed.nullAmountCount)
      mismatches.push('nullAmountCount');
    if (manifest.pendingCount !== computed.pendingCount)
      mismatches.push('pendingCount');
    if (
      manifest.duplicateNativeLocatorCount !==
      computed.duplicateNativeLocatorCount
    ) {
      mismatches.push('duplicateNativeLocatorCount');
    }
    if (manifest.datasetHash !== computed.datasetHash)
      mismatches.push('datasetHash');
    if (
      !manifest.amountTotal ||
      !manifest.amountTotal.equals(computed.amountTotal)
    ) {
      mismatches.push('amountTotal');
    }
    if (mismatches.length) {
      throw new BadRequestException(
        `Manifesto divergente: ${mismatches.join(', ')}`,
      );
    }
    reconcileLucasFleetRevenueAggregates(computed.rows, manifest.aggregates);
    if (
      computed.nullAmountCount > 0 ||
      computed.duplicateNativeLocatorCount > 0 ||
      manifest.pendingCount > 0
    ) {
      throw new BadRequestException(
        'Finalizacao bloqueada por valores nulos, identidades duplicadas ou pendencias',
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const staged = await tx.lucasFleetRevenueStagingFact.findMany({
          where: { runDbId: run.id },
          orderBy: { nativeLocator: 'asc' },
        });
        const existing = await tx.lucasFleetRevenueFact.findMany({
          where: {
            dataset: run.dataset,
            source: run.source,
            nativeLocator: { in: staged.map((row) => row.nativeLocator) },
          },
        });
        const byLocator = new Map(
          existing.map((row) => [row.nativeLocator, row]),
        );
        const now = new Date();
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        let deactivated = 0;

        for (const row of staged) {
          const current = byLocator.get(row.nativeLocator);
          const data = {
            dataset: run.dataset,
            source: run.source,
            nativeLocator: row.nativeLocator,
            sourceKind: row.sourceKind,
            nativeKey: json(row.nativeKey),
            companyId: row.companyId,
            sourceKey: row.sourceKey,
            aethosVehicleId: row.aethosVehicleId,
            eventDate: row.eventDate,
            competence: row.competence,
            amount: row.amount,
            sourceStatus: row.sourceStatus,
            active: row.active,
            sourceUpdatedAt: row.sourceUpdatedAt,
            planAccountId: row.planAccountId,
            recordHash: row.recordHash,
            raw: row.raw ?? Prisma.JsonNull,
            lastRunId: run.id,
            deactivatedAt: row.active ? null : now,
            deactivationReason: row.active
              ? null
              : `SOURCE_INACTIVE:${run.runId}`,
            syncedAt: now,
          };
          if (!current) {
            const fact = await tx.lucasFleetRevenueFact.create({ data });
            await tx.lucasFleetRevenueFactAudit.create({
              data: {
                factId: fact.id,
                operation: row.active ? 'CREATE' : 'CREATE_INACTIVE',
                syncRunId: run.runId,
                afterData: json(fact),
              },
            });
            created += 1;
          } else if (
            current.recordHash === row.recordHash &&
            current.active === row.active
          ) {
            await tx.lucasFleetRevenueFact.update({
              where: { id: current.id },
              data: { lastRunId: run.id, syncedAt: now },
            });
            unchanged += 1;
          } else {
            const fact = await tx.lucasFleetRevenueFact.update({
              where: { id: current.id },
              data,
            });
            await tx.lucasFleetRevenueFactAudit.create({
              data: {
                factId: current.id,
                operation: row.active ? 'UPDATE' : 'DEACTIVATE',
                syncRunId: run.runId,
                beforeData: json(current),
                afterData: json(fact),
              },
            });
            updated += 1;
            if (current.active && !row.active) deactivated += 1;
          }
        }

        const branchCompanyScopes = Array.isArray(
          scopeMetadata.branchCompanyScopes,
        )
          ? (scopeMetadata.branchCompanyScopes as Array<
              Record<string, unknown>
            >)
          : [];
        const branchScopeFilters = branchCompanyScopes.map((entry) => {
          const sourceKind = String(entry.sourceKind ?? '');
          const selection = String(entry.selection ?? '');
          const companyIds = Array.isArray(entry.companyIds)
            ? entry.companyIds.map(String)
            : [];
          return selection === 'ALL_NATIVE_COMPANIES'
            ? { sourceKind }
            : { sourceKind, companyId: { in: companyIds } };
        });
        const missingRecheckedNativeLocators =
          manifest.missingRecheckedNativeLocators;

        // FULL and INCREMENTAL are both complete snapshots of their date window.
        // An incremental window must retire facts that disappeared from that window.
        if (run.mode === 'FULL' || run.mode === 'INCREMENTAL') {
          const seen = new Set(staged.map((row) => row.nativeLocator));
          const candidateScopes: Prisma.LucasFleetRevenueFactWhereInput[] = [];
          candidateScopes.push({
            eventDate: {
              gte: run.scopeDateFrom,
              lt: run.scopeDateToExclusive,
            },
            ...(branchScopeFilters.length
              ? { OR: branchScopeFilters }
              : { sourceKind: { in: run.scopeBranches } }),
          });
          if (missingRecheckedNativeLocators.length) {
            candidateScopes.push({
              nativeLocator: { in: missingRecheckedNativeLocators },
            });
          }
          const candidates = await tx.lucasFleetRevenueFact.findMany({
            where: {
              dataset: run.dataset,
              source: run.source,
              active: true,
              OR: candidateScopes,
            },
          });
          for (const current of candidates) {
            if (seen.has(current.nativeLocator)) continue;
            const fact = await tx.lucasFleetRevenueFact.update({
              where: { id: current.id },
              data: {
                active: false,
                lastRunId: run.id,
                deactivatedAt: now,
                deactivationReason: `ABSENT_FROM_SNAPSHOT:${run.runId}`,
                syncedAt: now,
              },
            });
            await tx.lucasFleetRevenueFactAudit.create({
              data: {
                factId: current.id,
                operation: 'DEACTIVATE_ABSENT',
                syncRunId: run.runId,
                beforeData: json(current),
                afterData: json(fact),
              },
            });
            deactivated += 1;
          }
        }

        await tx.lucasFleetRevenueSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETED',
            manifest: manifest.raw,
            finalizedRecordCount: computed.recordCount,
            finalizedAmountTotal: computed.amountTotal,
            completedAt: now,
            failedAt: null,
            failureReason: null,
          },
        });
        return { created, updated, unchanged, deactivated };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );

    return {
      ok: true,
      dataset: run.dataset,
      runId: run.runId,
      status: 'COMPLETED',
      finalized: true,
      recordCount: computed.recordCount,
      amountTotal: computed.amountTotal.toString(),
      datasetHash: computed.datasetHash,
      ...result,
    };
  }

  async readback(runId: string, replayed = false) {
    const run = await this.prisma.lucasFleetRevenueSyncRun.findUnique({
      where: { runId },
      include: {
        batches: {
          orderBy: { batchNumber: 'asc' },
          select: {
            batchNumber: true,
            batchTotal: true,
            producerPayloadHash: true,
            serverPayloadHash: true,
            recordCount: true,
            processedAt: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundException('runId nao encontrado');
    return {
      schemaVersion: run.schemaVersion,
      dataset: run.dataset,
      source: run.source,
      runId: run.runId,
      status: run.status,
      mode: run.mode,
      generatedAt: run.generatedAt,
      scope: {
        dateFrom: run.scopeDateFrom.toISOString().slice(0, 10),
        dateToExclusive: run.scopeDateToExclusive.toISOString().slice(0, 10),
        branches: run.scopeBranches,
        companies: run.scopeCompanies,
      },
      receivedBatchCount: run.receivedBatchCount,
      batchTotal: run.batchTotal,
      receivedRecordCount: run.receivedRecordCount,
      finalizedRecordCount: run.finalizedRecordCount,
      finalizedAmountTotal: run.finalizedAmountTotal?.toString() ?? null,
      completedAt: run.completedAt,
      failedAt: run.failedAt,
      failureReason: run.failureReason,
      manifest: run.manifest,
      batches: run.batches,
      replayed,
    };
  }

  async monthActuals(month: Date) {
    const nextMonth = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    );
    const coverage = await this.prisma.lucasFleetRevenueSyncRun.findFirst({
      where: {
        dataset: LUCAS_FLEET_REVENUE_DATASET,
        source: LUCAS_FLEET_REVENUE_SOURCE,
        status: 'COMPLETED',
        snapshotComplete: true,
        scopeDateFrom: { lte: month },
        scopeDateToExclusive: { gte: nextMonth },
      },
      orderBy: { completedAt: 'desc' },
      select: {
        runId: true,
        completedAt: true,
        ruleVersion: true,
        ruleHash: true,
        scopeDateFrom: true,
        scopeDateToExclusive: true,
        finalizedRecordCount: true,
        finalizedAmountTotal: true,
      },
    });
    if (!coverage) {
      return {
        coverage: null,
        rows: [] as Array<{
          aethosVehicleId: string;
          revenueActual: string;
          factCount: number;
        }>,
      };
    }
    const rows = await this.prisma.lucasFleetRevenueFact.groupBy({
      by: ['aethosVehicleId'],
      where: {
        dataset: LUCAS_FLEET_REVENUE_DATASET,
        source: LUCAS_FLEET_REVENUE_SOURCE,
        competence: month,
        active: true,
        amount: { not: null },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return {
      coverage: {
        runId: coverage.runId,
        completedAt: coverage.completedAt,
        ruleVersion: coverage.ruleVersion,
        ruleHash: coverage.ruleHash,
        dateFrom: coverage.scopeDateFrom.toISOString().slice(0, 10),
        dateToExclusive: coverage.scopeDateToExclusive
          .toISOString()
          .slice(0, 10),
        recordCount: coverage.finalizedRecordCount,
        amountTotal: coverage.finalizedAmountTotal?.toString() ?? null,
      },
      rows: rows.map((row) => ({
        aethosVehicleId: row.aethosVehicleId,
        revenueActual: row._sum.amount?.toString() ?? '0',
        factCount: row._count._all,
      })),
    };
  }
}
