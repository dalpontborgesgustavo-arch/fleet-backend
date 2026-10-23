import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeSsmaWorkSnapshot,
  SSMA_WORK_BATHROOM_PRODUCT_CODES,
  SSMA_WORK_LEGACY_PRODUCT_CODES,
  SSMA_WORK_PRODUCT_CODES,
  SsmaActualLine,
  SsmaBudgetLine,
} from './ssma-work-costs.rules';

@Injectable()
export class SsmaWorkCostsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertReader(role: unknown) {
    if (
      typeof role !== 'string' ||
      !['admin', 'ssma'].includes(role.toLowerCase())
    ) {
      throw new ForbiddenException('Acesso restrito ao SSMA');
    }
  }

  async sync(body: unknown) {
    let payload: ReturnType<typeof normalizeSsmaWorkSnapshot>;
    try {
      payload = normalizeSsmaWorkSnapshot(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Fotografia SSMA invalida',
      );
    }

    const existing = await this.prisma.ssmaWorkCostSnapshot.findUnique({
      where: { runId: payload.runId },
    });
    if (existing) {
      if (existing.payloadHash !== payload.payloadHash) {
        throw new ConflictException('runId reutilizado com conteudo diferente');
      }
      return this.receipt(existing, true);
    }

    const latest = await this.prisma.ssmaWorkCostSnapshot.findFirst({
      orderBy: { generatedAt: 'desc' },
    });
    if (latest) {
      if (new Date(payload.generatedAt) <= latest.generatedAt) {
        throw new ConflictException('Fotografia mais antiga que a vigente');
      }
      // Once the expanded snapshot is live, an outdated six-product sender
      // must not silently remove bathroom costs from the current view.
      const previousRows = [
        ...(Array.isArray(latest.budgets)
          ? (latest.budgets as unknown as SsmaBudgetLine[])
          : []),
        ...(Array.isArray(latest.actuals)
          ? (latest.actuals as unknown as SsmaActualLine[])
          : []),
      ];
      if (
        payload.productCodes.length === SSMA_WORK_LEGACY_PRODUCT_CODES.length &&
        previousRows.some((line) =>
          SSMA_WORK_BATHROOM_PRODUCT_CODES.some(
            (code) => code === line.productCode,
          ),
        )
      ) {
        throw new ConflictException(
          'Escopo anterior nao pode substituir a fotografia ampliada',
        );
      }
      if (
        payload.budgets.length < Math.ceil(latest.budgetCount * 0.7) ||
        payload.actuals.length < Math.ceil(latest.actualCount * 0.7)
      ) {
        throw new ConflictException(
          'Queda de cobertura acima de 30%; revisar extracao antes de aceitar',
        );
      }
    }

    const row = await this.prisma.ssmaWorkCostSnapshot.create({
      data: {
        runId: payload.runId,
        generatedAt: new Date(payload.generatedAt),
        payloadHash: payload.payloadHash,
        budgetCount: payload.budgets.length,
        actualCount: payload.actuals.length,
        budgets: payload.budgets as unknown as Prisma.InputJsonValue,
        actuals: payload.actuals as unknown as Prisma.InputJsonValue,
      },
    });
    return this.receipt(row, false);
  }

  async readRun(runId: string) {
    const row = await this.prisma.ssmaWorkCostSnapshot.findUnique({
      where: { runId },
    });
    if (!row) throw new NotFoundException('Fotografia SSMA nao encontrada');
    return this.receipt(row, true);
  }

  async read(role: unknown) {
    this.assertReader(role);
    const row = await this.prisma.ssmaWorkCostSnapshot.findFirst({
      orderBy: { generatedAt: 'desc' },
    });
    if (!row) {
      return {
        snapshot: null,
        productCodes: [...SSMA_WORK_PRODUCT_CODES],
        bathroomSnapshotAvailable: false,
        monthlyBudgetAvailable: false,
        approvedBaselineAvailable: false,
        budgets: [],
        actuals: [],
      };
    }
    const budgets = row.budgets as unknown as SsmaBudgetLine[];
    const actuals = row.actuals as unknown as SsmaActualLine[];
    const allowed = new Set<string>(SSMA_WORK_PRODUCT_CODES);
    const bathroomCodes = new Set<string>(SSMA_WORK_BATHROOM_PRODUCT_CODES);
    return {
      snapshot: {
        runId: row.runId,
        generatedAt: row.generatedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        budgetCount: row.budgetCount,
        actualCount: row.actualCount,
        payloadHash: row.payloadHash,
      },
      productCodes: [...SSMA_WORK_PRODUCT_CODES],
      bathroomSnapshotAvailable: [...budgets, ...actuals].some((item) =>
        bathroomCodes.has(item.productCode),
      ),
      monthlyBudgetAvailable: false,
      approvedBaselineAvailable: false,
      budgetBasis: 'AETHOS_CURRENT_REGISTERED_TOTAL',
      actualBasis: 'AETHOS_OBRA_DOC_ENTRADA_FINALIZED_BY_DT_ENTRADA',
      budgets: budgets.filter((item) => allowed.has(item.productCode)),
      actuals: actuals.filter((item) => allowed.has(item.productCode)),
    };
  }

  private receipt(
    row: {
      runId: string;
      generatedAt: Date;
      receivedAt: Date;
      payloadHash: string;
      budgetCount: number;
      actualCount: number;
    },
    replayed: boolean,
  ) {
    return {
      runId: row.runId,
      generatedAt: row.generatedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      payloadHash: row.payloadHash,
      budgetCount: row.budgetCount,
      actualCount: row.actualCount,
      replayed,
    };
  }
}
