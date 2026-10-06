import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canAccessUsinaMonthlyCost,
  competenceKey,
  monthlyCostSnapshot,
  normalizeMonthlyCostInput,
  nullableText,
  parseCompetence,
  USINA_MONTHLY_COST_CONTEXT,
} from './usina-monthly-cost.rules';

const visibleEquipment = {
  where: { deletedAt: null },
  orderBy: { sortOrder: 'asc' as const },
};

@Injectable()
export class UsinaMonthlyCostService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaMonthlyCost(role)) {
      throw new ForbiddenException(
        'Somente Licitacao e Administrador podem acessar a configuracao mensal de custos da Usina',
      );
    }
  }

  private ensureActor(actorId?: string | null) {
    if (!actorId) throw new BadRequestException('Usuario autenticado nao encontrado');
    return actorId;
  }

  private async actorNamesFor(configs: any[]) {
    const ids = new Set<string>();
    for (const config of configs) {
      for (const value of [
        config.createdById,
        config.updatedById,
        config.confirmedById,
        config.deletedById,
      ]) {
        if (value) ids.add(value);
      }
      for (const audit of config.audit || []) if (audit.actorId) ids.add(audit.actorId);
    }
    if (!ids.size) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private serialize(config: any, names = new Map<string, string>()) {
    const equipment = (config.equipment || []).map((item: any) => ({ ...item }));
    return {
      ...config,
      competence: competenceKey(config.competence),
      taxRate: config.taxRate.toString(),
      taxPercent: config.taxRate.mul(100).toString(),
      createdByName: config.createdById ? names.get(config.createdById) || null : null,
      updatedByName: config.updatedById ? names.get(config.updatedById) || null : null,
      confirmedByName: config.confirmedById
        ? names.get(config.confirmedById) || null
        : null,
      equipment,
      loaders: equipment.filter((item: any) => item.equipmentType === 'CARREGADEIRA'),
      supportVehicle:
        equipment.find((item: any) => item.equipmentType === 'VEICULO_USINA') || null,
      audit: (config.audit || []).map((item: any) => ({
        ...item,
        actorName: item.actorId ? names.get(item.actorId) || null : 'Sistema',
      })),
    };
  }

  async findAnnual(yearValue: unknown, role?: string | null) {
    this.ensureAccess(role);
    const year = Number(yearValue ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2025 || year > 2100) {
      throw new BadRequestException('Ano deve estar entre 2025 e 2100');
    }
    const configs = await this.prisma.usinaMonthlyCostConfig.findMany({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
        deletedAt: null,
      },
      include: { equipment: visibleEquipment },
      orderBy: [{ competence: 'asc' }, { version: 'desc' }],
    });
    const names = await this.actorNamesFor(configs);
    return {
      year,
      context: USINA_MONTHLY_COST_CONTEXT,
      configs: configs.map((config) => this.serialize(config, names)),
    };
  }

  async searchActiveAethosVehicles(search: unknown, role?: string | null) {
    this.ensureAccess(role);
    const term = String(search || '').trim();
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        active: true,
        aethosManaged: true,
        aethosVehicleId: { not: null },
        ...(term
          ? {
              OR: [
                { fleet: { contains: term, mode: 'insensitive' as const } },
                { plate: { contains: term, mode: 'insensitive' as const } },
                { name: { contains: term, mode: 'insensitive' as const } },
                { aethosVehicleId: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fleet: true,
        plate: true,
        name: true,
        model: true,
        aethosVehicleId: true,
      },
      orderBy: [{ fleet: 'asc' }, { plate: 'asc' }],
      take: 100,
    });
    return vehicles
      .filter((vehicle) => /^\d+$/.test(vehicle.aethosVehicleId || ''))
      .map((vehicle) => ({
        ...vehicle,
        aethosVehicleId: Number(vehicle.aethosVehicleId),
      }));
  }

  private async ensureActiveVehicles(tx: any, equipment: any[]) {
    const ids = equipment.map((item) => String(item.aethosVehicleId));
    const vehicles = await tx.vehicle.findMany({
      where: {
        active: true,
        aethosManaged: true,
        aethosVehicleId: { in: ids },
      },
      select: { fleet: true, aethosVehicleId: true },
    });
    const available = new Set(
      vehicles.map(
        (vehicle: any) =>
          `${String(vehicle.aethosVehicleId)}|${String(vehicle.fleet || '').trim().toUpperCase()}`,
      ),
    );
    const invalid = equipment.filter(
      (item) =>
        !available.has(
          `${item.aethosVehicleId}|${item.fleetNumber.trim().toUpperCase()}`,
        ),
    );
    if (invalid.length) {
      throw new BadRequestException(
        `Selecione somente veiculos ativos sincronizados do Aethos. Invalidos: ${invalid
          .map((item) => `${item.fleetNumber}/${item.aethosVehicleId}`)
          .join(', ')}`,
      );
    }
  }

  private async createEquipment(tx: any, configId: string, equipment: any[], actorId: string) {
    await tx.usinaMonthlyCostEquipment.createMany({
      data: equipment.map((item) => ({
        configId,
        ...item,
        createdById: actorId,
        updatedById: actorId,
      })),
    });
  }

  private async audit(tx: any, config: any, equipment: any[], action: string, actorId: string, note?: string | null) {
    await tx.usinaMonthlyCostAudit.create({
      data: {
        configId: config.id,
        action,
        note: note || null,
        actorId,
        snapshot: monthlyCostSnapshot({ ...config, equipment }) as Prisma.InputJsonValue,
      },
    });
  }

  async saveDraft(body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeMonthlyCostInput(body);
    const key = `${USINA_MONTHLY_COST_CONTEXT.companyId}|${USINA_MONTHLY_COST_CONTEXT.unitId}|${competenceKey(input.competence)}`;
    const id = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        await this.ensureActiveVehicles(tx, input.equipment);
        const versions = await tx.usinaMonthlyCostConfig.findMany({
          where: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            competence: input.competence,
            deletedAt: null,
          },
          orderBy: { version: 'desc' },
        });
        const draft = versions.find((item) => item.status === 'DRAFT');
        if (draft) {
          return this.updateDraftInTransaction(tx, draft, input, actorId);
        }
        const latest = versions[0];
        if (latest && !input.changeReason) {
          throw new BadRequestException(
            'Motivo da alteracao e obrigatorio para modificar uma competencia confirmada',
          );
        }
        const version = latest ? latest.version + 1 : 1;
        const config = await tx.usinaMonthlyCostConfig.create({
          data: {
            companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
            unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
            competence: input.competence,
            version,
            status: 'DRAFT',
            isCurrent: false,
            taxRate: input.taxRate,
            observation: input.observation,
            changeReason: input.changeReason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.createEquipment(tx, config.id, input.equipment, actorId);
        await this.audit(tx, config, input.equipment, 'DRAFT_CREATED', actorId);
        return config.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.history(id, role);
  }

  private async updateDraftInTransaction(tx: any, draft: any, input: any, actorId: string) {
    if (draft.status !== 'DRAFT') {
      throw new BadRequestException('Somente rascunhos podem ser editados');
    }
    const deletedAt = new Date();
    await tx.usinaMonthlyCostEquipment.updateMany({
      where: { configId: draft.id, deletedAt: null },
      data: { deletedAt, deletedById: actorId, updatedById: actorId },
    });
    const changeReason = draft.version > 1 ? input.changeReason || draft.changeReason : null;
    if (draft.version > 1 && !changeReason) {
      throw new BadRequestException('Motivo da alteracao e obrigatorio');
    }
    const config = await tx.usinaMonthlyCostConfig.update({
      where: { id: draft.id },
      data: {
        taxRate: input.taxRate,
        observation: input.observation,
        changeReason,
        updatedById: actorId,
      },
    });
    await this.createEquipment(tx, config.id, input.equipment, actorId);
    await this.audit(tx, config, input.equipment, 'DRAFT_UPDATED', actorId);
    return config.id;
  }

  async updateDraft(id: string, body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeMonthlyCostInput(body);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "UsinaMonthlyCostConfig" WHERE "id" = ${id} FOR UPDATE`);
      const draft = await tx.usinaMonthlyCostConfig.findFirst({ where: { id, deletedAt: null } });
      if (!draft) throw new NotFoundException('Configuracao nao encontrada');
      if (competenceKey(draft.competence) !== competenceKey(input.competence)) {
        throw new BadRequestException('A competencia do rascunho nao pode ser alterada');
      }
      await this.ensureActiveVehicles(tx, input.equipment);
      await this.updateDraftInTransaction(tx, draft, input, actorId);
    });
    return this.history(id, role);
  }

  async createVersion(baseId: string, body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const base = await this.prisma.usinaMonthlyCostConfig.findFirst({
      where: { id: baseId, status: 'CONFIRMED', deletedAt: null },
      select: { competence: true },
    });
    if (!base) throw new NotFoundException('Configuracao confirmada nao encontrada');
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
    const previous = new Date(Date.UTC(competence.getUTCFullYear(), competence.getUTCMonth() - 1, 1));
    const source = await this.prisma.usinaMonthlyCostConfig.findFirst({
      where: {
        companyId: USINA_MONTHLY_COST_CONTEXT.companyId,
        unitId: USINA_MONTHLY_COST_CONTEXT.unitId,
        competence: previous,
        status: 'CONFIRMED',
        isCurrent: true,
        deletedAt: null,
      },
      include: { equipment: visibleEquipment },
    });
    if (!source) throw new NotFoundException('Mes anterior nao possui configuracao confirmada vigente');
    const loaders = source.equipment.filter((item) => item.equipmentType === 'CARREGADEIRA');
    const supportVehicle = source.equipment.find((item) => item.equipmentType === 'VEICULO_USINA');
    return this.saveDraft(
      {
        competence: competenceKey(competence),
        loaders,
        supportVehicle,
        taxRate: source.taxRate.toString(),
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
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "UsinaMonthlyCostConfig" WHERE "id" = ${id} FOR UPDATE`);
        const draft = await tx.usinaMonthlyCostConfig.findFirst({
          where: { id, status: 'DRAFT', deletedAt: null },
          include: { equipment: visibleEquipment },
        });
        if (!draft) throw new NotFoundException('Rascunho nao encontrado');
        await this.ensureActiveVehicles(tx, draft.equipment);
        await tx.usinaMonthlyCostConfig.updateMany({
          where: {
            companyId: draft.companyId,
            unitId: draft.unitId,
            competence: draft.competence,
            isCurrent: true,
            deletedAt: null,
          },
          data: { isCurrent: false, updatedById: actorId },
        });
        const confirmedAt = new Date();
        const config = await tx.usinaMonthlyCostConfig.update({
          where: { id },
          data: {
            status: 'CONFIRMED',
            isCurrent: true,
            confirmedAt,
            confirmedById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, config, draft.equipment, 'CONFIRMED', actorId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.history(id, role);
  }

  async history(id: string, role?: string | null) {
    this.ensureAccess(role);
    const target = await this.prisma.usinaMonthlyCostConfig.findFirst({ where: { id } });
    if (!target) throw new NotFoundException('Configuracao nao encontrada');
    const configs = await this.prisma.usinaMonthlyCostConfig.findMany({
      where: {
        companyId: target.companyId,
        unitId: target.unitId,
        competence: target.competence,
      },
      include: {
        equipment: { orderBy: { sortOrder: 'asc' } },
        audit: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { version: 'desc' },
    });
    const names = await this.actorNamesFor(configs);
    return {
      competence: competenceKey(target.competence),
      versions: configs.map((config) => this.serialize(config, names)),
    };
  }

  async softDelete(id: string, body: any, actorValue?: string | null, role?: string | null) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const reason = nullableText(body?.reason, 500);
    if (!reason) throw new BadRequestException('Motivo da exclusao e obrigatorio');
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "UsinaMonthlyCostConfig" WHERE "id" = ${id} FOR UPDATE`);
      const config = await tx.usinaMonthlyCostConfig.findFirst({
        where: { id, deletedAt: null },
        include: { equipment: visibleEquipment },
      });
      if (!config) throw new NotFoundException('Configuracao nao encontrada');
      await this.audit(tx, config, config.equipment, 'SOFT_DELETED', actorId, reason);
      await tx.usinaMonthlyCostConfig.update({
        where: { id },
        data: { isCurrent: false, deletedAt, deletedById: actorId, updatedById: actorId },
      });
    });
    return { ok: true, id, deletedAt: deletedAt.toISOString() };
  }
}
