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

export const TAX_ACTUAL_MAPPINGS = [
  {
    company: 'JR_CONSTRUCOES',
    taxType: 'PIS',
    aethosCompanyCode: '1',
    planCodes: ['153'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'JR_CONSTRUCOES',
    taxType: 'COFINS',
    aethosCompanyCode: '1',
    planCodes: ['152'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'JR_CONSTRUCOES',
    taxType: 'IRPJ',
    aethosCompanyCode: '1',
    planCodes: ['145'],
    fiscalCompetenceOffsetMonths: 0,
  },
  {
    company: 'JR_CONSTRUCOES',
    taxType: 'CSLL',
    aethosCompanyCode: '1',
    planCodes: ['151'],
    fiscalCompetenceOffsetMonths: 0,
  },
  {
    company: 'JR_GESTAO',
    taxType: 'PIS',
    aethosCompanyCode: '1',
    planCodes: ['1132'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'JR_GESTAO',
    taxType: 'COFINS',
    aethosCompanyCode: '1',
    planCodes: ['1133'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'JR_GESTAO',
    taxType: 'IRPJ',
    aethosCompanyCode: '1',
    planCodes: ['1136'],
    fiscalCompetenceOffsetMonths: 0,
  },
  {
    company: 'JR_GESTAO',
    taxType: 'CSLL',
    aethosCompanyCode: '1',
    planCodes: ['1134'],
    fiscalCompetenceOffsetMonths: 0,
  },
  {
    company: 'PEDRAFORTE',
    taxType: 'PIS',
    aethosCompanyCode: '4',
    planCodes: ['1074'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'PEDRAFORTE',
    taxType: 'COFINS',
    aethosCompanyCode: '4',
    planCodes: ['1075'],
    fiscalCompetenceOffsetMonths: 1,
  },
  {
    company: 'PEDRAFORTE',
    taxType: 'IRPJ',
    aethosCompanyCode: '4',
    planCodes: ['1076'],
    fiscalCompetenceOffsetMonths: 0,
  },
  {
    company: 'PEDRAFORTE',
    taxType: 'CSLL',
    aethosCompanyCode: '4',
    planCodes: ['1077'],
    fiscalCompetenceOffsetMonths: 0,
  },
] as const;

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

function taxEntryKey(
  company: string,
  taxType: string,
  year: number,
  month: number,
) {
  return `${company}:${taxType}:${year}:${month}`;
}

function shiftCompetence(year: number, month: number, offsetMonths: number) {
  const shifted = new Date(Date.UTC(year, month - 1 - offsetMonths, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function competenceRange(year: number, extraMonths: number) {
  return Array.from({ length: 12 + extraMonths }, (_, index) => {
    const date = new Date(Date.UTC(year, index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}`;
  });
}

function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value || 0);
}

function effectiveActualAmount(aethosAmount: number, manualAmount: number) {
  return aethosAmount !== 0 ? aethosAmount : manualAmount;
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

    const actualMappings = TAX_ACTUAL_MAPPINGS.filter(
      (mapping) =>
        (!company || mapping.company === company) &&
        (!taxType || mapping.taxType === taxType),
    );
    const maximumFiscalOffset = actualMappings.reduce(
      (maximum, mapping) =>
        Math.max(maximum, mapping.fiscalCompetenceOffsetMonths),
      0,
    );
    const sourceCompetences = competenceRange(year, maximumFiscalOffset);
    const actualSourceWhere = {
      active: true,
      competencia: {
        in: sourceCompetences,
      },
      OR: actualMappings.flatMap((mapping) =>
        mapping.planCodes.map((codigoPlanoConta) => ({
          codigoEmpresa: mapping.aethosCompanyCode,
          codigoPlanoConta,
        })),
      ),
    };

    const [records, actualRows, lastActualSync] = await Promise.all([
      this.prisma.taxForecast.findMany({
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
      }),
      actualMappings.length
        ? this.prisma.aethosPlanoContaCost.groupBy({
            by: ['codigoEmpresa', 'codigoPlanoConta', 'competencia'],
            where: actualSourceWhere,
            _sum: {
              valorCusto: true,
            },
          })
        : Promise.resolve([]),
      actualMappings.length
        ? this.prisma.aethosPlanoContaCost.findFirst({
            where: actualSourceWhere,
            orderBy: {
              syncedAt: 'desc',
            },
            select: {
              syncedAt: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const mappingBySource = new Map<
      string,
      (typeof TAX_ACTUAL_MAPPINGS)[number]
    >(
      actualMappings.flatMap((mapping) =>
        mapping.planCodes.map(
          (planCode) =>
            [`${mapping.aethosCompanyCode}:${planCode}`, mapping] as const,
        ),
      ),
    );
    const actualByKey = new Map<string, number>();
    const actualAethosCompetencesByKey = new Map<string, Set<string>>();

    for (const row of actualRows) {
      const mapping = mappingBySource.get(
        `${row.codigoEmpresa || ''}:${row.codigoPlanoConta}`,
      );
      const match = /^(\d{4})-(\d{2})$/.exec(row.competencia || '');
      if (!mapping || !match) continue;
      const rowYear = Number(match[1]);
      const rowMonth = Number(match[2]);
      if (rowMonth < 1 || rowMonth > 12) continue;
      const fiscalCompetence = shiftCompetence(
        rowYear,
        rowMonth,
        mapping.fiscalCompetenceOffsetMonths,
      );
      if (fiscalCompetence.year !== year) continue;
      const key = taxEntryKey(
        mapping.company,
        mapping.taxType,
        fiscalCompetence.year,
        fiscalCompetence.month,
      );
      actualByKey.set(
        key,
        (actualByKey.get(key) || 0) + Number(row._sum.valorCusto || 0),
      );
      const sourceCompetencesForEntry =
        actualAethosCompetencesByKey.get(key) || new Set<string>();
      sourceCompetencesForEntry.add(row.competencia);
      actualAethosCompetencesByKey.set(key, sourceCompetencesForEntry);
    }

    const recordsByKey = new Map(
      records.map((record) => [
        taxEntryKey(record.company, record.taxType, record.year, record.month),
        record,
      ]),
    );
    const entryKeys = new Set([...recordsByKey.keys(), ...actualByKey.keys()]);
    const entries = [...entryKeys]
      .map((key) => {
        const [entryCompany, entryTaxType, entryYear, entryMonth] =
          key.split(':');
        const record = recordsByKey.get(key);
        const mapping = actualMappings.find(
          (item) =>
            item.company === entryCompany && item.taxType === entryTaxType,
        );

        const actualAmountAethos = actualByKey.get(key) || 0;
        const actualAmountManual = decimalNumber(record?.actualAmount);
        const actualSource =
          actualAmountAethos !== 0 ? 'AETHOS_PLANO_CONTA' : 'MANUAL';

        return {
          id: record?.id ?? `aethos:${key}`,
          company: entryCompany,
          taxType: entryTaxType,
          year: Number(entryYear),
          month: Number(entryMonth),
          forecastAmount: Number(record?.forecastAmount || 0),
          actualAmount: effectiveActualAmount(
            actualAmountAethos,
            actualAmountManual,
          ),
          actualAmountAethos,
          actualAmountManual,
          actualSource,
          actualOverrodeManual:
            actualSource === 'AETHOS_PLANO_CONTA' && actualAmountManual !== 0,
          actualPlanCodes: mapping ? [...mapping.planCodes] : [],
          actualAethosCompetences: [
            ...(actualAethosCompetencesByKey.get(key) || []),
          ].sort(),
          fiscalCompetenceOffsetMonths:
            mapping?.fiscalCompetenceOffsetMonths ?? 0,
          updatedById: record?.updatedById ?? null,
          updatedByName: record?.updatedBy?.name ?? null,
          createdAt: record?.createdAt.toISOString() ?? null,
          updatedAt: record?.updatedAt.toISOString() ?? null,
        };
      })
      .sort(
        (left, right) =>
          left.month - right.month ||
          left.company.localeCompare(right.company) ||
          left.taxType.localeCompare(right.taxType),
      );

    return {
      year,
      companies: TAX_FORECAST_COMPANIES,
      taxes: TAX_FORECAST_TYPES,
      entries,
      actualBasis: 'COMPETENCIA_FISCAL_DERIVADA_VALOR_CUSTO',
      actualLastSync: lastActualSync?.syncedAt?.toISOString() ?? null,
      actualMappings: actualMappings.map((mapping) => ({
        company: mapping.company,
        taxType: mapping.taxType,
        aethosCompanyCode: mapping.aethosCompanyCode,
        planCodes: [...mapping.planCodes],
        fiscalCompetenceOffsetMonths: mapping.fiscalCompetenceOffsetMonths,
      })),
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
