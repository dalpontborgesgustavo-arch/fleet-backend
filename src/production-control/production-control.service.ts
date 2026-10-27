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
import {
  municipalityFromWorkName,
  normalizedName,
  PRODUCTION_SERVICES,
  uniqueCanonicalName,
} from './production-control.catalog';

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Dados inválidos.');
  }
  return value as Record<string, unknown>;
}

function sourceText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

@Injectable()
export class ProductionControlService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog() {
    const [state, prior, contracts] = await Promise.all([
      this.prisma.constructionControlState.findUnique({
        where: { id: 'default' },
      }),
      this.prisma.productionControlLine.findMany({
        distinct: ['engineer'],
        select: { engineer: true },
      }),
      this.prisma.aethosContract.findMany({
        where: { active: true, engineerName: { not: null } },
        distinct: ['engineerName'],
        select: { engineerName: true },
      }),
    ]);
    const data = (state?.data || {}) as Record<string, unknown>;
    const activeEngineers = Array.isArray(data.engineers)
      ? data.engineers
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => entry as Record<string, unknown>)
          .filter((entry) => entry.status === 'Ativo')
          .map((entry) => sourceText(entry.nome))
      : [];
    const contractNames = contracts
      .map((entry) => entry.engineerName?.trim() || '')
      .filter(Boolean);
    const engineers = [
      ...new Set(
        [...activeEngineers, ...prior.map((entry) => entry.engineer)]
          .map(
            (name) =>
              uniqueCanonicalName(name, activeEngineers) ||
              uniqueCanonicalName(name, contractNames) ||
              name,
          )
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { services: PRODUCTION_SERVICES, engineers };
  }

  async findWork(codeInput: string) {
    const code = codeInput.trim();
    if (!/^\d{1,12}$/.test(code)) {
      throw new BadRequestException('Informe um código de obra válido.');
    }
    const obra = await this.prisma.aethosObra.findUnique({
      where: { code },
      select: { code: true, name: true, active: true },
    });
    if (!obra) throw new NotFoundException('Obra não encontrada no JR.');
    const [state, contracts, prior] = await Promise.all([
      this.prisma.constructionControlState.findUnique({
        where: { id: 'default' },
      }),
      this.prisma.aethosContract.findMany({
        where: {
          workAethosId: code,
          active: true,
          engineerName: { not: null },
        },
        select: { engineerName: true },
      }),
      this.prisma.productionControlLine.findMany({
        where: { workCode: code },
        select: { workName: true, engineer: true, municipality: true },
      }),
    ]);
    const data = (state?.data || {}) as Record<string, unknown>;
    const works = Array.isArray(data.works) ? data.works : [];
    const work = works.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        sourceText((item as Record<string, unknown>).codigoObra) === code,
    ) as Record<string, unknown> | undefined;
    const stateEngineers = Array.isArray(data.engineers)
      ? data.engineers
          .filter((item) => item && typeof item === 'object')
          .map((item) => item as Record<string, unknown>)
          .filter((item) => item.status === 'Ativo')
          .map((item) => sourceText(item.nome))
      : [];
    const contractNames = [
      ...new Set(
        contracts.map((item) => item.engineerName?.trim()).filter(Boolean),
      ),
    ] as string[];
    const confirmedPrior = prior.filter((item) => {
      const alias = normalizedName(item.workName);
      return alias.length >= 8 && normalizedName(obra.name).includes(alias);
    });
    const historicalNames = [
      ...new Set(confirmedPrior.map((item) => item.engineer)),
    ];
    const historicalEngineer =
      historicalNames.length === 1 ? historicalNames[0] : null;
    const engineer =
      (sourceText(work?.engenheiro)
        ? uniqueCanonicalName(sourceText(work?.engenheiro), stateEngineers) ||
          sourceText(work?.engenheiro)
        : null) ||
      (historicalEngineer
        ? uniqueCanonicalName(historicalEngineer, stateEngineers) ||
          uniqueCanonicalName(historicalEngineer, contractNames) ||
          historicalEngineer
        : null) ||
      (contractNames.length === 1
        ? uniqueCanonicalName(contractNames[0], stateEngineers) ||
          contractNames[0]
        : null);
    const knownCities = [
      ...works.map((item) =>
        item && typeof item === 'object'
          ? sourceText((item as Record<string, unknown>).cidade)
          : '',
      ),
      ...confirmedPrior.map((item) => item.municipality || ''),
    ].filter(Boolean);
    const workName = normalizedName(obra.name);
    const matchingCities = [
      ...new Set(
        knownCities.filter((city) => {
          const normalized = normalizedName(city);
          return (
            workName.startsWith(`${normalized} `) ||
            workName.startsWith(`${normalized} SC `) ||
            workName.startsWith(`SIE SC ${normalized} `)
          );
        }),
      ),
    ];
    const municipality =
      sourceText(work?.cidade) ||
      (matchingCities.length === 1 ? matchingCities[0] : null) ||
      municipalityFromWorkName(obra.name);
    return {
      code: obra.code,
      name: obra.name,
      active: obra.active,
      engineer,
      municipality,
      engineerNeedsReview: !engineer,
      municipalityNeedsReview: !municipality,
    };
  }

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
    const activity = requiredText(body.activity, 'Serviço');
    const service = PRODUCTION_SERVICES.find(
      (item) => item.activity === activity,
    );
    if (!service)
      throw new BadRequestException('Selecione um serviço da lista.');
    const work = await this.findWork(
      requiredText(body.workCode, 'Código da obra', 12),
    );
    const workName = work.name;
    const unit = service.unit;
    const unitPrice = parseUnitPrice(body.unitPrice ?? service.suggestedPrice);
    const existing = await this.prisma.productionControlLine.findFirst({
      where: { competence, workCode: work.code, activity },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(
        'Este serviço já existe para esta obra e mês.',
      );
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.productionControlLine.create({
        data: {
          competence,
          engineer,
          workName,
          activity,
          unit,
          municipality: work.municipality || optionalText(body.municipality),
          workCode: work.code,
          unitPrice: unitPrice === null ? null : new Prisma.Decimal(unitPrice),
          createdByUserId: actorId,
          updatedByUserId: actorId,
        },
      });
      await tx.productionControlRevision.create({
        data: {
          lineId: line.id,
          action: 'CREATE_LINE',
          after: {
            competence,
            engineer,
            workName,
            workCode: work.code,
            municipality: work.municipality || optionalText(body.municipality),
            activity,
            unit,
            unitPrice,
          },
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
    if ('workName' in body) {
      throw new BadRequestException(
        'O nome da obra deve vir do cadastro Aethos pelo código.',
      );
    }
    for (const key of ['engineer'] as const) {
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
    if ('workCode' in body) {
      const work = await this.findWork(
        requiredText(body.workCode, 'Código da obra', 12),
      );
      if (work.code !== current.workCode) {
        data.workCode = work.code;
        before.workCode = current.workCode;
        after.workCode = work.code;
      }
      if (work.name !== current.workName) {
        data.workName = work.name;
        before.workName = current.workName;
        after.workName = work.name;
      }
      const city = work.municipality || current.municipality;
      if (city !== current.municipality) {
        data.municipality = city;
        before.municipality = current.municipality;
        after.municipality = city;
      }
    }
    for (const key of ['municipality'] as const) {
      if (!(key in body)) continue;
      const next = optionalText(body[key], 160);
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
