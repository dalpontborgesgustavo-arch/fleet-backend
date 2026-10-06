import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canAccessUsinaMonthlyCost } from './usina-monthly-cost.rules';

const READ_ROLES = new Set([
  'admin', 'administrador', 'licitacao_gestor', 'licitacao', 'gestor', 'ceo',
]);
const AMOUNT_FIELDS = [
  'maintenancePlanned',
  'dieselPlanned',
  'depreciationPlanned',
  'laborPlanned',
  'revenuePlanned',
] as const;

type AmountField = (typeof AMOUNT_FIELDS)[number];
type MonthlyAmounts = Record<AmountField, Prisma.Decimal | null>;

function parseMonth(value: unknown) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new BadRequestException('Competencia deve estar no formato AAAA-MM.');
  }
  return { key: text, date: new Date(`${text}-01T00:00:00.000Z`) };
}

function parseGroupKey(value: unknown) {
  const key = String(value ?? '').trim().toUpperCase();
  const isLegacyKey = /^[A-Z0-9_]{1,80}$/.test(key);
  const isSubgroupKey = key.startsWith('SUBGROUP:') && key.length > 'SUBGROUP:'.length;
  const isRollerKey = /^ROLLER:(CHAPA|PNEU|TERRAPLANAGEM)$/.test(key);
  if (key.length > 160 || /[\u0000-\u001f\u007f]/.test(key) || !(isLegacyKey || isSubgroupKey || isRollerKey)) {
    throw new BadRequestException('groupKey do grupo de frota invalido.');
  }
  return key;
}

function parseAmounts(body: unknown): MonthlyAmounts {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Informe os cinco valores previstos.');
  }
  const input = body as Record<string, unknown>;
  const amounts = {} as MonthlyAmounts;
  for (const field of AMOUNT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new BadRequestException(`${field} e obrigatorio; use null para vazio.`);
    }
    const raw = input[field];
    if (raw === null || raw === '') {
      amounts[field] = null;
      continue;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new BadRequestException(`${field} deve ser um valor monetario ou null.`);
    }
    const value = String(raw).trim().replace(',', '.');
    if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value)) {
      throw new BadRequestException(`${field} deve ser nao negativo, com ate duas casas decimais.`);
    }
    amounts[field] = new Prisma.Decimal(value);
  }
  return amounts;
}

function amountSnapshot(amounts: MonthlyAmounts) {
  return Object.fromEntries(
    AMOUNT_FIELDS.map((field) => [field, amounts[field]?.toFixed(2) ?? null]),
  ) as Record<AmountField, string | null>;
}

@Injectable()
export class FleetResultMonthlySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureRead(role?: string | null) {
    if (!READ_ROLES.has(String(role ?? '').trim().toLowerCase())) {
      throw new ForbiddenException('Sem permissao para acessar os resultados da frota.');
    }
  }

  private ensureWrite(role?: string | null) {
    if (!canAccessUsinaMonthlyCost(role)) {
      throw new ForbiddenException('Sem permissao para configurar os resultados da frota.');
    }
  }

  private serialize(row: { groupKey: string } & MonthlyAmounts) {
    return {
      groupKey: row.groupKey,
      ...amountSnapshot(row),
    };
  }

  async findMonth(competenceValue: unknown, role?: string | null) {
    this.ensureRead(role);
    const competence = parseMonth(competenceValue);
    const rows = await this.prisma.fleetResultMonthlySetting.findMany({
      where: { competence: competence.date },
      orderBy: { groupKey: 'asc' },
    });
    return { competence: competence.key, rows: rows.map((row) => this.serialize(row)) };
  }

  async saveMonth(
    queryCompetence: unknown,
    body: unknown,
    actorId?: string | null,
    role?: string | null,
  ) {
    this.ensureWrite(role);
    if (!actorId) throw new BadRequestException('Usuario autenticado nao encontrado.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Informe competencia e rows.');
    }
    const input = body as Record<string, unknown>;
    const competence = parseMonth(input.competence);
    if (queryCompetence !== undefined && parseMonth(queryCompetence).key !== competence.key) {
      throw new BadRequestException('Competencia da URL difere da competencia do corpo.');
    }
    if (!Array.isArray(input.rows)) {
      throw new BadRequestException('rows deve ser uma lista de grupos.');
    }
    const rows = input.rows.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('Cada grupo deve ser um objeto.');
      }
      const record = value as Record<string, unknown>;
      return { groupKey: parseGroupKey(record.groupKey), amounts: parseAmounts(record) };
    });
    if (new Set(rows.map((row) => row.groupKey)).size !== rows.length) {
      throw new BadRequestException('groupKey duplicado na mesma solicitacao.');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const { groupKey, amounts } of rows) {
        const where = { competence_groupKey: { competence: competence.date, groupKey } };
        const before = await tx.fleetResultMonthlySetting.findUnique({ where });
        const saved = await tx.fleetResultMonthlySetting.upsert({
          where,
          create: {
            competence: competence.date,
            groupKey,
            ...amounts,
            createdById: actorId,
            updatedById: actorId,
          },
          update: { ...amounts, updatedById: actorId },
        });
        await tx.fleetResultMonthlySettingAudit.create({
          data: {
            settingId: saved.id,
            action: before ? 'UPDATED' : 'CREATED',
            actorId,
            beforeData: before ? amountSnapshot(before) : Prisma.JsonNull,
            afterData: amountSnapshot(saved),
          },
        });
      }
    });
    return this.findMonth(competence.key, role);
  }
}
