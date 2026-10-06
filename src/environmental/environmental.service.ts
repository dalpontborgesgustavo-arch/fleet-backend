import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';
import { buildLegacyEnvironmentalRecords } from './environmental-legacy-data';

const ALLOWED_ROLES = new Set(['ssma', 'admin']);
const ALLOWED_DOMAINS = new Set([
  'RESOURCE',
  'WASTE',
  'OPACITY',
  'GHG',
  'AIR_EMISSION',
]);
const ALLOWED_COMPANIES = new Set(['JR_CONSTRUCOES', 'PEDRAFORTE']);
const RESOURCE_METRICS = new Set([
  'ENERGY_CONSUMPTION',
  'ENERGY_GENERATION',
  'WATER_CONSUMPTION',
  'PRODUCTION',
]);
const WASTE_METRICS = new Set([
  'ORGANIC',
  'RECYCLABLE',
  'REJECT',
  'HAZARDOUS',
  'OTHER',
]);
const GHG_METRICS = new Set([
  'STATIONARY_COMBUSTION',
  'MOBILE_COMBUSTION',
  'PURCHASED_ELECTRICITY',
  'OTHER',
]);
const AIR_POLLUTANTS = {
  MP: {
    unit: 'mg/Nm³',
    regulation:
      'Resolução CONSEMA/SC 190/2022 — Concreto Asfáltico, Seção II, Subseção IX, Art. 33, atividades de produção de asfalto.',
  },
  NOX: {
    unit: 'mg/Nm³',
    regulation:
      'Resolução CONSEMA/SC 190/2022 — Concreto Asfáltico, Seção II, Subseção IX, Art. 33, atividades de produção de asfalto.',
  },
  SOX: {
    unit: 'mg/Nm³',
    regulation:
      'Resolução CONSEMA/SC 190/2022 — Concreto Asfáltico, Seção II, Subseção IX, Art. 33, atividades de produção de asfalto.',
  },
  RINGELMANN: {
    unit: 'nível Ringelmann',
    regulation:
      'Resolução CONSEMA/SC 190/2022 — Grau de enegrecimento da fumaça, Cap. II, Art. 13.',
  },
} as const;
const AIR_POLLUTANT_METRICS = new Set(Object.keys(AIR_POLLUTANTS));

type Attachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileKey?: string | null;
  mimeType?: string | null;
  size?: number | null;
  uploadedAt: string;
  uploadedById?: string | null;
};

const recordInclude = {
  factor: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
};

function text(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function normalizeRole(value?: string | null) {
  return text(value).toLowerCase();
}

function enumValue(value: unknown, allowed: Set<string>, label: string) {
  const normalized = text(value).toUpperCase();
  if (!allowed.has(normalized)) {
    throw new BadRequestException(`${label} inválido`);
  }
  return normalized;
}

function parseNumber(value: unknown, label: string, allowZero = true) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new BadRequestException(`${label} inválido`);
    }
    return value;
  }

  const raw = text(value).replace(/[^\d,.-]/g, '');
  if (!raw) throw new BadRequestException(`${label} é obrigatório`);
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const separator = Math.max(comma, dot);
  const normalized =
    separator === -1
      ? raw
      : `${raw.slice(0, separator).replace(/[.,]/g, '')}.${raw
          .slice(separator + 1)
          .replace(/[^\d]/g, '')}`;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw new BadRequestException(`${label} inválido`);
  }
  return number;
}

function parseDate(value: unknown, label: string, required = true) {
  const raw = text(value);
  if (!raw && !required) return null;
  const date = new Date(raw.length === 7 ? `${raw}-01T12:00:00.000Z` : raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} inválida`);
  }
  return date;
}

function parseCompetence(value: unknown) {
  const date = parseDate(value, 'Competência');
  return new Date(
    Date.UTC(date!.getUTCFullYear(), date!.getUTCMonth(), 1, 12, 0, 0),
  );
}

function optionalText(value: unknown, maximum = 500) {
  const result = text(value);
  return result ? result.slice(0, maximum) : null;
}

function parseDetails(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Attachment =>
    Boolean(
      entry && typeof entry === 'object' && text((entry as Attachment).fileUrl),
    ),
  );
}

function firstDayOfMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new BadRequestException('Competência inicial inválida');
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new BadRequestException('Competência inicial inválida');
  }
  return new Date(Date.UTC(Number(match[1]), month - 1, 1, 0));
}

function endOfMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new BadRequestException('Competência final inválida');
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new BadRequestException('Competência final inválida');
  }
  return new Date(Date.UTC(Number(match[1]), month, 1, 0));
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7);
}

function decimal(value?: Prisma.Decimal | null) {
  return value === null || value === undefined ? null : Number(value);
}

@Injectable()
export class EnvironmentalService implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3UploadService,
  ) {}

  async onModuleInit() {
    try {
      const legacy = buildLegacyEnvironmentalRecords();
      const result = await this.prisma.environmentalRecord.createMany({
        data: legacy.map((record) => ({
          ...record,
          details: record.details as Prisma.InputJsonValue,
          attachments: [],
          status: 'VALID',
          active: true,
        })),
        skipDuplicates: true,
      });
      if (result.count > 0) {
        this.logger.log(
          `Histórico ambiental importado das planilhas: ${result.count} registros`,
        );
      }
    } catch (error) {
      // A migration may still be running while a second instance starts. Do not
      // prevent the API from becoming healthy; the import is idempotent.
      this.logger.warn(
        `Não foi possível conferir o histórico ambiental no startup: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private ensureAccess(role?: string | null) {
    if (!ALLOWED_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException(
        'Sem permissão para acessar a Gestão Ambiental',
      );
    }
  }

  async findRecords(query: any, actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const domain = query?.domain
      ? enumValue(query.domain, ALLOWED_DOMAINS, 'Domínio')
      : null;
    const company = query?.company
      ? enumValue(query.company, ALLOWED_COMPANIES, 'Empresa')
      : null;
    const from = query?.from ? firstDayOfMonth(text(query.from)) : null;
    const to = query?.to ? endOfMonth(text(query.to)) : null;
    const limit = Math.min(Math.max(Number(query?.limit) || 500, 1), 2000);

    const records = await this.prisma.environmentalRecord.findMany({
      where: {
        active: true,
        ...(domain ? { domain } : {}),
        ...(company ? { company } : {}),
        ...(query?.site
          ? { site: { contains: text(query.site), mode: 'insensitive' } }
          : {}),
        ...(from || to
          ? {
              competence: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [
        { competence: 'desc' },
        { recordedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      include: recordInclude,
    });

    return records.map((record) => this.serializeRecord(record));
  }

  async dashboard(query: any, actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const current = new Date();
    const defaultFrom = `${current.getUTCFullYear() - 1}-${String(
      current.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const defaultTo = `${current.getUTCFullYear()}-${String(
      current.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const fromText = text(query?.from) || defaultFrom;
    const toText = text(query?.to) || defaultTo;
    const from = firstDayOfMonth(fromText);
    const toExclusive = endOfMonth(toText);
    const company = query?.company
      ? enumValue(query.company, ALLOWED_COMPANIES, 'Empresa')
      : null;

    const records = await this.prisma.environmentalRecord.findMany({
      where: {
        active: true,
        ...(company ? { company } : {}),
        competence: { gte: from, lt: toExclusive },
      },
      orderBy: [{ competence: 'asc' }, { createdAt: 'asc' }],
    });

    const monthly = new Map<string, Record<string, number>>();
    const totals = {
      energyConsumptionKwh: 0,
      energyGenerationKwh: 0,
      waterConsumptionM3: 0,
      productionT: 0,
      wasteKg: 0,
      recyclableWasteKg: 0,
      rejectWasteKg: 0,
      hazardousWasteKg: 0,
      ghgKgCo2e: 0,
      opacityMeasurements: 0,
      opacityAboveLevelOne: 0,
    };

    for (const record of records) {
      // Resultados laboratoriais atmosféricos não são atividade de GEE nem
      // quantidade somável aos indicadores mensais de recursos ou resíduos.
      if (record.domain === 'AIR_EMISSION') continue;
      const key = monthKey(record.competence);
      const point = monthly.get(key) || {
        energyConsumptionKwh: 0,
        energyGenerationKwh: 0,
        waterConsumptionM3: 0,
        productionT: 0,
        wasteKg: 0,
        recyclableWasteKg: 0,
        rejectWasteKg: 0,
        hazardousWasteKg: 0,
        ghgKgCo2e: 0,
      };
      const amount = Number(record.amount);

      if (record.domain === 'RESOURCE') {
        if (record.metric === 'ENERGY_CONSUMPTION') {
          totals.energyConsumptionKwh += amount;
          point.energyConsumptionKwh += amount;
        } else if (record.metric === 'ENERGY_GENERATION') {
          totals.energyGenerationKwh += amount;
          point.energyGenerationKwh += amount;
        } else if (record.metric === 'WATER_CONSUMPTION') {
          totals.waterConsumptionM3 += amount;
          point.waterConsumptionM3 += amount;
        } else if (record.metric === 'PRODUCTION') {
          totals.productionT += amount;
          point.productionT += amount;
        }
      } else if (record.domain === 'WASTE') {
        totals.wasteKg += amount;
        point.wasteKg += amount;
        if (record.metric === 'RECYCLABLE') {
          totals.recyclableWasteKg += amount;
          point.recyclableWasteKg += amount;
        }
        if (record.metric === 'REJECT') {
          totals.rejectWasteKg += amount;
          point.rejectWasteKg += amount;
        }
        if (record.metric === 'HAZARDOUS') {
          totals.hazardousWasteKg += amount;
          point.hazardousWasteKg += amount;
        }
      } else if (record.domain === 'GHG') {
        const co2e = Number(record.co2eKg || 0);
        totals.ghgKgCo2e += co2e;
        point.ghgKgCo2e += co2e;
      } else if (record.domain === 'OPACITY') {
        totals.opacityMeasurements += 1;
        // Ringelmann is tracked separately from GHG. A result above level 1 is
        // only a managerial signal here; legal conformity depends on the
        // applicable licence and regulation and is therefore not inferred.
        if (amount > 1) totals.opacityAboveLevelOne += 1;
      }
      monthly.set(key, point);
    }

    const trend = [...monthly.entries()].map(([competence, values]) => ({
      competence,
      ...values,
      generationCoveragePercent:
        values.energyConsumptionKwh > 0
          ? (values.energyGenerationKwh / values.energyConsumptionKwh) * 100
          : null,
      recyclingPercent:
        values.wasteKg > 0
          ? (values.recyclableWasteKg / values.wasteKg) * 100
          : null,
      energyIntensityKwhPerT:
        values.productionT > 0
          ? values.energyConsumptionKwh / values.productionT
          : null,
    }));

    return {
      from: fromText,
      to: toText,
      company,
      totals: {
        ...totals,
        ghgTCo2e: totals.ghgKgCo2e / 1000,
        generationCoveragePercent:
          totals.energyConsumptionKwh > 0
            ? (totals.energyGenerationKwh / totals.energyConsumptionKwh) * 100
            : null,
        recyclingPercent:
          totals.wasteKg > 0
            ? (totals.recyclableWasteKg / totals.wasteKg) * 100
            : null,
        energyIntensityKwhPerT:
          totals.productionT > 0
            ? totals.energyConsumptionKwh / totals.productionT
            : null,
      },
      trend,
      recordsCount: records.length,
      dataQuality: {
        hasGhgInventory: records.some((record) => record.domain === 'GHG'),
        hasProduction: records.some(
          (record) =>
            record.domain === 'RESOURCE' && record.metric === 'PRODUCTION',
        ),
        legacyRecords: records.filter(
          (record) => record.source === 'LEGACY_SPREADSHEET',
        ).length,
      },
    };
  }

  async createRecord(
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const payload = await this.parseRecord(data);
    const record = await this.prisma.environmentalRecord.create({
      data: {
        ...payload,
        createdById: actorId || null,
        updatedById: actorId || null,
      },
      include: recordInclude,
    });
    return this.serializeRecord(record);
  }

  async updateRecord(
    id: string,
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    await this.ensureRecord(id);
    const payload = await this.parseRecord(data);
    const record = await this.prisma.environmentalRecord.update({
      where: { id },
      data: { ...payload, updatedById: actorId || null },
      include: recordInclude,
    });
    return this.serializeRecord(record);
  }

  async deactivateRecord(
    id: string,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    await this.ensureRecord(id);
    await this.prisma.environmentalRecord.update({
      where: { id },
      data: { active: false, updatedById: actorId || null },
    });
    return { ok: true };
  }

  async attachFile(
    id: string,
    file: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const existing = await this.ensureRecord(id);
    const uploaded = await this.storage.uploadFile(file, 'environmental');
    const attachments = parseAttachments(existing.attachments);
    attachments.push({
      id: randomUUID(),
      fileName: file.originalname,
      fileUrl: uploaded.url,
      fileKey: uploaded.key,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedById: actorId || null,
    });
    const record = await this.prisma.environmentalRecord.update({
      where: { id },
      data: {
        attachments: attachments as unknown as Prisma.InputJsonValue,
        updatedById: actorId || null,
      },
      include: recordInclude,
    });
    return this.serializeRecord(record);
  }

  async factors(actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const factors = await this.prisma.environmentalEmissionFactor.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { validFrom: 'desc' }],
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return factors.map((factor) => ({
      ...factor,
      factorValue: Number(factor.factorValue),
    }));
  }

  async createFactor(
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const scope = Number(data?.scope);
    if (![1, 2, 3].includes(scope)) {
      throw new BadRequestException('Escopo deve ser 1, 2 ou 3');
    }
    const name = optionalText(data?.name, 180);
    const activityUnit = optionalText(data?.activityUnit, 50);
    const source = optionalText(data?.source, 300);
    if (!name || !activityUnit || !source) {
      throw new BadRequestException(
        'Nome, unidade da atividade e fonte do fator são obrigatórios',
      );
    }

    const payload = {
      name,
      category: enumValue(data?.category, GHG_METRICS, 'Categoria'),
      scope,
      gas: optionalText(data?.gas, 50) || 'CO2e',
      factorValue: new Prisma.Decimal(
        parseNumber(data?.factorValue, 'Fator de emissão', false).toString(),
      ),
      activityUnit,
      emissionUnit: optionalText(data?.emissionUnit, 50) || 'kgCO2e',
      source,
      version: optionalText(data?.version, 100),
      validFrom: parseDate(data?.validFrom, 'Validade inicial', false),
      validTo: parseDate(data?.validTo, 'Validade final', false),
      createdById: actorId || null,
    };
    const factor = await this.prisma.environmentalEmissionFactor.create({
      data: payload,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return { ...factor, factorValue: Number(factor.factorValue) };
  }

  async deactivateFactor(id: string, actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const existing = await this.prisma.environmentalEmissionFactor.findUnique({
      where: { id },
    });
    if (!existing || !existing.active) {
      throw new NotFoundException('Fator de emissão não encontrado');
    }
    await this.prisma.environmentalEmissionFactor.update({
      where: { id },
      data: { active: false },
    });
    return { ok: true };
  }

  private async parseRecord(data: any) {
    const domain = enumValue(data?.domain, ALLOWED_DOMAINS, 'Domínio');
    const company = enumValue(
      data?.company || 'JR_CONSTRUCOES',
      ALLOWED_COMPANIES,
      'Empresa',
    );
    const metric = this.normalizeMetric(domain, data?.metric);
    if (
      domain === 'AIR_EMISSION' &&
      !(
        typeof data?.amount === 'number' ||
        (typeof data?.amount === 'string' &&
          /^\d+(?:[,.]\d+)?$/.test(data.amount.trim()))
      )
    ) {
      throw new BadRequestException(
        'Resultado deve conter somente números e, opcionalmente, decimais',
      );
    }
    const amount = parseNumber(
      data?.amount,
      domain === 'AIR_EMISSION' ? 'Resultado' : 'Quantidade',
    );
    const pollutant =
      domain === 'AIR_EMISSION'
        ? AIR_POLLUTANTS[metric as keyof typeof AIR_POLLUTANTS]
        : null;
    const unit = pollutant?.unit || optionalText(data?.unit, 50);
    if (!unit) throw new BadRequestException('Unidade é obrigatória');
    const factorId =
      domain === 'AIR_EMISSION' ? null : optionalText(data?.factorId, 80);
    let co2eKg: Prisma.Decimal | null = null;

    if (domain === 'GHG') {
      if (!factorId) {
        throw new BadRequestException('Selecione um fator de emissão');
      }
      const factor = await this.prisma.environmentalEmissionFactor.findUnique({
        where: { id: factorId },
      });
      if (!factor || !factor.active) {
        throw new BadRequestException('Fator de emissão inválido ou inativo');
      }
      if (factor.category !== metric || factor.activityUnit !== unit) {
        throw new BadRequestException(
          'Categoria/unidade do registro não corresponde ao fator selecionado',
        );
      }
      co2eKg = new Prisma.Decimal(amount)
        .mul(factor.factorValue)
        .toDecimalPlaces(6);
    }

    const recordedAt = parseDate(data?.recordedAt, 'Data da medição', false);
    if (domain === 'OPACITY' && !recordedAt) {
      throw new BadRequestException('Data e hora da medição são obrigatórias');
    }
    if (
      domain === 'OPACITY' &&
      (!Number.isInteger(amount) || amount < 1 || amount > 5)
    ) {
      throw new BadRequestException(
        'Resultado Ringelmann deve estar entre 1 e 5',
      );
    }
    if (domain === 'AIR_EMISSION' && !recordedAt) {
      throw new BadRequestException('Data da realização é obrigatória');
    }
    const competence = parseCompetence(data?.competence);
    if (
      domain === 'AIR_EMISSION' &&
      monthKey(competence) !== monthKey(recordedAt!)
    ) {
      throw new BadRequestException(
        'Competência deve corresponder à data da realização',
      );
    }

    const details = parseDetails(data?.details) as Record<string, unknown>;
    if (pollutant) {
      const evaluator = optionalText(details.evaluator, 180);
      if (!evaluator) {
        throw new BadRequestException(
          'Responsável pela avaliação é obrigatório',
        );
      }
      details.lme = optionalText(details.lme, 500);
      details.evaluator = evaluator;
      details.regulation = pollutant.regulation;
    }

    return {
      domain,
      metric,
      company,
      competence,
      recordedAt,
      site: optionalText(data?.site, 180),
      asset: optionalText(data?.asset, 180),
      amount: new Prisma.Decimal(amount.toString()),
      unit,
      co2eKg,
      factorId: factorId || null,
      status: optionalText(data?.status, 40) || 'VALID',
      details: details as Prisma.InputJsonValue,
      notes: optionalText(data?.notes, 4000),
      source: 'MANUAL',
    };
  }

  private normalizeMetric(domain: string, value: unknown) {
    if (domain === 'RESOURCE') {
      return enumValue(value, RESOURCE_METRICS, 'Indicador');
    }
    if (domain === 'WASTE') {
      return enumValue(value, WASTE_METRICS, 'Categoria do resíduo');
    }
    if (domain === 'OPACITY') return 'RINGELMANN';
    if (domain === 'AIR_EMISSION') {
      return enumValue(value, AIR_POLLUTANT_METRICS, 'Poluente');
    }
    return enumValue(value, GHG_METRICS, 'Categoria de emissão');
  }

  private async ensureRecord(id: string) {
    const record = await this.prisma.environmentalRecord.findUnique({
      where: { id },
    });
    if (!record || !record.active) {
      throw new NotFoundException('Registro ambiental não encontrado');
    }
    return record;
  }

  private serializeRecord(record: any) {
    return {
      ...record,
      amount: decimal(record.amount),
      co2eKg: decimal(record.co2eKg),
      factor: record.factor
        ? { ...record.factor, factorValue: Number(record.factor.factorValue) }
        : null,
      attachments: parseAttachments(record.attachments),
    };
  }
}
