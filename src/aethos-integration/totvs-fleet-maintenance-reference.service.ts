import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  TotvsFleetClassificationDto,
  TotvsFleetMaintenanceLaborPoolDto,
  TotvsFleetMaintenanceReferenceDto,
  TotvsUsinaMonthlyCostConfigurationDto,
} from './dto/totvs-fleet-maintenance-reference.dto';
import { USINA_MONTHLY_COST_CONTEXT } from '../usina-monthly-cost/usina-monthly-cost.rules';

const QUERY_CODE = 'IND.BI.0035' as const;
const QUERY_CONTEXT = '0/P' as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const FALLBACK_ELIGIBLE_LINES = new Set([
  'CUSTOS M.O - EQUIPE MANUTENCAO',
  'CUSTOS M.O - EQUIPE ALMOXARIFADO MANUT.',
  'CUSTOS M.O - EQUIPE DE APOIO (COMBOIOS)',
  'CUSTOS M.O - EQUIPE DE APOIO (RAMPA/LAVACAO)',
]);

type SourceRow = Record<string, unknown>;
type ReportType = TotvsFleetClassificationDto['reportType'];

type SanitizedSourceSnapshot = {
  generatedAt: Date;
  responseBytes: number;
  sourceRows: number;
  eligibleSourceRows: number;
  authoritativeEligibilityField:
    | 'ENTRA_RATEIO_FROTA'
    | 'LINHA_RATEIO_MO_FALLBACK';
  laborPools: Array<{
    competence: string;
    eligibleLaborPoolAmount: string;
    sourceRowCount: number;
  }>;
  trackedLaborLines: Array<{
    competence: string;
    lineNumber: 9 | 10 | 11 | 12 | 26;
    amount: string;
    sourceRowCount: number;
  }>;
};

function trackedLaborLine(row: SourceRow): 9 | 10 | 11 | 12 | 26 | null {
  const descriptor = normalizedText(
    [
      row.LINHA_RATEIO_MO,
      row.CENTRO_CUSTO,
      row.NOME_CENTRO_CUSTO,
      row.DS_CENTRO_CUSTO,
      row.DESCRICAO_CENTRO_CUSTO,
    ].join(' '),
  );
  if (
    descriptor.includes('COMPRAS ADM CENTRAL') ||
    descriptor.includes('EQUIPE SUPRIMENTOS')
  ) {
    return 26;
  }
  if (
    descriptor.includes('ALMOXARIFE JR') ||
    descriptor.includes('ALMOXARIFADO MANUT')
  ) {
    return 10;
  }
  if (
    descriptor.includes('COMBOIOS MOTORISTA FROTA JR') ||
    descriptor.includes('APOIO (COMBOIOS') ||
    descriptor.includes('APOIO COMBOIOS')
  ) {
    return 11;
  }
  if (
    descriptor.includes('TANQUE ABASTECIMENTO') ||
    descriptor.includes('RAMPA/LAVACAO') ||
    descriptor.includes('RAMPA LAVACAO')
  ) {
    return 12;
  }
  if (descriptor.includes('EQUIPE MANUTENCAO')) return 9;
  return null;
}

function canonicalHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedText(value: unknown) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function dateOnly(value: string, field: string) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`${field} deve ser AAAA-MM-DD`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== raw
  ) {
    throw new BadRequestException(`${field} invalida`);
  }
  return parsed;
}

function monthKeys(dateFrom: Date, dateTo: Date) {
  const result: string[] = [];
  const cursor = new Date(
    Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), 1),
  );
  const last = new Date(
    Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1),
  );
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function competenceKey(row: SourceRow) {
  const raw = String(row.DT_COMPETENCIA ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  const year = Number(row.ANO_COMP);
  const month = Number(row.MES_COMP);
  if (
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= 2200 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }
  throw new BadGatewayException('IND.BI.0035 retornou competencia invalida');
}

function decimal(value: unknown, field: string) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new BadGatewayException(`IND.BI.0035 retornou ${field} vazio`);
  }
  const raw = String(value).trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadGatewayException(`IND.BI.0035 retornou ${field} invalido`);
  }
  return new Prisma.Decimal(normalized);
}

function booleanFlag(value: unknown) {
  const normalized = normalizedText(value);
  return ['1', 'TRUE', 'S', 'SIM', 'Y', 'YES'].includes(normalized);
}

function parseFleetNumber(value: string | null) {
  const match = String(value || '').match(/\d+/);
  if (!match) return null;
  const fleetNumber = Number(match[0]);
  return Number.isSafeInteger(fleetNumber) && fleetNumber > 0
    ? fleetNumber
    : null;
}

function reportType(group: string | null): ReportType {
  const normalized = normalizedText(group);
  if (
    normalized.includes('DESPESAS VEICULOS') ||
    normalized.includes('DESPESA VEICULOS')
  ) {
    return 'VEICULOS';
  }
  if (normalized.includes('DESPESAS CAMINHOES')) return 'CAMINHOES';
  if (normalized.includes('DESPESAS MAQUINAS')) return 'MAQUINAS';
  return 'FORA_DO_RATEIO';
}

@Injectable()
export class TotvsFleetMaintenanceReferenceService {
  private snapshotCache: {
    expiresAt: number;
    value: SanitizedSourceSnapshot;
  } | null = null;
  private snapshotPromise: Promise<SanitizedSourceSnapshot> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private config() {
    const baseUrl = String(process.env.TOTVS_RM_BASE_URL || '')
      .trim()
      .replace(/\/$/, '');
    const username = process.env.TOTVS_RM_USERNAME;
    const password = process.env.TOTVS_RM_PASSWORD;
    if (!baseUrl || !username || !password) {
      throw new ServiceUnavailableException(
        'Integracao TOTVS IND.BI.0035 ainda nao provisionada',
      );
    }
    const timeoutMs = Math.max(
      10_000,
      Number(
        process.env.TOTVS_FLEET_MAINTENANCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
      ),
    );
    const maxBytes = Math.max(
      1024 * 1024,
      Number(
        process.env.TOTVS_FLEET_MAINTENANCE_MAX_RESPONSE_BYTES ||
          DEFAULT_MAX_BYTES,
      ),
    );
    return {
      url: `${baseUrl}/api/framework/v1/consultaSQLServer/RealizaConsulta/${QUERY_CODE}/0/P/`,
      timeoutMs,
      maxBytes,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
    };
  }

  private async requestRows() {
    const config = this.config();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(config.url, {
          method: 'GET',
          headers: config.headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          if (TRANSIENT_STATUSES.has(response.status) && attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * 2 ** attempt),
            );
            continue;
          }
          throw new BadGatewayException(
            `TOTVS respondeu HTTP ${response.status}`,
          );
        }
        const contentLength = Number(
          response.headers.get('content-length') || 0,
        );
        if (contentLength > config.maxBytes) {
          throw new BadGatewayException(
            'Resposta IND.BI.0035 excedeu o limite permitido',
          );
        }
        const body = await response.text();
        const responseBytes = Buffer.byteLength(body);
        if (responseBytes > config.maxBytes) {
          throw new BadGatewayException(
            'Resposta IND.BI.0035 excedeu o limite permitido',
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new BadGatewayException(
            'Resposta IND.BI.0035 nao e JSON valido',
          );
        }
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as any)?.value)
            ? (parsed as any).value
            : Array.isArray((parsed as any)?.items)
              ? (parsed as any).items
              : null;
        if (!rows) {
          throw new BadGatewayException(
            'Resposta IND.BI.0035 nao contem lista JSON',
          );
        }
        return { rows: rows as SourceRow[], responseBytes };
      } catch (error) {
        lastError = error;
        if (attempt < 2 && (error as any)?.name === 'AbortError') continue;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    if ((lastError as any)?.name === 'AbortError') {
      throw new ServiceUnavailableException('Timeout ao consultar IND.BI.0035');
    }
    throw lastError;
  }

  private async buildSourceSnapshot(): Promise<SanitizedSourceSnapshot> {
    const fetched = await this.requestRows();
    const hasAuthoritativeFlag = fetched.rows.some((row) =>
      Object.prototype.hasOwnProperty.call(row, 'ENTRA_RATEIO_FROTA'),
    );
    if (
      hasAuthoritativeFlag &&
      fetched.rows.some(
        (row) =>
          !Object.prototype.hasOwnProperty.call(row, 'ENTRA_RATEIO_FROTA'),
      )
    ) {
      throw new BadGatewayException(
        'IND.BI.0035 retornou ENTRA_RATEIO_FROTA parcialmente',
      );
    }
    const grouped = new Map<
      string,
      { amount: Prisma.Decimal; sourceRowCount: number }
    >();
    const tracked = new Map<
      string,
      { amount: Prisma.Decimal; sourceRowCount: number }
    >();
    let eligibleSourceRows = 0;
    for (const row of fetched.rows) {
      const competence = competenceKey(row);
      const lineNumber = trackedLaborLine(row);
      if (lineNumber !== null) {
        const key = `${competence}:${lineNumber}`;
        const current = tracked.get(key) || {
          amount: new Prisma.Decimal(0),
          sourceRowCount: 0,
        };
        current.amount = current.amount.plus(
          decimal(row.VL_RATEADO, 'VL_RATEADO'),
        );
        current.sourceRowCount += 1;
        tracked.set(key, current);
      }
      const eligible = hasAuthoritativeFlag
        ? booleanFlag(row.ENTRA_RATEIO_FROTA)
        : FALLBACK_ELIGIBLE_LINES.has(normalizedText(row.LINHA_RATEIO_MO));
      if (!eligible) continue;
      const value = decimal(row.VL_RATEADO, 'VL_RATEADO');
      const current = grouped.get(competence) || {
        amount: new Prisma.Decimal(0),
        sourceRowCount: 0,
      };
      current.amount = current.amount.plus(value);
      current.sourceRowCount += 1;
      grouped.set(competence, current);
      eligibleSourceRows += 1;
    }
    return {
      generatedAt: new Date(),
      responseBytes: fetched.responseBytes,
      sourceRows: fetched.rows.length,
      eligibleSourceRows,
      authoritativeEligibilityField: hasAuthoritativeFlag
        ? 'ENTRA_RATEIO_FROTA'
        : 'LINHA_RATEIO_MO_FALLBACK',
      laborPools: [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([competence, value]) => ({
          competence,
          eligibleLaborPoolAmount: value.amount.toFixed(12),
          sourceRowCount: value.sourceRowCount,
        })),
      trackedLaborLines: [...tracked.entries()]
        .map(([key, value]) => {
          const [competence, line] = key.split(':');
          return {
            competence,
            lineNumber: Number(line) as 9 | 10 | 11 | 12 | 26,
            amount: value.amount.toFixed(12),
            sourceRowCount: value.sourceRowCount,
          };
        })
        .sort(
          (left, right) =>
            left.competence.localeCompare(right.competence) ||
            left.lineNumber - right.lineNumber,
        ),
    };
  }

  async competenceLaborLines(dateFromInput: string, dateToInput: string) {
    const dateFrom = dateOnly(dateFromInput, 'dateFrom');
    const dateTo = dateOnly(dateToInput, 'dateTo');
    if (dateFrom > dateTo) {
      throw new BadRequestException('dateFrom deve ser anterior a dateTo');
    }
    const snapshot = await this.sourceSnapshot();
    const dateFromKey = dateFrom.toISOString().slice(0, 10);
    const dateToKey = dateTo.toISOString().slice(0, 10);
    return snapshot.trackedLaborLines.filter(
      (entry) =>
        entry.competence >= dateFromKey && entry.competence <= dateToKey,
    );
  }

  private async sourceSnapshot() {
    if (this.snapshotCache && Date.now() < this.snapshotCache.expiresAt) {
      return this.snapshotCache.value;
    }
    if (this.snapshotPromise) return this.snapshotPromise;
    const promise = this.buildSourceSnapshot()
      .then((value) => {
        this.snapshotCache = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          value,
        };
        return value;
      })
      .finally(() => {
        if (this.snapshotPromise === promise) this.snapshotPromise = null;
      });
    this.snapshotPromise = promise;
    return promise;
  }

  private async fleetClassifications() {
    const vehicles = await this.prisma.vehicle.findMany({
      select: { fleet: true, group: true, subgroup: true, active: true },
      orderBy: [{ fleet: 'asc' }, { subgroup: 'asc' }],
    });
    const grouped = new Map<
      number,
      Array<{
        reportType: ReportType;
        subgroup: string | null;
        classificationActive: boolean;
      }>
    >();
    for (const vehicle of vehicles) {
      const fleetNumber = parseFleetNumber(vehicle.fleet);
      if (!fleetNumber) continue;
      grouped.set(fleetNumber, [
        ...(grouped.get(fleetNumber) || []),
        {
          reportType: reportType(vehicle.group),
          subgroup: vehicle.subgroup?.trim() || null,
          classificationActive: vehicle.active,
        },
      ]);
    }
    const result: TotvsFleetClassificationDto[] = [];
    for (const [fleetNumber, entries] of grouped) {
      const eligibleTypes = new Set(
        entries
          .map((entry) => entry.reportType)
          .filter((value) => value !== 'FORA_DO_RATEIO'),
      );
      if (eligibleTypes.size > 1) {
        throw new BadGatewayException(
          `Frota ${fleetNumber} possui classificacoes gerais conflitantes`,
        );
      }
      const selected =
        entries.find((entry) => entry.reportType !== 'FORA_DO_RATEIO') ||
        entries[0];
      const value = {
        fleetNumber,
        reportType: selected.reportType,
        subgroup: selected.subgroup,
        eligibleForGeneralAllocation: selected.reportType !== 'FORA_DO_RATEIO',
        // Memoria do estado cadastral atual. Nao participa da elegibilidade
        // historica, que e resolvida pelo AethosSync por competencia.
        classificationActive: entries.some(
          (entry) => entry.classificationActive,
        ),
      };
      result.push({
        ...value,
        classificationHash: canonicalHash(value),
      });
    }
    return result.sort((a, b) => a.fleetNumber - b.fleetNumber);
  }

  async monthlyConfigurationContract(
    dateFromInput: string,
    dateToInput: string,
  ) {
    const dateFrom = dateOnly(dateFromInput, 'dateFrom');
    const dateTo = dateOnly(dateToInput, 'dateTo');
    if (dateFrom > dateTo) {
      throw new BadRequestException('dateFrom deve ser anterior a dateTo');
    }
    const months = monthKeys(dateFrom, dateTo);
    const rangeStart = new Date(`${months[0]}T00:00:00.000Z`);
    const rangeEndExclusive = new Date(rangeStart);
    rangeEndExclusive.setUTCMonth(
      rangeEndExclusive.getUTCMonth() + months.length,
    );
    const configs = await this.prisma.usinaMonthlyCostConfig.findMany({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        competence: { gte: rangeStart, lt: rangeEndExclusive },
        status: 'CONFIRMED',
        isCurrent: true,
        deletedAt: null,
      },
      select: {
        id: true,
        competence: true,
        version: true,
        status: true,
        confirmedAt: true,
        equipment: {
          where: { deletedAt: null },
          select: {
            equipmentType: true,
            fleetNumber: true,
            aethosVehicleId: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ competence: 'asc' }, { version: 'desc' }],
    });
    const byMonth = new Map<string, (typeof configs)[number]>();
    for (const config of configs) {
      const competence = config.competence.toISOString().slice(0, 10);
      if (byMonth.has(competence)) {
        throw new BadGatewayException(
          `Mais de uma configuracao mensal vigente em ${competence}`,
        );
      }
      byMonth.set(competence, config);
    }
    const monthlyConfigurations: TotvsUsinaMonthlyCostConfigurationDto[] =
      months.map((competence) => {
        const config = byMonth.get(competence);
        if (!config) {
          const value = {
            competence,
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            coverage: 'MISSING' as const,
            status: null,
            configId: null,
            version: null,
            confirmedAt: null,
            targets: [],
          };
          return { ...value, contentHash: canonicalHash(value) };
        }
        const targets = config.equipment.map((equipment) => {
          const targetCostClass =
            equipment.equipmentType === 'CARREGADEIRA'
              ? ('CARREGADEIRAS' as const)
              : equipment.equipmentType === 'VEICULO_USINA'
                ? ('VEICULO_USINA' as const)
                : null;
          if (!targetCostClass) {
            throw new BadGatewayException(
              `Tipo de equipamento invalido na configuracao ${config.id}`,
            );
          }
          return {
            aethosVehicleId: equipment.aethosVehicleId,
            fleetNumber: equipment.fleetNumber,
            targetCostClass,
            sortOrder: equipment.sortOrder,
          };
        });
        const supportVehicles = targets.filter(
          (target) => target.targetCostClass === 'VEICULO_USINA',
        ).length;
        if (!targets.length || supportVehicles !== 1) {
          throw new BadGatewayException(
            `Configuracao mensal ${config.id} possui destinos invalidos`,
          );
        }
        const value = {
          competence,
          companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
          unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
          coverage: 'CONFIRMED' as const,
          status: 'CONFIRMED' as const,
          configId: config.id,
          version: config.version,
          confirmedAt: config.confirmedAt?.toISOString() ?? null,
          targets,
        };
        return { ...value, contentHash: canonicalHash(value) };
      });
    return {
      monthlyConfigurations,
      monthlyConfigurationsHash: canonicalHash(monthlyConfigurations),
    };
  }

  async reference(
    dateFromInput: string,
    dateToInput: string,
  ): Promise<TotvsFleetMaintenanceReferenceDto> {
    const dateFrom = dateOnly(dateFromInput, 'dateFrom');
    const dateTo = dateOnly(dateToInput, 'dateTo');
    if (dateFrom > dateTo) {
      throw new BadRequestException('dateFrom deve ser anterior a dateTo');
    }
    const [snapshot, fleetClassifications, monthlyConfigurationContract] =
      await Promise.all([
        this.sourceSnapshot(),
        this.fleetClassifications(),
        this.monthlyConfigurationContract(dateFromInput, dateToInput),
      ]);
    const dateFromKey = dateFrom.toISOString().slice(0, 10);
    const dateToKey = dateTo.toISOString().slice(0, 10);
    const generatedAt = snapshot.generatedAt.toISOString();
    const laborPools: TotvsFleetMaintenanceLaborPoolDto[] = snapshot.laborPools
      .filter(
        (entry) =>
          entry.competence >= dateFromKey && entry.competence <= dateToKey,
      )
      .map((entry) => {
        const value = {
          competence: entry.competence,
          eligibleLaborPoolAmount: entry.eligibleLaborPoolAmount,
          sourceRowCount: entry.sourceRowCount,
          sourceSentence: QUERY_CODE,
          sourceGeneratedAt: generatedAt,
        };
        return { ...value, contentHash: canonicalHash(value) };
      });
    const { monthlyConfigurations, monthlyConfigurationsHash } =
      monthlyConfigurationContract;
    const contentHash = canonicalHash({
      laborPools,
      fleetClassifications,
      monthlyConfigurations,
    });
    const activeFleetClassifications = fleetClassifications.filter(
      (entry) => entry.classificationActive,
    ).length;
    return {
      sourceSentence: QUERY_CODE,
      sourceContext: QUERY_CONTEXT,
      sourceGeneratedAt: generatedAt,
      dateFrom: dateFromKey,
      dateTo: dateToKey,
      authoritativeEligibilityField: snapshot.authoritativeEligibilityField,
      laborPools,
      fleetClassifications,
      monthlyConfigurations,
      reconciliation: {
        sourceRows: snapshot.sourceRows,
        eligibleSourceRows: snapshot.eligibleSourceRows,
        responseBytes: snapshot.responseBytes,
        laborPoolMonths: laborPools.length,
        fleetClassifications: fleetClassifications.length,
        activeFleetClassifications,
        inactiveFleetClassifications:
          fleetClassifications.length - activeFleetClassifications,
        monthlyConfigurationMonths: monthlyConfigurations.length,
        confirmedMonthlyConfigurationMonths: monthlyConfigurations.filter(
          (entry) => entry.coverage === 'CONFIRMED',
        ).length,
        missingMonthlyConfigurationMonths: monthlyConfigurations.filter(
          (entry) => entry.coverage === 'MISSING',
        ).length,
        monthlyConfigurationTargets: monthlyConfigurations.reduce(
          (total, entry) => total + entry.targets.length,
          0,
        ),
        monthlyConfigurationsHash,
        classificationConflicts: 0,
        contentHash,
      },
    };
  }
}
