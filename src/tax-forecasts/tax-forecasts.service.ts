import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const TAX_FORECAST_COMPANIES = [
  { value: 'JR_CONSTRUCOES', label: 'JR Construções' },
  { value: 'JR_GESTAO', label: 'JR Gestão' },
  { value: 'PEDRAFORTE', label: 'Pedraforte' },
] as const;

export const TAX_FORECAST_TYPES = [
  { value: 'PIS', label: 'PIS' },
  { value: 'COFINS', label: 'COFINS' },
  { value: 'IRPJ', label: 'IRPJ' },
  { value: 'CSLL', label: 'CSLL' },
] as const;

const ALLOWED_ROLES = new Set(['admin', 'ceo', 'contabilidade']);
const COMPANY_VALUES = new Set(
  TAX_FORECAST_COMPANIES.map((company) => company.value),
);
const TAX_VALUES = new Set(TAX_FORECAST_TYPES.map((tax) => tax.value));

function normalizeRole(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function parseInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(coerceText(value), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(`${field} inválido`);
  }
  return parsed;
}

function parseAmount(value: unknown, field: string) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} inválido`);
    }
    return new Prisma.Decimal(value.toFixed(2));
  }

  const text = coerceText(value);
  if (!text) return new Prisma.Decimal(0);

  const cleaned = text.replace(/[^\d,.-]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const integerPart =
    decimalIndex === -1
      ? cleaned.replace(/[^\d-]/g, '')
      : cleaned.slice(0, decimalIndex).replace(/[^\d-]/g, '');
  const decimalPart =
    decimalIndex === -1
      ? ''
      : cleaned
          .slice(decimalIndex + 1)
          .replace(/\D/g, '')
          .slice(0, 2)
          .padEnd(2, '0');
  const normalized = decimalPart
    ? `${integerPart || '0'}.${decimalPart}`
    : integerPart || '0';
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException(`${field} inválido`);
  }
  return new Prisma.Decimal(amount.toFixed(2));
}

function normalizeCompany(value: unknown) {
  const company = coerceText(value).toUpperCase();
  if (!COMPANY_VALUES.has(company as never)) {
    throw new BadRequestException('Empresa inválida');
  }
  return company;
}

function normalizeTaxType(value: unknown) {
  const taxType = coerceText(value).toUpperCase();
  if (!TAX_VALUES.has(taxType as never)) {
    throw new BadRequestException('Imposto inválido');
  }
  return taxType;
}

function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value || 0);
}

@Injectable()
export class TaxForecastsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!ALLOWED_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException(
        'Sem permissão para acessar previsões tributárias',
      );
    }
  }

  async findAll(
    filters: { year?: unknown; company?: unknown; taxType?: unknown },
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);

    const year =
      filters.year === undefined || filters.year === null || filters.year === ''
        ? new Date().getFullYear()
        : parseInteger(filters.year, 'Ano', 2000, 2100);
    const company = filters.company ? normalizeCompany(filters.company) : null;
    const taxType = filters.taxType ? normalizeTaxType(filters.taxType) : null;

    const records = await this.prisma.taxForecast.findMany({
      where: {
        year,
        ...(company ? { company } : {}),
        ...(taxType ? { taxType } : {}),
      },
      orderBy: [{ month: 'asc' }, { company: 'asc' }, { taxType: 'asc' }],
      include: {
        updatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const entries = records.map((record) => {
      const actualAmount = decimalNumber(record.actualAmount);
      return {
        id: record.id,
        company: record.company,
        taxType: record.taxType,
        year: record.year,
        month: record.month,
        forecastAmount: decimalNumber(record.forecastAmount),
        actualAmount,
        actualAmountAethos: 0,
        actualAmountManual: actualAmount,
        actualSource: 'MANUAL' as const,
        actualOverrodeManual: false,
        actualPlanCodes: [] as string[],
        actualAethosCompetences: [] as string[],
        fiscalCompetenceOffsetMonths: 0,
        updatedById: record.updatedById,
        updatedByName: record.updatedBy?.name ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    });

    return {
      year,
      companies: TAX_FORECAST_COMPANIES,
      taxes: TAX_FORECAST_TYPES,
      entries,
      actualBasis: 'MANUAL_USUARIO',
      actualLastSync: null,
      actualMappings: [],
      summary: {
        forecastAmount: entries.reduce(
          (total, entry) => total + entry.forecastAmount,
          0,
        ),
        actualAmount: entries.reduce(
          (total, entry) => total + entry.actualAmount,
          0,
        ),
      },
    };
  }

  async upsertMany(
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuário autenticado não encontrado');
    }

    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (entries.length === 0 || entries.length > 48) {
      throw new BadRequestException(
        'Informe entre 1 e 48 lançamentos tributários',
      );
    }

    const normalized = entries.map((entry: any) => {
      const company = normalizeCompany(entry?.company);
      const taxType = normalizeTaxType(entry?.taxType);
      const year = parseInteger(entry?.year, 'Ano', 2000, 2100);
      const month = parseInteger(entry?.month, 'Mês', 1, 12);

      return {
        company,
        taxType,
        year,
        month,
        forecastAmount: parseAmount(entry?.forecastAmount, 'Valor previsto'),
        actualAmount: parseAmount(entry?.actualAmount, 'Valor realizado'),
      };
    });

    const uniqueKeys = new Set(
      normalized.map(
        (entry) =>
          `${entry.company}:${entry.taxType}:${entry.year}:${entry.month}`,
      ),
    );
    if (uniqueKeys.size !== normalized.length) {
      throw new BadRequestException(
        'Existem lançamentos tributários repetidos',
      );
    }

    const records = await this.prisma.$transaction(async (tx) => {
      let savedCount = 0;

      for (const entry of normalized) {
        const identity = {
          company: entry.company,
          taxType: entry.taxType,
          year: entry.year,
          month: entry.month,
        };
        const previous = await tx.taxForecast.findUnique({
          where: { company_taxType_year_month: identity },
        });
        const record = await tx.taxForecast.upsert({
          where: { company_taxType_year_month: identity },
          create: {
            ...entry,
            updatedById: actorId,
          },
          update: {
            forecastAmount: entry.forecastAmount,
            actualAmount: entry.actualAmount,
            updatedById: actorId,
          },
        });
        const previousData = previous
          ? {
              forecastAmount: decimalNumber(previous.forecastAmount),
              actualAmountManual: decimalNumber(previous.actualAmount),
            }
          : null;
        const nextData = {
          forecastAmount: decimalNumber(record.forecastAmount),
          actualAmountManual: decimalNumber(record.actualAmount),
        };

        if (
          !previousData ||
          previousData.forecastAmount !== nextData.forecastAmount ||
          previousData.actualAmountManual !== nextData.actualAmountManual
        ) {
          await tx.taxForecastAudit.create({
            data: {
              taxForecastId: record.id,
              ...identity,
              action: previous ? 'UPDATE' : 'CREATE',
              source: 'MANUAL',
              previousData: previousData ?? Prisma.JsonNull,
              nextData,
              changedById: actorId,
            },
          });
        }
        savedCount += 1;
      }

      return savedCount;
    });

    return {
      ok: true,
      upserted: records,
    };
  }

  async findAudit(
    filters: {
      year?: unknown;
      company?: unknown;
      taxType?: unknown;
      month?: unknown;
    },
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);

    const year = filters.year
      ? parseInteger(filters.year, 'Ano', 2000, 2100)
      : undefined;
    const month = filters.month
      ? parseInteger(filters.month, 'Mês', 1, 12)
      : undefined;
    const company = filters.company
      ? normalizeCompany(filters.company)
      : undefined;
    const taxType = filters.taxType
      ? normalizeTaxType(filters.taxType)
      : undefined;

    const rows = await this.prisma.taxForecastAudit.findMany({
      where: { year, month, company, taxType },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
