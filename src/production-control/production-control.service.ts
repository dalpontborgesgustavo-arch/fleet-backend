import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  monthWeeks,
  optionalText,
  parseCompetence,
  parseDateInMonth,
  parseQuantity,
  parseUnitPrice,
  requiredText,
} from './production-control.rules';

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Dados inválidos.');
  }
  return value as Record<string, unknown>;
}

@Injectable()
export class ProductionControlService {
  constructor(private readonly prisma: PrismaService) {}

  async list(competenceInput: unknown) {
    const competence = parseCompetence(competenceInput);
    const lines = await this.prisma.productionControlLine.findMany({
      where: { competence },
      include: {
        daily: { orderBy: { productionDate: 'asc' } },
        weeks: { orderBy: { weekIndex: 'asc' } },
      },
      orderBy: [{ engineer: 'asc' }, { workName: 'asc' }, { activity: 'asc' }],
    });
    return { competence, weeks: monthWeeks(competence), lines };
  }

  async create(bodyInput: unknown, actorId: string) {
    const body = objectBody(bodyInput);
    const competence = parseCompetence(body.competence);
    const engineer = requiredText(body.engineer, 'Engenheiro');
    const workName = requiredText(body.workName, 'Obra');
    const activity = requiredText(body.activity, 'Serviço');
    const unit = requiredText(body.unit, 'Unidade', 20);
    const unitPrice = parseUnitPrice(body.unitPrice);
    const existing = await this.prisma.productionControlLine.findFirst({
      where: { competence, engineer, workName, activity },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(
        'Este serviço já existe para a obra, engenheiro e mês.',
      );
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.productionControlLine.create({
        data: {
          competence,
          engineer,
          workName,
          activity,
          unit,
          municipality: optionalText(body.municipality),
          workCode: optionalText(body.workCode, 60),
          unitPrice: unitPrice === null ? null : new Prisma.Decimal(unitPrice),
          createdByUserId: actorId,
          updatedByUserId: actorId,
        },
      });
      await tx.productionControlRevision.create({
        data: {
          lineId: line.id,
          action: 'CREATE_LINE',
          after: { competence, engineer, workName, activity, unit, unitPrice },
          changedByUserId: actorId,
        },
      });
      return line;
    });
  }

  async updateLine(lineId: string, bodyInput: unknown, actorId: string) {
    const body = objectBody(bodyInput);
    const current = await this.prisma.productionControlLine.findUnique({
      where: { id: lineId },
    });
    if (!current) throw new NotFoundException('Serviço não encontrado.');
    const data: Prisma.ProductionControlLineUpdateInput = {
      updatedByUserId: actorId,
    };
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const key of ['engineer', 'workName'] as const) {
      if (!(key in body)) continue;
      const next = requiredText(
        body[key],
        key === 'engineer' ? 'Engenheiro' : 'Obra',
      );
      if (next === current[key]) continue;
      data[key] = next;
      before[key] = current[key];
      after[key] = next;
    }
    for (const key of ['municipality', 'workCode'] as const) {
      if (!(key in body)) continue;
      const next = optionalText(body[key], key === 'workCode' ? 60 : 160);
      if (next === current[key]) continue;
      data[key] = next;
      before[key] = current[key];
      after[key] = next;
    }
    if ('unitPrice' in body) {
      const next = parseUnitPrice(body.unitPrice);
      const old = current.unitPrice?.toString() ?? null;
      if (
        next !== old &&
        !(next !== null && old !== null && Number(next) === Number(old))
      ) {
        data.unitPrice = next === null ? null : new Prisma.Decimal(next);
        before.unitPrice = old;
        after.unitPrice = next;
      }
    }
    if (Object.keys(after).length === 0) return current;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productionControlLine.update({
        where: { id: lineId },
        data,
      });
      await tx.productionControlRevision.create({
        data: {
          lineId,
          action: 'UPDATE_LINE',
          before,
          after,
          changedByUserId: actorId,
        },
      });
      return updated;
    });
  }

  async setDaily(
    lineId: string,
    dateInput: string,
    bodyInput: unknown,
    actorId: string,
  ) {
    const body = objectBody(bodyInput);
    const line = await this.prisma.productionControlLine.findUnique({
      where: { id: lineId },
      select: { competence: true },
    });
    if (!line) throw new NotFoundException('Serviço não encontrado.');
    const productionDate = parseDateInMonth(dateInput, line.competence);
    const quantity = parseQuantity(body.quantity, 'Quantidade', true);
    return this.prisma.$transaction(async (tx) => {
      const where = { lineId_productionDate: { lineId, productionDate } };
      const prior = await tx.productionControlDaily.findUnique({ where });
      if (quantity === null) {
        if (prior) await tx.productionControlDaily.delete({ where });
      } else if (prior) {
        await tx.productionControlDaily.update({
          where,
          data: {
            quantity: new Prisma.Decimal(quantity),
            updatedByUserId: actorId,
          },
        });
      } else {
        await tx.productionControlDaily.create({
          data: {
            lineId,
            productionDate,
            quantity: new Prisma.Decimal(quantity),
            updatedByUserId: actorId,
          },
        });
      }
      if ((prior?.quantity.toString() ?? null) !== quantity) {
        await tx.productionControlRevision.create({
          data: {
            lineId,
            action: 'SET_DAILY',
            before: {
              date: dateInput,
              quantity: prior?.quantity.toString() ?? null,
            },
            after: { date: dateInput, quantity },
            changedByUserId: actorId,
          },
        });
      }
      return { date: dateInput, quantity };
    });
  }

  async setWeek(
    lineId: string,
    weekIndexInput: string,
    bodyInput: unknown,
    actorId: string,
  ) {
    const body = objectBody(bodyInput);
    const line = await this.prisma.productionControlLine.findUnique({
      where: { id: lineId },
      select: { competence: true },
    });
    if (!line) throw new NotFoundException('Serviço não encontrado.');
    const weekIndex = Number(weekIndexInput);
    if (
      !Number.isInteger(weekIndex) ||
      !monthWeeks(line.competence)[weekIndex]
    ) {
      throw new BadRequestException('Semana inválida para o mês.');
    }
    const hasWeeklyPlan = 'weeklyPlanQuantity' in body;
    const hasMonthPlan = 'monthPlanQuantity' in body;
    if (!hasWeeklyPlan && !hasMonthPlan)
      throw new BadRequestException('Informe a meta a atualizar.');
    const weeklyPlanQuantity = hasWeeklyPlan
      ? parseQuantity(body.weeklyPlanQuantity, 'Previsão semanal', true)
      : undefined;
    const monthPlanQuantity = hasMonthPlan
      ? parseQuantity(body.monthPlanQuantity, 'Meta mensal da semana', true)
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      const where = { lineId_weekIndex: { lineId, weekIndex } };
      const prior = await tx.productionControlWeek.findUnique({ where });
      const data = {
        ...(hasWeeklyPlan
          ? {
              weeklyPlanQuantity:
                weeklyPlanQuantity === null
                  ? null
                  : new Prisma.Decimal(weeklyPlanQuantity!),
            }
          : {}),
        ...(hasMonthPlan
          ? {
              monthPlanQuantity:
                monthPlanQuantity === null
                  ? null
                  : new Prisma.Decimal(monthPlanQuantity!),
            }
          : {}),
        updatedByUserId: actorId,
      };
      const week = prior
        ? await tx.productionControlWeek.update({ where, data })
        : await tx.productionControlWeek.create({
            data: {
              lineId,
              weekIndex,
              weeklyPlanQuantity: null,
              monthPlanQuantity: null,
              ...data,
            },
          });
      const nextWeekly = week.weeklyPlanQuantity?.toString() ?? null;
      const nextMonthly = week.monthPlanQuantity?.toString() ?? null;
      if (
        (prior?.weeklyPlanQuantity?.toString() ?? null) !== nextWeekly ||
        (prior?.monthPlanQuantity?.toString() ?? null) !== nextMonthly
      ) {
        await tx.productionControlRevision.create({
          data: {
            lineId,
            action: 'SET_WEEK',
            before: {
              weekIndex,
              weeklyPlanQuantity: prior?.weeklyPlanQuantity?.toString() ?? null,
              monthPlanQuantity: prior?.monthPlanQuantity?.toString() ?? null,
            },
            after: {
              weekIndex,
              weeklyPlanQuantity: nextWeekly,
              monthPlanQuantity: nextMonthly,
            },
            changedByUserId: actorId,
          },
        });
      }
      return week;
    });
  }

  async revisions(lineId: string) {
    const line = await this.prisma.productionControlLine.findUnique({
      where: { id: lineId },
      select: { id: true },
    });
    if (!line) throw new NotFoundException('Serviço não encontrado.');
    return this.prisma.productionControlRevision.findMany({
      where: { lineId },
      orderBy: { changedAt: 'desc' },
      take: 100,
    });
  }
}
