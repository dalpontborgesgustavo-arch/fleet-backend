import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const USINA_FORECAST_CONTEXT = {
  companyId: 'JR_CONSTRUCOES',
  companyName: 'JR Construções',
  unitId: 'USINA_ASFALTO_ICARA',
  unitName: 'Usina de Asfalto de Içara',
} as const;

export const USINA_FORECAST_INDICATORS = {
  PREVISTO_R_T: 'Previsto (R$/t)',
  CUSTO_UNITARIO_PREVISTO_R_M3: 'Unitário previsto (R$/m³)',
} as const;

export const USINA_FORECAST_MATERIALS = [
  { code: 'CAP_50_70', name: 'CAP 50/70', indicatorCode: 'PREVISTO_R_T' },
  { code: 'CAP_BORRACHA', name: 'CAP Borracha', indicatorCode: 'PREVISTO_R_T' },
  { code: 'CAP_POLIMERO', name: 'CAP Polímero', indicatorCode: 'PREVISTO_R_T' },
  {
    code: 'CAP_ALTO_MODULO',
    name: 'CAP Alto Módulo',
    indicatorCode: 'PREVISTO_R_T',
  },
  {
    code: 'PO_DE_PEDRA',
    name: 'Pó-de-pedra — custo unitário',
    indicatorCode: 'CUSTO_UNITARIO_PREVISTO_R_M3',
  },
  {
    code: 'PO_DE_PEDRA_POR_TON_PRODUZIDA',
    name: 'Pó-de-pedra — custo por tonelada produzida',
    indicatorCode: 'PREVISTO_R_T',
  },
  {
    code: 'PEDRISCO',
    name: 'Pedrisco — custo unitário',
    indicatorCode: 'CUSTO_UNITARIO_PREVISTO_R_M3',
  },
  {
    code: 'PEDRISCO_POR_TON_PRODUZIDA',
    name: 'Pedrisco — custo por tonelada produzida',
    indicatorCode: 'PREVISTO_R_T',
  },
  {
    code: 'BRITA_3_4',
    name: 'Brita 3/4 — custo unitário',
    indicatorCode: 'CUSTO_UNITARIO_PREVISTO_R_M3',
  },
  {
    code: 'BRITA_3_4_POR_TON_PRODUZIDA',
    name: 'Brita 3/4 — custo por tonelada produzida',
    indicatorCode: 'PREVISTO_R_T',
  },
  {
    code: 'OLEO_RESIVALE',
    name: 'Óleo resivale',
    technicalDescription: 'Óleo combustível RRII alternativo',
    indicatorCode: 'PREVISTO_R_T',
  },
  { code: 'DIESEL', name: 'Diesel', indicatorCode: 'PREVISTO_R_T' },
  { code: 'CAL_CH1', name: 'Cal CH1', indicatorCode: 'PREVISTO_R_T' },
  { code: 'DOP', name: 'DOP', indicatorCode: 'PREVISTO_R_T' },
  { code: 'MAO_DE_OBRA', name: 'Mão de obra', indicatorCode: 'PREVISTO_R_T' },
  { code: 'CARREGADEIRA', name: 'Carregadeira', indicatorCode: 'PREVISTO_R_T' },
  {
    code: 'ENERGIA_ELETRICA',
    name: 'Energia elétrica',
    indicatorCode: 'PREVISTO_R_T',
  },
  { code: 'MANUTENCAO', name: 'Manutenção', indicatorCode: 'PREVISTO_R_T' },
] as const;

const MATERIAL_BY_CODE = new Map(
  USINA_FORECAST_MATERIALS.map((material) => [material.code, material]),
);

function normalizeRole(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function canAccessUsinaForecasts(role?: string | null) {
  return ['licitacao_gestor', 'admin', 'administrador'].includes(
    normalizeRole(role),
  );
}

function parseYear(value: unknown) {
  const year = Number(value ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2025 || year > 2100) {
    throw new BadRequestException('Ano deve estar entre 2025 e 2100');
  }
  return year;
}

function parseMonth(value: unknown) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException('Mês deve estar entre 1 e 12');
  }
  return month;
}

function parseNullableDecimal(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const normalized =
    typeof value === 'string'
      ? value.trim().replace(/\s/g, '').replace(',', '.')
      : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new BadRequestException('Valor previsto inválido');
  }
  return new Prisma.Decimal(number.toFixed(6));
}

function normalizeObservation(value: unknown) {
  if (value === null || value === undefined) return null;
  const observation = String(value).trim();
  if (observation.length > 1000) {
    throw new BadRequestException(
      'Observação deve ter no máximo 1000 caracteres',
    );
  }
  return observation || null;
}

function decimalEquals(left: unknown, right: unknown) {
  if (left === null || left === undefined)
    return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  return Number(left) === Number(right);
}

@Injectable()
export class UsinaForecastsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaForecasts(role)) {
      throw new ForbiddenException(
        'Sem permissão para acessar a Previsão Usina',
      );
    }
  }

  async findAnnual(yearValue: unknown, actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const year = parseYear(yearValue);
    const records = await this.prisma.usinaForecast.findMany({
      where: {
        companyId: USINA_FORECAST_CONTEXT.companyId,
        unitId: USINA_FORECAST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
        active: true,
      },
      orderBy: [{ competence: 'asc' }, { materialCode: 'asc' }],
      include: {
        updatedBy: { select: { id: true, name: true } },
      },
    });

    return {
      year,
      context: USINA_FORECAST_CONTEXT,
      indicators: USINA_FORECAST_INDICATORS,
      materials: USINA_FORECAST_MATERIALS,
      summaryRows: [
        {
          code: 'TOTAL_CAP',
          name: 'Total CAP',
          editable: false,
          description:
            'Composição derivada no Excel; permanece vazia sem regra suficiente.',
        },
      ],
      entries: records.map((record) => ({
        id: record.id,
        year: record.competence.getUTCFullYear(),
        month: record.competence.getUTCMonth() + 1,
        materialCode: record.materialCode,
        materialName: record.materialName,
        indicatorCode: record.indicatorCode,
        indicatorName: record.indicatorName,
        forecastValue:
          record.forecastValue === null ? null : Number(record.forecastValue),
        observation: record.observation,
        updatedById: record.updatedById,
        updatedByName: record.updatedBy?.name ?? null,
        updatedAt: record.updatedAt.toISOString(),
      })),
    };
  }

  async saveMany(
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuário autenticado não encontrado');
    }

    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (entries.length === 0 || entries.length > 200) {
      throw new BadRequestException('Informe entre 1 e 200 previsões');
    }

    const normalized = entries.map((entry: any) => {
      const year = parseYear(entry?.year);
      const month = parseMonth(entry?.month);
      const materialCode = String(entry?.materialCode || '')
        .trim()
        .toUpperCase();
      const material = MATERIAL_BY_CODE.get(materialCode as never);
      if (!material) {
        throw new BadRequestException(
          `Material inválido: ${materialCode || '-'}`,
        );
      }
      const indicatorCode = String(entry?.indicatorCode || '')
        .trim()
        .toUpperCase();
      if (indicatorCode !== material.indicatorCode) {
        throw new BadRequestException(
          `Indicador ${indicatorCode || '-'} não é válido para ${material.name}`,
        );
      }
      return {
        year,
        month,
        competence: new Date(Date.UTC(year, month - 1, 1)),
        material,
        indicatorCode,
        indicatorName:
          USINA_FORECAST_INDICATORS[
            indicatorCode as keyof typeof USINA_FORECAST_INDICATORS
          ],
        forecastValue: parseNullableDecimal(entry?.forecastValue),
        observation: normalizeObservation(entry?.observation),
      };
    });

    const seen = new Set<string>();
    for (const entry of normalized) {
      const key = `${entry.year}:${entry.month}:${entry.material.code}:${entry.indicatorCode}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Previsão duplicada no envio: ${key}`);
      }
      seen.add(key);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      let deactivated = 0;
      let unchanged = 0;

      for (const entry of normalized) {
        const uniqueWhere = {
          companyId_unitId_competence_materialCode_indicatorCode: {
            companyId: USINA_FORECAST_CONTEXT.companyId,
            unitId: USINA_FORECAST_CONTEXT.unitId,
            competence: entry.competence,
            materialCode: entry.material.code,
            indicatorCode: entry.indicatorCode,
          },
        };
        const existing = await tx.usinaForecast.findUnique({
          where: uniqueWhere,
        });

        if (entry.forecastValue === null) {
          if (!existing || !existing.active) {
            unchanged += 1;
            continue;
          }
          const forecast = await tx.usinaForecast.update({
            where: { id: existing.id },
            data: {
              forecastValue: null,
              observation: entry.observation,
              active: false,
              updatedById: actorId,
            },
          });
          await tx.usinaForecastHistory.create({
            data: {
              forecastId: forecast.id,
              companyId: forecast.companyId,
              unitId: forecast.unitId,
              competence: forecast.competence,
              materialCode: forecast.materialCode,
              indicatorCode: forecast.indicatorCode,
              action: 'DELETED',
              previousValue: existing.forecastValue,
              newValue: null,
              previousObservation: existing.observation,
              newObservation: entry.observation,
              actorId,
            },
          });
          deactivated += 1;
          continue;
        }

        if (!existing) {
          const forecast = await tx.usinaForecast.create({
            data: {
              ...USINA_FORECAST_CONTEXT,
              competence: entry.competence,
              materialCode: entry.material.code,
              materialName: entry.material.name,
              indicatorCode: entry.indicatorCode,
              indicatorName: entry.indicatorName,
              forecastValue: entry.forecastValue,
              observation: entry.observation,
              active: true,
              updatedById: actorId,
            },
          });
          await tx.usinaForecastHistory.create({
            data: {
              forecastId: forecast.id,
              companyId: forecast.companyId,
              unitId: forecast.unitId,
              competence: forecast.competence,
              materialCode: forecast.materialCode,
              indicatorCode: forecast.indicatorCode,
              action: 'CREATED',
              previousValue: null,
              newValue: forecast.forecastValue,
              previousObservation: null,
              newObservation: forecast.observation,
              actorId,
            },
          });
          created += 1;
          continue;
        }

        if (
          existing.active &&
          decimalEquals(existing.forecastValue, entry.forecastValue) &&
          (existing.observation || null) === entry.observation
        ) {
          unchanged += 1;
          continue;
        }

        const action = existing.active ? 'UPDATED' : 'REACTIVATED';
        const forecast = await tx.usinaForecast.update({
          where: { id: existing.id },
          data: {
            materialName: entry.material.name,
            indicatorName: entry.indicatorName,
            forecastValue: entry.forecastValue,
            observation: entry.observation,
            active: true,
            updatedById: actorId,
          },
        });
        await tx.usinaForecastHistory.create({
          data: {
            forecastId: forecast.id,
            companyId: forecast.companyId,
            unitId: forecast.unitId,
            competence: forecast.competence,
            materialCode: forecast.materialCode,
            indicatorCode: forecast.indicatorCode,
            action,
            previousValue: existing.forecastValue,
            newValue: forecast.forecastValue,
            previousObservation: existing.observation,
            newObservation: forecast.observation,
            actorId,
          },
        });
        updated += 1;
      }

      return { created, updated, deactivated, unchanged };
    });

    return { ok: true, ...result };
  }
}
