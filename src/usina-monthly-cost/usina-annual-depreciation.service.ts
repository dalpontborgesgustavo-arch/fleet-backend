import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  annualDepreciationSnapshot,
  normalizeAnnualDepreciationInput,
  parseExercise,
} from './usina-annual-depreciation.rules';
import {
  canAccessUsinaMonthlyCost,
  nullableText,
  USINA_MONTHLY_COST_CONTEXT,
} from './usina-monthly-cost.rules';

@Injectable()
export class UsinaAnnualDepreciationService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaMonthlyCost(role)) {
      throw new ForbiddenException(
        'Somente Licitacao e Administrador podem acessar a depreciacao anual da Usina',
      );
    }
  }

  private ensureActor(actorId?: string | null) {
    if (!actorId) throw new BadRequestException('Usuario autenticado nao encontrado');
    return actorId;
  }

  private async actorNamesFor(records: any[]) {
    const ids = new Set<string>();
    for (const record of records) {
      for (const value of [
        record.createdById,
        record.updatedById,
        record.confirmedById,
        record.deletedById,
      ]) {
        if (value) ids.add(value);
      }
      for (const audit of record.audit || []) if (audit.actorId) ids.add(audit.actorId);
    }
    if (!ids.size) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private serialize(record: any, names = new Map<string, string>()) {
    return {
      ...record,
      annualValue: record.annualValue.toFixed(2),
      monthlyValue: record.monthlyValue.toFixed(2),
      createdByName: record.createdById ? names.get(record.createdById) || null : null,
      updatedByName: record.updatedById ? names.get(record.updatedById) || null : null,
      confirmedByName: record.confirmedById
        ? names.get(record.confirmedById) || null
        : null,
      audit: (record.audit || []).map((item: any) => ({
        ...item,
        actorName: item.actorId ? names.get(item.actorId) || null : 'Sistema',
      })),
    };
  }

  private async audit(
    tx: any,
    record: any,
    action: string,
    actorId: string,
    note?: string | null,
  ) {
    await tx.usinaAnnualDepreciationAudit.create({
      data: {
        depreciationId: record.id,
        action,
        note: note || null,
        actorId,
        snapshot: annualDepreciationSnapshot(record) as Prisma.InputJsonValue,
      },
    });
  }

  async findAnnual(yearValue: unknown, role?: string | null) {
    this.ensureAccess(role);
    const year = parseExercise(yearValue ?? new Date().getFullYear());
    const records = await this.prisma.usinaAnnualDepreciation.findMany({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        exercise: year,
        deletedAt: null,
      },
      orderBy: { version: 'desc' },
    });
    const names = await this.actorNamesFor(records);
    return {
      year,
      context: USINA_MONTHLY_COST_CONTEXT,
      depreciations: records.map((record) => this.serialize(record, names)),
    };
  }

  async saveDraft(body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeAnnualDepreciationInput(body);
    const key = `${USINA_MONTHLY_COST_CONTEXT.companyId}|${USINA_MONTHLY_COST_CONTEXT.unitId}|depreciation|${input.exercise}`;
    const id = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const versions = await tx.usinaAnnualDepreciation.findMany({
          where: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            exercise: input.exercise,
            deletedAt: null,
          },
          orderBy: { version: 'desc' },
        });
        const draft = versions.find((item: any) => item.status === 'DRAFT');
        if (draft) {
          return this.updateDraftInTransaction(tx, draft, input, actorId);
        }
        const latest = versions[0];
        if (latest && !input.changeReason) {
          throw new BadRequestException(
            'Motivo da alteracao e obrigatorio para modificar um exercicio confirmado',
          );
        }
        const record = await tx.usinaAnnualDepreciation.create({
          data: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            exercise: input.exercise,
            version: latest ? latest.version + 1 : 1,
            annualValue: input.annualValue,
            monthlyValue: input.monthlyValue,
            observation: input.observation,
            status: 'DRAFT',
            isCurrent: false,
            changeReason: input.changeReason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, record, 'DRAFT_CREATED', actorId);
        return record.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.history(id, role);
  }

  private async updateDraftInTransaction(tx: any, draft: any, input: any, actorId: string) {
    if (draft.status !== 'DRAFT') {
      throw new BadRequestException('Somente rascunhos podem ser editados');
    }
    const changeReason = draft.version > 1
      ? input.changeReason || draft.changeReason
      : null;
    if (draft.version > 1 && !changeReason) {
      throw new BadRequestException('Motivo da alteracao e obrigatorio');
    }
    const record = await tx.usinaAnnualDepreciation.update({
      where: { id: draft.id },
      data: {
        annualValue: input.annualValue,
        monthlyValue: input.monthlyValue,
        observation: input.observation,
        changeReason,
        updatedById: actorId,
      },
    });
    await this.audit(tx, record, 'DRAFT_UPDATED', actorId);
    return record.id;
  }

  async updateDraft(id: string, body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeAnnualDepreciationInput(body);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "UsinaAnnualDepreciation" WHERE "id" = ${id} FOR UPDATE`,
      );
      const draft = await tx.usinaAnnualDepreciation.findFirst({
        where: { id, deletedAt: null },
      });
      if (!draft) throw new NotFoundException('Depreciacao nao encontrada');
      if (draft.exercise !== input.exercise) {
        throw new BadRequestException('O exercicio do rascunho nao pode ser alterado');
      }
      await this.updateDraftInTransaction(tx, draft, input, actorId);
    });
    return this.history(id, role);
  }

  async createVersion(
    baseId: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const base = await this.prisma.usinaAnnualDepreciation.findFirst({
      where: { id: baseId, status: 'CONFIRMED', deletedAt: null },
      select: { exercise: true },
    });
    if (!base) throw new NotFoundException('Depreciacao confirmada nao encontrada');
    return this.saveDraft({ ...body, exercise: base.exercise }, actorValue, role);
  }

  async copyPrevious(body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const exercise = parseExercise(body?.exercise);
    const source = await this.prisma.usinaAnnualDepreciation.findFirst({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        exercise: exercise - 1,
        status: 'CONFIRMED',
        isCurrent: true,
        deletedAt: null,
      },
    });
    if (!source) {
      throw new NotFoundException('Exercicio anterior nao possui depreciacao confirmada vigente');
    }
    return this.saveDraft(
      {
        exercise,
        annualValue: source.annualValue.toFixed(2),
        observation: source.observation,
        changeReason: nullableText(body?.changeReason, 500),
      },
      actorId,
      role,
    );
  }

  async confirm(id: string, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "UsinaAnnualDepreciation" WHERE "id" = ${id} FOR UPDATE`,
        );
        const draft = await tx.usinaAnnualDepreciation.findFirst({
          where: { id, status: 'DRAFT', deletedAt: null },
        });
        if (!draft) throw new NotFoundException('Rascunho nao encontrado');
        await tx.usinaAnnualDepreciation.updateMany({
          where: {
            companyId: draft.companyId,
            unitId: draft.unitId,
            exercise: draft.exercise,
            isCurrent: true,
            deletedAt: null,
          },
          data: { isCurrent: false, updatedById: actorId },
        });
        const record = await tx.usinaAnnualDepreciation.update({
          where: { id },
          data: {
            status: 'CONFIRMED',
            isCurrent: true,
            confirmedAt: new Date(),
            confirmedById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, record, 'CONFIRMED', actorId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.history(id, role);
  }

  async history(id: string, role?: string | null) {
    this.ensureAccess(role);
    const target = await this.prisma.usinaAnnualDepreciation.findFirst({ where: { id } });
    if (!target) throw new NotFoundException('Depreciacao nao encontrada');
    const records = await this.prisma.usinaAnnualDepreciation.findMany({
      where: {
        companyId: target.companyId,
        unitId: target.unitId,
        exercise: target.exercise,
      },
      include: { audit: { orderBy: { createdAt: 'desc' } } },
      orderBy: { version: 'desc' },
    });
    const names = await this.actorNamesFor(records);
    return {
      exercise: target.exercise,
      versions: records.map((record) => this.serialize(record, names)),
    };
  }

  async softDelete(id: string, body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const reason = nullableText(body?.reason, 500);
    if (!reason) throw new BadRequestException('Motivo da exclusao e obrigatorio');
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "UsinaAnnualDepreciation" WHERE "id" = ${id} FOR UPDATE`,
      );
      const record = await tx.usinaAnnualDepreciation.findFirst({
        where: { id, deletedAt: null },
      });
      if (!record) throw new NotFoundException('Depreciacao nao encontrada');
      await this.audit(tx, record, 'SOFT_DELETED', actorId, reason);
      await tx.usinaAnnualDepreciation.update({
        where: { id },
        data: {
          isCurrent: false,
          deletedAt,
          deletedById: actorId,
          updatedById: actorId,
        },
      });
    });
    return { ok: true, id, deletedAt: deletedAt.toISOString() };
  }
}
