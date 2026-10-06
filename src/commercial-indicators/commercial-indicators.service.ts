import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_ROLES = new Set([
  'admin',
  'administrador',
  'licitacao',
  'licitacao_gestor',
  'gestor',
  'ceo',
]);
export const PROCESS_ROUTES = new Set([
  'EMISSAO_ART',
  'INSERCAO_OBRA_NOVA_SISTEMA',
  'INSERCAO_ADITIVO_SISTEMA',
  'RETORNO_ORCAMENTO_PARTICULAR',
]);
const LEGACY_WORK_ROUTE = 'INSERCAO_OBRA_SISTEMA';
export const WORK_PROCESS_TARGET_BUSINESS_DAYS = 5;

const OPPORTUNITY_STATUSES = new Set([
  'Em andamento',
  'Ganha',
  'Perdida',
  'Cancelada',
  'Sem concorrência',
]);

function normalizeRole(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function requiredText(value: unknown, field: string) {
  const normalized = text(value);
  if (!normalized) throw new BadRequestException(`${field} é obrigatório`);
  return normalized;
}

function parseDate(value: unknown, field: string) {
  const normalized = text(value);
  if (!normalized) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new BadRequestException(`${field} inválida`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException(`${field} inválida`);
  }
  return date;
}

function requiredDate(value: unknown, field: string) {
  const parsed = parseDate(value, field);
  if (!parsed) throw new BadRequestException(`${field} é obrigatória`);
  return parsed;
}

function parseInteger(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
    throw new BadRequestException(`${field} inválido`);
  }
  return parsed;
}

function parseMoney(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} inválido`);
    }
    return new Prisma.Decimal(value.toFixed(2));
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} inválido`);
  }
  const raw = String(value)
    .trim()
    .replace(/[^\d,.-]/g, '');
  if (!raw) return null;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const decimalIndex = Math.max(comma, dot);
  const integer = (decimalIndex < 0 ? raw : raw.slice(0, decimalIndex)).replace(
    /[^\d-]/g,
    '',
  );
  const decimals =
    decimalIndex < 0
      ? ''
      : raw
          .slice(decimalIndex + 1)
          .replace(/\D/g, '')
          .slice(0, 2);
  const parsed = Number(`${integer || '0'}${decimals ? `.${decimals}` : ''}`);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} inválido`);
  }
  return new Prisma.Decimal(parsed.toFixed(2));
}

function dateOnly(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function addBusinessDays(start: Date, days: number) {
  const result = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function calendarDaysBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function businessDaysBetween(start: Date, end: Date) {
  if (end.getTime() < start.getTime()) return null;
  const cursor = new Date(start);
  let count = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function normalizeProcessRoute(data: any) {
  const requestedRoute = requiredText(data?.route, 'Rota').toUpperCase();
  if (requestedRoute !== LEGACY_WORK_ROUTE) return requestedRoute;
  return String(data?.launchType || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .includes('ADITIVO')
    ? 'INSERCAO_ADITIVO_SISTEMA'
    : 'INSERCAO_OBRA_NOVA_SISTEMA';
}

export function processDerived(data: any) {
  const route = normalizeProcessRoute(data);
  if (!PROCESS_ROUTES.has(route)) {
    throw new BadRequestException('Rota inválida');
  }

  const contractSignedSentAt = parseDate(
    data?.contractSignedSentAt,
    'Data do envio do contrato assinado',
  );
  const launchEmailSentAt = parseDate(
    data?.launchEmailSentAt,
    'Data de envio do e-mail',
  );
  const workOpenedAt = parseDate(
    data?.workOpenedAt,
    'Data de conclusão da reabertura da obra',
  );
  const documentsSentAt = parseDate(
    data?.documentsSentAt,
    'Data de envio dos documentos',
  );
  const explicitStart = parseDate(data?.startDate, 'Data de início');
  const isWorkProcess = [
    'INSERCAO_OBRA_NOVA_SISTEMA',
    'INSERCAO_ADITIVO_SISTEMA',
  ].includes(route);
  if (isWorkProcess && !launchEmailSentAt) {
    throw new BadRequestException('Data de envio do e-mail é obrigatória');
  }
  const startDate =
    route === 'EMISSAO_ART'
      ? contractSignedSentAt
      : isWorkProcess
        ? launchEmailSentAt
        : route === 'RETORNO_ORCAMENTO_PARTICULAR'
          ? documentsSentAt
          : explicitStart;
  const plannedBusinessDays = isWorkProcess
    ? WORK_PROCESS_TARGET_BUSINESS_DAYS
    : parseInteger(data?.plannedBusinessDays, 'Prazo em dias úteis');
  const dueDate =
    startDate && plannedBusinessDays !== null
      ? addBusinessDays(startDate, plannedBusinessDays)
      : parseDate(data?.dueDate, 'Data limite');
  const completedDate = parseDate(data?.completedDate, 'Data de conclusão');
  if (
    route === 'INSERCAO_ADITIVO_SISTEMA' &&
    workOpenedAt &&
    launchEmailSentAt &&
    workOpenedAt.getTime() < launchEmailSentAt.getTime()
  ) {
    throw new BadRequestException(
      'A reabertura da obra não pode terminar antes do e-mail',
    );
  }
  if (route === 'INSERCAO_ADITIVO_SISTEMA' && completedDate && !workOpenedAt) {
    throw new BadRequestException(
      'Informe a conclusão da reabertura antes de finalizar o aditivo',
    );
  }
  if (
    route === 'INSERCAO_ADITIVO_SISTEMA' &&
    completedDate &&
    workOpenedAt &&
    completedDate.getTime() < workOpenedAt.getTime()
  ) {
    throw new BadRequestException(
      'O lançamento do aditivo não pode terminar antes da reabertura',
    );
  }
  const inconsistent = Boolean(
    startDate && completedDate && completedDate.getTime() < startDate.getTime(),
  );
  const elapsedBusinessDays =
    !inconsistent && startDate && completedDate
      ? businessDaysBetween(startDate, completedDate)
      : null;
  const elapsedCalendarDays =
    !inconsistent && startDate && completedDate
      ? Math.max(0, calendarDaysBetween(startDate, completedDate))
      : null;

  return {
    route,
    competition: text(data?.competition),
    contractNumber: text(data?.contractNumber),
    contractingParty: text(data?.contractingParty),
    launchType:
      route === 'INSERCAO_OBRA_NOVA_SISTEMA'
        ? 'OBRA NOVA'
        : route === 'INSERCAO_ADITIVO_SISTEMA'
          ? 'ADITIVO'
          : text(data?.launchType),
    requester: text(data?.requester),
    objectSummary: text(data?.objectSummary),
    client: text(data?.client),
    complexity: text(data?.complexity)?.toUpperCase() || null,
    filledAt: parseDate(data?.filledAt, 'Data de preenchimento'),
    contractSignedSentAt,
    launchEmailSentAt,
    workOpenedAt: route === 'INSERCAO_ADITIVO_SISTEMA' ? workOpenedAt : null,
    registrationConsultSentAt: parseDate(
      data?.registrationConsultSentAt,
      'Data da consulta de cadastro',
    ),
    registrationReturnedAt: parseDate(
      data?.registrationReturnedAt,
      'Data do retorno de cadastro',
    ),
    documentsSentAt,
    startDate,
    plannedBusinessDays,
    dueDate,
    completedDate,
    elapsedCalendarDays,
    elapsedBusinessDays,
    responsible:
      route === 'INSERCAO_OBRA_NOVA_SISTEMA'
        ? 'Orçamento'
        : route === 'INSERCAO_ADITIVO_SISTEMA'
          ? 'Administrativo → Orçamento'
          : text(data?.responsible),
    notes: text(data?.notes),
  };
}

@Injectable()
export class CommercialIndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!ALLOWED_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException('Sem permissão para indicadores comerciais');
    }
  }

  private opportunityData(data: any) {
    const status = text(data?.status);
    if (status && !OPPORTUNITY_STATUSES.has(status)) {
      throw new BadRequestException('Status da oportunidade inválido');
    }
    const hadCompetition =
      data?.hadCompetition === null ||
      data?.hadCompetition === undefined ||
      data?.hadCompetition === ''
        ? null
        : data.hadCompetition === true ||
          String(data.hadCompetition).toLowerCase() === 'sim' ||
          String(data.hadCompetition).toLowerCase() === 'true';
    return {
      entryDate: requiredDate(data?.entryDate, 'Data de entrada'),
      client: requiredText(data?.client, 'Cliente'),
      project: text(data?.project),
      city: text(data?.city),
      state: text(data?.state)?.toUpperCase() || null,
      commercialResponsible: text(data?.commercialResponsible),
      segment: text(data?.segment),
      contractType: text(data?.contractType),
      opportunitySource: text(data?.opportunitySource),
      hadCompetition,
      disputedValue: parseMoney(data?.disputedValue, 'Valor disputado'),
      closedValue: parseMoney(data?.closedValue, 'Valor fechado'),
      status,
      lossReason: text(data?.lossReason),
      notes: text(data?.notes),
    };
  }

  async listOpportunities(role?: string | null) {
    this.ensureAccess(role);
    const rows = await this.prisma.commercialOpportunity.findMany({
      where: { active: true },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.serializeOpportunity(row));
  }

  async createOpportunity(data: any, role?: string | null, actorId?: string) {
    this.ensureAccess(role);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.commercialOpportunity.create({
        data: {
          ...this.opportunityData(data),
          sourceType: 'JR_MANUAL',
          createdById: actorId || null,
          updatedById: actorId || null,
        },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'OPPORTUNITY',
          entityId: row.id,
          opportunityId: row.id,
          action: 'CREATE',
          actorId: actorId || null,
          afterData: this.serializeOpportunity(row) as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.serializeOpportunity(created);
  }

  async updateOpportunity(
    id: string,
    data: any,
    role?: string | null,
    actorId?: string,
  ) {
    this.ensureAccess(role);
    const existing = await this.prisma.commercialOpportunity.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException('Oportunidade não encontrada');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.commercialOpportunity.update({
        where: { id },
        data: { ...this.opportunityData(data), updatedById: actorId || null },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'OPPORTUNITY',
          entityId: id,
          opportunityId: id,
          action: 'UPDATE',
          actorId: actorId || null,
          beforeData: this.serializeOpportunity(
            existing,
          ) as Prisma.InputJsonValue,
          afterData: this.serializeOpportunity(row) as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.serializeOpportunity(updated);
  }

  async removeOpportunity(id: string, role?: string | null, actorId?: string) {
    this.ensureAccess(role);
    const existing = await this.prisma.commercialOpportunity.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException('Oportunidade não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialOpportunity.update({
        where: { id },
        data: { active: false, updatedById: actorId || null },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'OPPORTUNITY',
          entityId: id,
          opportunityId: id,
          action: 'DELETE',
          actorId: actorId || null,
          beforeData: this.serializeOpportunity(
            existing,
          ) as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true };
  }

  async listProcesses(role?: string | null) {
    this.ensureAccess(role);
    const rows = await this.prisma.commercialProcessRecord.findMany({
      where: { active: true },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.serializeProcess(row));
  }

  async createProcess(data: any, role?: string | null, actorId?: string) {
    this.ensureAccess(role);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.commercialProcessRecord.create({
        data: {
          ...processDerived(data),
          sourceType: 'JR_MANUAL',
          createdById: actorId || null,
          updatedById: actorId || null,
        },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'PROCESS',
          entityId: row.id,
          processId: row.id,
          action: 'CREATE',
          actorId: actorId || null,
          afterData: this.serializeProcess(row) as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.serializeProcess(created);
  }

  async updateProcess(
    id: string,
    data: any,
    role?: string | null,
    actorId?: string,
  ) {
    this.ensureAccess(role);
    const existing = await this.prisma.commercialProcessRecord.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException('Lançamento não encontrado');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.commercialProcessRecord.update({
        where: { id },
        data: { ...processDerived(data), updatedById: actorId || null },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'PROCESS',
          entityId: id,
          processId: id,
          action: 'UPDATE',
          actorId: actorId || null,
          beforeData: this.serializeProcess(existing) as Prisma.InputJsonValue,
          afterData: this.serializeProcess(row) as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.serializeProcess(updated);
  }

  async removeProcess(id: string, role?: string | null, actorId?: string) {
    this.ensureAccess(role);
    const existing = await this.prisma.commercialProcessRecord.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException('Lançamento não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialProcessRecord.update({
        where: { id },
        data: { active: false, updatedById: actorId || null },
      });
      await tx.commercialIndicatorAudit.create({
        data: {
          entityType: 'PROCESS',
          entityId: id,
          processId: id,
          action: 'DELETE',
          actorId: actorId || null,
          beforeData: this.serializeProcess(existing) as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true };
  }

  async listAudit(role?: string | null) {
    this.ensureAccess(role);
    const rows = await this.prisma.commercialIndicatorAudit.findMany({
      orderBy: { changedAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      ...row,
      changedAt: row.changedAt.toISOString(),
    }));
  }

  async dashboard(role?: string | null) {
    this.ensureAccess(role);
    const [opportunities, processes] = await Promise.all([
      this.listOpportunities(role),
      this.listProcesses(role),
    ]);
    const decided = opportunities.filter((row) =>
      ['Ganha', 'Perdida'].includes(row.status || ''),
    );
    const won = decided.filter((row) => row.status === 'Ganha');
    const completed = processes.filter(
      (row) => row.completedDate && row.elapsedBusinessDays !== null,
    );
    const onTime = completed.filter(
      (row) =>
        row.plannedBusinessDays !== null &&
        row.elapsedBusinessDays! <= row.plannedBusinessDays!,
    );
    const byRoute = [...PROCESS_ROUTES].map((route) => {
      const rows = completed.filter((row) => row.route === route);
      return {
        route,
        total: processes.filter((row) => row.route === route).length,
        completed: rows.length,
        averageBusinessDays: rows.length
          ? rows.reduce((sum, row) => sum + (row.elapsedBusinessDays || 0), 0) /
            rows.length
          : null,
        onTimeRate: rows.length
          ? (rows.filter(
              (row) =>
                row.plannedBusinessDays !== null &&
                row.elapsedBusinessDays! <= row.plannedBusinessDays!,
            ).length /
              rows.length) *
            100
          : null,
      };
    });
    return {
      opportunities: {
        total: opportunities.length,
        disputedValue: opportunities.reduce(
          (sum, row) => sum + (row.disputedValue || 0),
          0,
        ),
        closedValue: opportunities.reduce(
          (sum, row) => sum + (row.closedValue || 0),
          0,
        ),
        won: won.length,
        lost: decided.length - won.length,
        conversionRate: decided.length
          ? (won.length / decided.length) * 100
          : null,
      },
      processes: {
        total: processes.length,
        completed: completed.length,
        onTimeRate: completed.length
          ? (onTime.length / completed.length) * 100
          : null,
        byRoute,
      },
    };
  }

  private serializeOpportunity(row: any) {
    return {
      ...row,
      entryDate: dateOnly(row.entryDate),
      disputedValue:
        row.disputedValue === null ? null : Number(row.disputedValue),
      closedValue: row.closedValue === null ? null : Number(row.closedValue),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeProcess(row: any) {
    const serialized = { ...row };
    for (const key of [
      'filledAt',
      'contractSignedSentAt',
      'launchEmailSentAt',
      'workOpenedAt',
      'registrationConsultSentAt',
      'registrationReturnedAt',
      'documentsSentAt',
      'startDate',
      'dueDate',
      'completedDate',
    ]) {
      serialized[key] = dateOnly(row[key]);
    }
    serialized.createdAt = row.createdAt.toISOString();
    serialized.updatedAt = row.updatedAt.toISOString();
    serialized.status = !row.startDate
      ? 'Não iniciado'
      : !row.completedDate
        ? 'Em andamento'
        : row.completedDate < row.startDate
          ? 'Inconsistente'
          : 'Concluído';
    serialized.onTime =
      row.completedDate && row.dueDate
        ? row.completedDate.getTime() <= row.dueDate.getTime()
        : null;
    return serialized;
  }
}
