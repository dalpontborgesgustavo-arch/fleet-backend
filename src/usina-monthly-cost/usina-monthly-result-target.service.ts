import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  competenceKey,
  nullableText,
  parseCompetence,
  USINA_MONTHLY_COST_CONTEXT,
  canAccessUsinaMonthlyCost,
} from './usina-monthly-cost.rules';
import {
  monthlyResultTargetSnapshot,
  normalizeMonthlyResultTargetInput,
} from './usina-monthly-result-target.rules';

@Injectable()
export class UsinaMonthlyResultTargetService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaMonthlyCost(role)) {
      throw new ForbiddenException(
        'Somente Licitacao e Administrador podem acessar o percentual previsto da Usina',
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
      competence: competenceKey(record.competence),
      targetRate: record.targetRate === null ? null : record.targetRate.toFixed(6),
      targetPercent:
        record.targetRate === null ? null : record.targetRate.mul(100).toFixed(2),
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
    await tx.usinaMonthlyResultTargetAudit.create({
      data: {
        resultTargetId: record.id,
        action,
        note: note || null,
        actorId,
        snapshot: monthlyResultTargetSnapshot(record) as Prisma.InputJsonValue,
      },
    });
  }

  async findAnnual(yearValue: unknown, role?: string | null) {
    this.ensureAccess(role);
    const year = Number(yearValue ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2025 || year > 2100) {
      throw new BadRequestException('Ano deve estar entre 2025 e 2100');
    }
    const records = await this.prisma.usinaMonthlyResultTarget.findMany({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
        deletedAt: null,
      },
      orderBy: [{ competence: 'asc' }, { version: 'desc' }],
    });
    const names = await this.actorNamesFor(records);
    return {
      year,
      context: USINA_MONTHLY_COST_CONTEXT,
      targets: records.map((record) => this.serialize(record, names)),
    };
  }

  async saveDraft(body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeMonthlyResultTargetInput(body);
    const key = `${USINA_MONTHLY_COST_CONTEXT.companyId}|${USINA_MONTHLY_COST_CONTEXT.unitId}|result-target|${competenceKey(input.competence)}`;
    const id = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const versions = await tx.usinaMonthlyResultTarget.findMany({
          where: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            competence: input.competence,
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
            'Motivo da alteracao e obrigatorio para modificar uma competencia confirmada',
          );
        }
        const record = await tx.usinaMonthlyResultTarget.create({
          data: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            competence: input.competence,
            targetRate: input.targetRate,
            observation: input.observation,
            status: 'DRAFT',
            version: latest ? latest.version + 1 : 1,
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
    const record = await tx.usinaMonthlyResultTarget.update({
      where: { id: draft.id },
      data: {
        targetRate: input.targetRate,
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
    const input = normalizeMonthlyResultTargetInput(body);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "UsinaMonthlyResultTarget" WHERE "id" = ${id} FOR UPDATE`,
      );
      const draft = await tx.usinaMonthlyResultTarget.findFirst({
        where: { id, deletedAt: null },
      });
      if (!draft) throw new NotFoundException('Percentual previsto nao encontrado');
      if (competenceKey(draft.competence) !== competenceKey(input.competence)) {
        throw new BadRequestException('A competencia do rascunho nao pode ser alterada');
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
    const base = await this.prisma.usinaMonthlyResultTarget.findFirst({
      where: { id: baseId, status: 'CONFIRMED', deletedAt: null },
      select: { competence: true },
    });
    if (!base) throw new NotFoundException('Percentual confirmado nao encontrado');
    return this.saveDraft(
      { ...body, competence: competenceKey(base.competence) },
      actorValue,
      role,
    );
  }

  async copyPrevious(body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const competence = parseCompetence(body?.competence);
    const previous = new Date(
      Date.UTC(competence.getUTCFullYear(), competence.getUTCMonth() - 1, 1),
    );
    const source = await this.prisma.usinaMonthlyResultTarget.findFirst({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        competence: previous,
        status: 'CONFIRMED',
        isCurrent: true,
        deletedAt: null,
      },
    });
    if (!source) {
      throw new NotFoundException(
        'Mes anterior nao possui percentual previsto confirmado vigente',
      );
    }
    return this.saveDraft(
      {
        competence: competenceKey(competence),
        targetRate: source.targetRate === null ? null : source.targetRate.toFixed(6),
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
          Prisma.sql`SELECT "id" FROM "UsinaMonthlyResultTarget" WHERE "id" = ${id} FOR UPDATE`,
        );
        const draft = await tx.usinaMonthlyResultTarget.findFirst({
          where: { id, status: 'DRAFT', deletedAt: null },
        });
        if (!draft) throw new NotFoundException('Rascunho nao encontrado');
        await tx.usinaMonthlyResultTarget.updateMany({
          where: {
            companyId: draft.companyId,
            unitId: draft.unitId,
            competence: draft.competence,
            isCurrent: true,
            deletedAt: null,
          },
          data: { isCurrent: false, updatedById: actorId },
        });
        const record = await tx.usinaMonthlyResultTarget.update({
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
    const target = await this.prisma.usinaMonthlyResultTarget.findFirst({ where: { id } });
    if (!target) throw new NotFoundException('Percentual previsto nao encontrado');
    const records = await this.prisma.usinaMonthlyResultTarget.findMany({
      where: {
        companyId: target.companyId,
        unitId: target.unitId,
        competence: target.competence,
      },
      include: { audit: { orderBy: { createdAt: 'desc' } } },
      orderBy: { version: 'desc' },
    });
    const names = await this.actorNamesFor(records);
    return {
      competence: competenceKey(target.competence),
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
        Prisma.sql`SELECT "id" FROM "UsinaMonthlyResultTarget" WHERE "id" = ${id} FOR UPDATE`,
      );
      const record = await tx.usinaMonthlyResultTarget.findFirst({
        where: { id, deletedAt: null },
      });
      if (!record) throw new NotFoundException('Percentual previsto nao encontrado');
      await this.audit(tx, record, 'SOFT_DELETED', actorId, reason);
      await tx.usinaMonthlyResultTarget.update({
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
