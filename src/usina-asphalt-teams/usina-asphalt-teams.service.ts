import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canAccessUsinaAsphaltTeams,
  dateKey,
  normalizeAssignmentInput,
  normalizeTeamInput,
  optionalText,
  parseDate,
  reconcileUsinaAsphaltTeams,
  USINA_ASPHALT_TEAM_CONTEXT,
} from './usina-asphalt-teams.rules';
import {
  monthEnd,
  normalizeCompetence,
  normalizeFleetCategory,
  normalizeFleetAssignmentInput,
  reconcileUsinaAsphaltFleetFreights,
  USINA_ASPHALT_FLEET_FREIGHT_DATASET,
} from './usina-asphalt-team-fleet.rules';
import {
  normalizeSharedCostClass,
  reconcileUsinaAsphaltTeamSharedCosts,
  USINA_ASPHALT_TEAM_SHARED_COSTS,
} from './usina-asphalt-team-shared-cost.rules';
import {
  normalizeDerivedCostMetric,
  reconcileUsinaAsphaltTeamDerivedCosts,
} from './usina-asphalt-team-derived-cost.rules';
import {
  ASPHALT_EQUIPMENT_RATE_CATEGORIES,
  AsphaltEquipmentRateCategory,
} from './dto/usina-asphalt-equipment-hourly-rate.dto';
import {
  normalizeEquipmentHourlyRateInput,
  normalizeEquipmentRateCategory,
} from './usina-asphalt-equipment-hourly-rate.rules';
import {
  normalizeEquipmentCostMetric,
  reconcileUsinaAsphaltEquipmentCosts,
} from './usina-asphalt-equipment-cost.rules';

function previousDay(value: Date) {
  return new Date(value.getTime() - 86400000);
}

type FleetSearchRecord = {
  fleet: string | null;
  plate?: string | null;
};

const fleetSearchCollator = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
});

function normalizeFleetSearchValue(value: unknown) {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return /^\d+$/.test(normalized)
    ? normalized.replace(/^0+(?=\d)/, '')
    : normalized;
}

export function prioritizeVehiclesByFleet<T extends FleetSearchRecord>(
  vehicles: T[],
  search: unknown,
) {
  const term = normalizeFleetSearchValue(search);
  if (!term) return vehicles;

  const priority = (vehicle: T) => {
    const fleet = normalizeFleetSearchValue(vehicle.fleet);
    if (fleet === term) return 0;
    if (fleet.startsWith(term)) return 1;
    if (fleet.includes(term)) return 2;
    return 3;
  };

  return [...vehicles].sort((left, right) => {
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference) return priorityDifference;
    const fleetDifference = fleetSearchCollator.compare(
      left.fleet || '',
      right.fleet || '',
    );
    if (fleetDifference) return fleetDifference;
    return fleetSearchCollator.compare(left.plate || '', right.plate || '');
  });
}

@Injectable()
export class UsinaAsphaltTeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaAsphaltTeams(role)) {
      throw new ForbiddenException(
        'Somente Licitacao e Administrador podem acessar as equipes de asfalto',
      );
    }
  }

  private ensureActor(actorId?: string | null) {
    if (!actorId)
      throw new BadRequestException('Usuario autenticado nao encontrado');
    return actorId;
  }

  private translateDatabaseError(error: any): never {
    const message = String(error?.message || '');
    if (
      error?.code === 'P2002' ||
      error?.code === 'P2004' ||
      message.includes('no_team_overlap') ||
      message.includes('no_code_overlap') ||
      message.includes('no_product_overlap') ||
      message.includes('no_vehicle_overlap') ||
      message.includes('Vigencia do registro')
    ) {
      throw new BadRequestException(
        'Existe sobreposicao de vigencia, codigo de equipe duplicado ou item ja atribuido no periodo informado',
      );
    }
    throw error;
  }

  private async actorNamesFor(records: any[]) {
    const ids = new Set<string>();
    for (const record of records) {
      for (const id of [
        record.createdById,
        record.updatedById,
        record.deletedById,
        ...(record.versions || []).flatMap((item: any) => [
          item.createdById,
          item.updatedById,
          item.deletedById,
        ]),
        ...(record.assignments || []).flatMap((item: any) => [
          item.createdById,
          item.updatedById,
          item.deletedById,
        ]),
        ...(record.fleetAssignments || []).flatMap((item: any) => [
          item.createdById,
          item.updatedById,
          item.deletedById,
        ]),
        ...(record.audit || []).map((item: any) => item.actorId),
      ]) {
        if (id) ids.add(id);
      }
    }
    if (!ids.size) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private serializeTeam(team: any, names = new Map<string, string>()) {
    return {
      ...team,
      validFrom: dateKey(team.validFrom),
      validTo: team.validTo ? dateKey(team.validTo) : null,
      createdByName: team.createdById
        ? names.get(team.createdById) || null
        : 'Sistema',
      updatedByName: team.updatedById
        ? names.get(team.updatedById) || null
        : null,
      versions: (team.versions || []).map((version: any) => ({
        ...version,
        validFrom: dateKey(version.validFrom),
        validTo: version.validTo ? dateKey(version.validTo) : null,
        createdByName: version.createdById
          ? names.get(version.createdById) || null
          : 'Sistema',
      })),
      assignments: (team.assignments || []).map((assignment: any) => ({
        ...assignment,
        validFrom: dateKey(assignment.validFrom),
        validTo: assignment.validTo ? dateKey(assignment.validTo) : null,
        createdByName: assignment.createdById
          ? names.get(assignment.createdById) || null
          : 'Sistema',
      })),
      fleetAssignments: (team.fleetAssignments || []).map(
        (assignment: any) => ({
          ...assignment,
          competence: dateKey(assignment.competence),
          validFrom: dateKey(assignment.validFrom),
          validTo: dateKey(assignment.validTo),
          createdByName: assignment.createdById
            ? names.get(assignment.createdById) || null
            : 'Sistema',
        }),
      ),
      audit: (team.audit || []).map((audit: any) => ({
        ...audit,
        actorName: audit.actorId ? names.get(audit.actorId) || null : 'Sistema',
      })),
    };
  }

  private teamInclude(includeDeleted = false) {
    return {
      versions: {
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: [{ validFrom: 'asc' as const }, { version: 'asc' as const }],
      },
      assignments: {
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: [
          { aethosProductId: 'asc' as const },
          { validFrom: 'asc' as const },
        ],
      },
      fleetAssignments: {
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: [
          { competence: 'desc' as const },
          { fleetNumber: 'asc' as const },
        ],
      },
      audit: { orderBy: { createdAt: 'desc' as const }, take: 200 },
    };
  }

  async findAll(role?: string | null, includeDeleted = false) {
    this.ensureAccess(role);
    const teams = await this.prisma.usinaAsphaltTeam.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: this.teamInclude(includeDeleted),
      orderBy: { validFrom: 'asc' },
    });
    const names = await this.actorNamesFor(teams);
    return {
      context: USINA_ASPHALT_TEAM_CONTEXT,
      dynamic: true,
      limit: null,
      teams: teams.map((team) => this.serializeTeam(team, names)),
    };
  }

  async searchActiveAethosItems(search: unknown, role?: string | null) {
    this.ensureAccess(role);
    const term = String(search || '').trim();
    return this.prisma.aethosItem.findMany({
      where: {
        active: true,
        ...(term
          ? {
              OR: [
                { code: { contains: term, mode: 'insensitive' as const } },
                {
                  description: { contains: term, mode: 'insensitive' as const },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        active: true,
      },
      orderBy: [{ description: 'asc' }, { code: 'asc' }],
      take: 100,
    });
  }

  async searchActiveAethosVehicles(search: unknown, role?: string | null) {
    this.ensureAccess(role);
    const term = String(search || '').trim();
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        active: true,
        aethosVehicleId: { not: null },
        ...(term
          ? {
              OR: [
                { fleet: { contains: term, mode: 'insensitive' as const } },
                { plate: { contains: term, mode: 'insensitive' as const } },
                { name: { contains: term, mode: 'insensitive' as const } },
                { model: { contains: term, mode: 'insensitive' as const } },
                {
                  aethosVehicleId: {
                    contains: term,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        aethosVehicleId: true,
        fleet: true,
        plate: true,
        name: true,
        model: true,
        group: true,
        subgroup: true,
        active: true,
      },
      orderBy: [{ fleet: 'asc' }, { plate: 'asc' }],
      take: 100,
    });
    const normalizedVehicles = vehicles
      .map((vehicle) => ({
        ...vehicle,
        aethosVehicleId: Number(vehicle.aethosVehicleId),
      }))
      .filter(
        (vehicle) =>
          Number.isSafeInteger(vehicle.aethosVehicleId) &&
          vehicle.aethosVehicleId > 0,
      );
    return prioritizeVehiclesByFleet(normalizedVehicles, term);
  }

  private async audit(
    tx: any,
    data: {
      teamId?: string | null;
      entityType: string;
      entityId: string;
      action: string;
      note?: string | null;
      before?: unknown;
      after?: unknown;
      actorId: string;
    },
  ) {
    await tx.usinaAsphaltTeamAudit.create({
      data: {
        teamId: data.teamId || null,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        note: data.note || null,
        before: data.before
          ? (data.before as Prisma.InputJsonValue)
          : undefined,
        after: data.after ? (data.after as Prisma.InputJsonValue) : undefined,
        actorId: data.actorId,
      },
    });
  }

  private equipmentRateLabel(category: AsphaltEquipmentRateCategory) {
    return {
      VIBROACABADORA: 'Vibroacabadora',
      ROLO_LISO: 'Rolo liso',
      ROLO_PNEUS: 'Rolo pneus',
    }[category];
  }

  private serializeEquipmentHourlyRate(
    rate: any,
    actorNames = new Map<string, string>(),
  ) {
    return {
      id: rate.id,
      competence: dateKey(rate.competence),
      category: rate.category,
      label: this.equipmentRateLabel(rate.category),
      version: rate.version,
      productiveRate: rate.productiveRate.toFixed(6),
      unproductiveRate: rate.unproductiveRate.toFixed(6),
      isCurrent: rate.isCurrent,
      changeReason: rate.changeReason,
      createdAt: rate.createdAt.toISOString(),
      createdById: rate.createdById,
      createdByName: rate.createdById
        ? actorNames.get(rate.createdById) || null
        : 'Sistema',
      updatedAt: rate.updatedAt.toISOString(),
      updatedById: rate.updatedById,
      updatedByName: rate.updatedById
        ? actorNames.get(rate.updatedById) || null
        : null,
      deletedAt: rate.deletedAt?.toISOString() || null,
      deletedById: rate.deletedById,
      deletedByName: rate.deletedById
        ? actorNames.get(rate.deletedById) || null
        : null,
    };
  }

  private async equipmentRateActorNames(records: any[]) {
    const ids = new Set<string>();
    for (const record of records) {
      for (const id of [
        record.createdById,
        record.updatedById,
        record.deletedById,
        ...(record.audits || []).map((audit: any) => audit.actorId),
      ]) {
        if (id) ids.add(id);
      }
    }
    if (!ids.size) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  async listEquipmentHourlyRates(
    yearValue: unknown,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const year = this.parseYear(yearValue);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const rates = await this.prisma.usinaAsphaltEquipmentHourlyRate.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: { gte: from, lt: to },
        isCurrent: true,
        deletedAt: null,
      },
      orderBy: [{ competence: 'asc' }, { category: 'asc' }],
    });
    const names = await this.equipmentRateActorNames(rates);
    return {
      context: USINA_ASPHALT_TEAM_CONTEXT,
      year,
      source: 'JR_MANUAL',
      sharedByAllTeams: true,
      categories: ASPHALT_EQUIPMENT_RATE_CATEGORIES.map((category) => ({
        category,
        label: this.equipmentRateLabel(category),
      })),
      months: Array.from({ length: 12 }, (_, month) => {
        const competence = new Date(Date.UTC(year, month, 1));
        const competenceKey = dateKey(competence);
        return {
          competence: competenceKey,
          categories: ASPHALT_EQUIPMENT_RATE_CATEGORIES.map((category) => {
            const rate = rates.find(
              (candidate) =>
                dateKey(candidate.competence) === competenceKey &&
                candidate.category === category,
            );
            return rate
              ? this.serializeEquipmentHourlyRate(rate, names)
              : {
                  id: null,
                  competence: competenceKey,
                  category,
                  label: this.equipmentRateLabel(category),
                  version: null,
                  productiveRate: null,
                  unproductiveRate: null,
                  isCurrent: false,
                  changeReason: null,
                  createdAt: null,
                  createdById: null,
                  createdByName: null,
                  updatedAt: null,
                  updatedById: null,
                  updatedByName: null,
                  deletedAt: null,
                  deletedById: null,
                  deletedByName: null,
                };
          }),
        };
      }),
    };
  }

  async equipmentHourlyRateHistory(
    competenceValue: unknown,
    categoryValue: unknown,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const competence = normalizeCompetence(competenceValue);
    const category = normalizeEquipmentRateCategory(categoryValue);
    const rates = await this.prisma.usinaAsphaltEquipmentHourlyRate.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence,
        category,
      },
      include: { audits: { orderBy: { createdAt: 'desc' } } },
      orderBy: { version: 'desc' },
    });
    const names = await this.equipmentRateActorNames(rates);
    return {
      competence: dateKey(competence),
      category,
      label: this.equipmentRateLabel(category),
      versions: rates.map((rate) => ({
        ...this.serializeEquipmentHourlyRate(rate, names),
        audits: rate.audits.map((audit) => ({
          id: audit.id.toString(),
          action: audit.action,
          reason: audit.reason,
          before: audit.beforeData,
          after: audit.afterData,
          actorId: audit.actorId,
          actorName: audit.actorId
            ? names.get(audit.actorId) || null
            : 'Sistema',
          createdAt: audit.createdAt.toISOString(),
        })),
      })),
    };
  }

  async saveEquipmentHourlyRate(
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeEquipmentHourlyRateInput(body);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockKey = [
          USINA_ASPHALT_TEAM_CONTEXT.companyId,
          USINA_ASPHALT_TEAM_CONTEXT.unitId,
          dateKey(input.competence),
          input.category,
        ].join('|');
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_RATE|${lockKey}`}, 0))`,
        );
        const current =
          await tx.usinaAsphaltEquipmentHourlyRate.findFirst({
            where: {
              companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
              unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
              competence: input.competence,
              category: input.category,
              isCurrent: true,
              deletedAt: null,
            },
          });
        if (
          current &&
          current.productiveRate.equals(input.productiveRate) &&
          current.unproductiveRate.equals(input.unproductiveRate)
        ) {
          return { rate: current, idempotent: true };
        }
        const latest =
          await tx.usinaAsphaltEquipmentHourlyRate.findFirst({
            where: {
              companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
              unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
              competence: input.competence,
              category: input.category,
            },
            orderBy: { version: 'desc' },
          });
        if (current) {
          await tx.usinaAsphaltEquipmentHourlyRate.update({
            where: { id: current.id },
            data: { isCurrent: false, updatedById: actorId },
          });
        }
        const created = await tx.usinaAsphaltEquipmentHourlyRate.create({
          data: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            competence: input.competence,
            category: input.category,
            version: (latest?.version || 0) + 1,
            productiveRate: input.productiveRate,
            unproductiveRate: input.unproductiveRate,
            isCurrent: true,
            changeReason: input.reason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        const beforeData = current
          ? {
              id: current.id,
              version: current.version,
              productiveRate: current.productiveRate.toFixed(6),
              unproductiveRate: current.unproductiveRate.toFixed(6),
            }
          : null;
        const afterData = {
          id: created.id,
          version: created.version,
          productiveRate: created.productiveRate.toFixed(6),
          unproductiveRate: created.unproductiveRate.toFixed(6),
        };
        await tx.usinaAsphaltEquipmentHourlyRateAudit.create({
          data: {
            rateId: created.id,
            action: current ? 'VERSION_CREATED' : 'CREATED',
            reason: input.reason,
            beforeData: beforeData as Prisma.InputJsonValue,
            afterData: afterData as Prisma.InputJsonValue,
            actorId,
          },
        });
        return { rate: created, idempotent: false };
      });
      const names = await this.equipmentRateActorNames([result.rate]);
      return {
        ...this.serializeEquipmentHourlyRate(result.rate, names),
        idempotent: result.idempotent,
      };
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async deleteEquipmentHourlyRate(
    competenceValue: unknown,
    categoryValue: unknown,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const competence = normalizeCompetence(competenceValue);
    const category = normalizeEquipmentRateCategory(categoryValue);
    const reason = optionalText(body?.reason, 500);
    if (!reason) {
      throw new BadRequestException('Motivo da exclusao e obrigatorio');
    }
    const deletedAt = new Date();
    const deleted = await this.prisma.$transaction(async (tx) => {
      const lockKey = `${dateKey(competence)}|${category}`;
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_RATE|${lockKey}`}, 0))`,
      );
      const current = await tx.usinaAsphaltEquipmentHourlyRate.findFirst({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          competence,
          category,
          isCurrent: true,
          deletedAt: null,
        },
      });
      if (!current) throw new NotFoundException('Tarifa vigente nao encontrada');
      const updated = await tx.usinaAsphaltEquipmentHourlyRate.update({
        where: { id: current.id },
        data: {
          isCurrent: false,
          deletedAt,
          deletedById: actorId,
          updatedById: actorId,
        },
      });
      await tx.usinaAsphaltEquipmentHourlyRateAudit.create({
        data: {
          rateId: current.id,
          action: 'SOFT_DELETED',
          reason,
          beforeData: {
            version: current.version,
            productiveRate: current.productiveRate.toFixed(6),
            unproductiveRate: current.unproductiveRate.toFixed(6),
          },
          afterData: {
            isCurrent: false,
            deletedAt: deletedAt.toISOString(),
          },
          actorId,
        },
      });
      return updated;
    });
    return {
      ok: true,
      id: deleted.id,
      competence: dateKey(competence),
      category,
      deletedAt: deletedAt.toISOString(),
    };
  }

  async createTeam(
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeTeamInput(body);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${USINA_ASPHALT_TEAM_CONTEXT.companyId}|${USINA_ASPHALT_TEAM_CONTEXT.unitId}|TEAM|${input.businessCode}`}, 0))`,
        );
        const team = await tx.usinaAsphaltTeam.create({
          data: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            validFrom: input.validFrom,
            validTo: input.validTo,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        const version = await tx.usinaAsphaltTeamVersion.create({
          data: {
            teamId: team.id,
            companyId: team.companyId,
            unitId: team.unitId,
            version: 1,
            businessCode: input.businessCode,
            displayName: input.displayName,
            responsibleName: input.responsibleName,
            validFrom: input.validFrom,
            validTo: input.validTo,
            changeReason: input.changeReason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId: team.id,
          entityType: 'TEAM',
          entityId: team.id,
          action: 'CREATED',
          note: input.changeReason,
          after: {
            technicalId: team.id,
            version: 1,
            businessCode: input.businessCode,
            displayName: input.displayName,
            responsibleName: input.responsibleName,
            validFrom: dateKey(input.validFrom),
            validTo: input.validTo ? dateKey(input.validTo) : null,
            versionId: version.id,
          },
          actorId,
        });
        return team.id;
      });
      return this.findOne(id, role);
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async findOne(id: string, role?: string | null) {
    this.ensureAccess(role);
    const team = await this.prisma.usinaAsphaltTeam.findFirst({
      where: {
        id,
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
      },
      include: this.teamInclude(true),
    });
    if (!team) throw new NotFoundException('Equipe nao encontrada');
    const names = await this.actorNamesFor([team]);
    return this.serializeTeam(team, names);
  }

  async createVersion(
    teamId: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeTeamInput(body);
    if (!input.changeReason) {
      throw new BadRequestException('Motivo da alteracao e obrigatorio');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_TEAM|${teamId}`}, 0))`,
        );
        const team = await tx.usinaAsphaltTeam.findFirst({
          where: { id: teamId, deletedAt: null },
          include: {
            versions: {
              where: { deletedAt: null },
              orderBy: [{ validFrom: 'desc' }, { version: 'desc' }],
            },
          },
        });
        if (!team) throw new NotFoundException('Equipe nao encontrada');
        if (
          input.validFrom < team.validFrom ||
          (team.validTo && input.validFrom > team.validTo) ||
          (input.validTo && team.validTo && input.validTo > team.validTo)
        ) {
          throw new BadRequestException(
            'Vigencia da versao deve estar contida na equipe',
          );
        }
        const previous = team.versions[0];
        if (previous && input.validFrom <= previous.validFrom) {
          throw new BadRequestException(
            'A nova versao deve iniciar depois da versao anterior',
          );
        }
        if (
          previous &&
          (!previous.validTo || previous.validTo >= input.validFrom)
        ) {
          await tx.usinaAsphaltTeamVersion.update({
            where: { id: previous.id },
            data: {
              validTo: previousDay(input.validFrom),
              updatedById: actorId,
            },
          });
        }
        const nextVersion = (previous?.version || 0) + 1;
        const created = await tx.usinaAsphaltTeamVersion.create({
          data: {
            teamId,
            companyId: team.companyId,
            unitId: team.unitId,
            version: nextVersion,
            businessCode: input.businessCode,
            displayName: input.displayName,
            responsibleName: input.responsibleName,
            validFrom: input.validFrom,
            validTo: input.validTo || team.validTo,
            changeReason: input.changeReason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId,
          entityType: 'TEAM_VERSION',
          entityId: created.id,
          action: 'VERSION_CREATED',
          note: input.changeReason,
          before: previous
            ? {
                version: previous.version,
                displayName: previous.displayName,
                responsibleName: previous.responsibleName,
                validTo: previousDay(input.validFrom)
                  .toISOString()
                  .slice(0, 10),
              }
            : null,
          after: {
            version: nextVersion,
            businessCode: input.businessCode,
            displayName: input.displayName,
            responsibleName: input.responsibleName,
            validFrom: dateKey(input.validFrom),
            validTo: input.validTo ? dateKey(input.validTo) : null,
          },
          actorId,
        });
      });
      return this.findOne(teamId, role);
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async addAssignment(
    teamId: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeAssignmentInput(body);
    try {
      const assignmentId = await this.prisma.$transaction(async (tx) => {
        const key = `${USINA_ASPHALT_TEAM_CONTEXT.companyId}|${USINA_ASPHALT_TEAM_CONTEXT.unitId}|ITEM|${input.aethosProductId}`;
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const team = await tx.usinaAsphaltTeam.findFirst({
          where: { id: teamId, deletedAt: null },
        });
        if (!team) throw new NotFoundException('Equipe nao encontrada');
        if (
          input.validFrom < team.validFrom ||
          (team.validTo && (!input.validTo || input.validTo > team.validTo))
        ) {
          throw new BadRequestException(
            'Vigencia do item deve estar contida na equipe',
          );
        }
        const existingItem = await tx.aethosItem.findFirst({
          where: { code: String(input.aethosProductId) },
          select: { code: true, description: true },
        });
        if (!existingItem) {
          throw new BadRequestException(
            'ID_ITEM nao existe no cadastro sincronizado do Aethos',
          );
        }
        const latest = await tx.usinaAsphaltTeamItemAssignment.findFirst({
          where: {
            companyId: team.companyId,
            unitId: team.unitId,
            aethosProductId: input.aethosProductId,
          },
          orderBy: { version: 'desc' },
        });
        const assignment = await tx.usinaAsphaltTeamItemAssignment.create({
          data: {
            teamId,
            companyId: team.companyId,
            unitId: team.unitId,
            aethosProductId: input.aethosProductId,
            version: (latest?.version || 0) + 1,
            validFrom: input.validFrom,
            validTo: input.validTo,
            changeReason: input.changeReason,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId,
          entityType: 'ITEM_ASSIGNMENT',
          entityId: assignment.id,
          action: 'CREATED',
          note: input.changeReason,
          after: {
            aethosProductId: input.aethosProductId,
            productDescription: existingItem.description,
            version: assignment.version,
            validFrom: dateKey(input.validFrom),
            validTo: input.validTo ? dateKey(input.validTo) : null,
          },
          actorId,
        });
        return assignment.id;
      });
      return { id: assignmentId, team: await this.findOne(teamId, role) };
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async closeTeam(
    teamId: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const validTo = parseDate(body?.validTo, 'Data de encerramento');
    const reason = optionalText(body?.changeReason, 500);
    if (!reason)
      throw new BadRequestException('Motivo do encerramento e obrigatorio');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_TEAM|${teamId}`}, 0))`,
      );
      const team = await tx.usinaAsphaltTeam.findFirst({
        where: { id: teamId, deletedAt: null },
      });
      if (!team) throw new NotFoundException('Equipe nao encontrada');
      if (validTo < team.validFrom) {
        throw new BadRequestException(
          'Encerramento nao pode ser anterior ao inicio da equipe',
        );
      }
      await tx.usinaAsphaltTeamVersion.updateMany({
        where: {
          teamId,
          deletedAt: null,
          OR: [{ validTo: null }, { validTo: { gt: validTo } }],
        },
        data: { validTo, updatedById: actorId },
      });
      await tx.usinaAsphaltTeamItemAssignment.updateMany({
        where: {
          teamId,
          deletedAt: null,
          OR: [{ validTo: null }, { validTo: { gt: validTo } }],
        },
        data: { validTo, updatedById: actorId },
      });
      await tx.usinaAsphaltTeam.update({
        where: { id: teamId },
        data: { validTo, updatedById: actorId },
      });
      await this.audit(tx, {
        teamId,
        entityType: 'TEAM',
        entityId: teamId,
        action: 'CLOSED',
        note: reason,
        before: { validTo: team.validTo ? dateKey(team.validTo) : null },
        after: { validTo: dateKey(validTo) },
        actorId,
      });
    });
    return this.findOne(teamId, role);
  }

  async softDeleteAssignment(
    id: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const reason = optionalText(body?.reason, 500);
    if (!reason)
      throw new BadRequestException('Motivo da exclusao e obrigatorio');
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.usinaAsphaltTeamItemAssignment.findFirst({
        where: { id, deletedAt: null },
      });
      if (!assignment) throw new NotFoundException('Atribuicao nao encontrada');
      await tx.usinaAsphaltTeamItemAssignment.update({
        where: { id },
        data: { deletedAt, deletedById: actorId, updatedById: actorId },
      });
      await this.audit(tx, {
        teamId: assignment.teamId,
        entityType: 'ITEM_ASSIGNMENT',
        entityId: id,
        action: 'SOFT_DELETED',
        note: reason,
        before: {
          aethosProductId: assignment.aethosProductId,
          validFrom: dateKey(assignment.validFrom),
          validTo: assignment.validTo ? dateKey(assignment.validTo) : null,
        },
        after: { deletedAt: deletedAt.toISOString() },
        actorId,
      });
    });
    return { ok: true, id, deletedAt: deletedAt.toISOString() };
  }

  private serializeFleetAssignment(assignment: any) {
    return {
      ...assignment,
      competence: dateKey(assignment.competence),
      validFrom: dateKey(assignment.validFrom),
      validTo: dateKey(assignment.validTo),
    };
  }

  async equipmentHoursReadback(
    query: {
      dateFrom?: unknown;
      dateTo?: unknown;
      includeUndated?: boolean;
      includeFacts?: boolean;
    },
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const dateFrom = parseDate(query.dateFrom, 'dateFrom');
    const dateTo = parseDate(query.dateTo, 'dateTo');
    if (dateTo < dateFrom)
      throw new BadRequestException('dateTo anterior a dateFrom');
    if (dateTo.getTime() - dateFrom.getTime() > 5 * 366 * 86400000)
      throw new BadRequestException('Intervalo maximo de cinco anos');

    const [facts, assignments] = await Promise.all([
      this.prisma.usinaAsphaltEquipmentHourFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          active: true,
          OR: [
            { sourceDate: { gte: dateFrom, lte: dateTo } },
            ...(query.includeUndated ? [{ sourceDate: null }] : []),
          ],
        },
        orderBy: [
          { sourceDate: 'asc' },
          { sourceDocumentId: 'asc' },
          { sourceRecordId: 'asc' },
        ],
      }),
      this.prisma.usinaAsphaltTeamFleetAssignment.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
        },
        include: {
          team: {
            include: {
              versions: {
                where: { deletedAt: null },
                orderBy: { validFrom: 'asc' },
              },
            },
          },
        },
      }),
    ]);

    const grouped = new Map<
      string,
      {
        competence: string | null;
        status: string;
        category: string;
        hourType: string;
        teamId: string | null;
        teamCode: string | null;
        teamName: string | null;
        facts: number;
        hours: Prisma.Decimal;
        canceledReasonFacts: number;
      }
    >();
    const serializedFacts: any[] = [];
    const totals = new Map<string, { facts: number; hours: Prisma.Decimal }>();

    for (const fact of facts) {
      let status = fact.classificationStatus;
      let matched: any = null;
      if (fact.quantityHours.isNegative()) {
        status = 'HORAS_NEGATIVAS';
      }
      if (status === 'ELIGIBLE' && fact.sourceDate && fact.aethosVehicleId) {
        const sameVehicleCategory = assignments.filter(
          (assignment) =>
            assignment.aethosVehicleId === fact.aethosVehicleId &&
            assignment.category === fact.category,
        );
        const candidates = sameVehicleCategory.filter(
          (assignment) =>
            assignment.validFrom <= fact.sourceDate! &&
            assignment.validTo >= fact.sourceDate!,
        );
        if (candidates.length === 1) {
          status = 'ALOCADO';
          matched = candidates[0];
        } else if (candidates.length > 1) {
          status = 'SOBREPOSICAO';
        } else if (sameVehicleCategory.length) {
          status = 'FORA_VIGENCIA';
        } else {
          status = 'FROTA_SEM_CADASTRO_MENSAL';
        }
      }

      const version = matched?.team?.versions?.find(
        (item: any) =>
          fact.sourceDate &&
          item.validFrom <= fact.sourceDate &&
          (!item.validTo || item.validTo >= fact.sourceDate),
      );
      const competence = fact.competence ? dateKey(fact.competence) : null;
      const groupKey = [
        competence || 'NULL',
        status,
        fact.category,
        fact.hourType,
        matched?.teamId || 'NULL',
      ].join('|');
      const current = grouped.get(groupKey) || {
        competence,
        status,
        category: fact.category,
        hourType: fact.hourType,
        teamId: matched?.teamId || null,
        teamCode: version?.businessCode || null,
        teamName: version?.displayName || null,
        facts: 0,
        hours: new Prisma.Decimal(0),
        canceledReasonFacts: 0,
      };
      current.facts += 1;
      current.hours = current.hours.plus(fact.quantityHours);
      if (fact.cancelReasonPresent) current.canceledReasonFacts += 1;
      grouped.set(groupKey, current);

      const total = totals.get(status) || {
        facts: 0,
        hours: new Prisma.Decimal(0),
      };
      total.facts += 1;
      total.hours = total.hours.plus(fact.quantityHours);
      totals.set(status, total);

      if (query.includeFacts) {
        serializedFacts.push({
          id: fact.id,
          sourceRecordId: fact.sourceRecordId,
          sourceBranch: fact.sourceBranch,
          sourceDocumentId: fact.sourceDocumentId,
          sourceLineId: fact.sourceLineId,
          documentDate: fact.documentDate ? dateKey(fact.documentDate) : null,
          sourceDate: fact.sourceDate ? dateKey(fact.sourceDate) : null,
          competence,
          aethosVehicleId: fact.aethosVehicleId,
          fleetNumber: fact.fleetNumber,
          plate: fact.plate,
          category: fact.category,
          hourType: fact.hourType,
          classifierKind: fact.classifierKind,
          classifierId: fact.classifierId,
          quantityHours: fact.quantityHours.toFixed(6),
          sourceStatus: fact.sourceStatus,
          cancelReasonPresent: fact.cancelReasonPresent,
          cancelReason: fact.cancelReason,
          sourceClassificationStatus: fact.classificationStatus,
          allocationStatus: status,
          teamId: matched?.teamId || null,
          teamCode: version?.businessCode || null,
          teamName: version?.displayName || null,
          assignmentId: matched?.id || null,
        });
      }
    }

    const groups = [...grouped.values()]
      .map((entry) => ({
        ...entry,
        hours: entry.hours.toFixed(6),
      }))
      .sort((left, right) =>
        [
          left.competence || '',
          left.status,
          left.category,
          left.hourType,
          left.teamCode || '',
        ]
          .join('|')
          .localeCompare(
            [
              right.competence || '',
              right.status,
              right.category,
              right.hourType,
              right.teamCode || '',
            ].join('|'),
          ),
      );
    const totalFacts = facts.length;
    const totalHours = facts.reduce(
      (sum, fact) => sum.plus(fact.quantityHours),
      new Prisma.Decimal(0),
    );
    const statusTotals = [...totals.entries()]
      .map(([status, value]) => ({
        status,
        facts: value.facts,
        hours: value.hours.toFixed(6),
      }))
      .sort((left, right) => left.status.localeCompare(right.status));
    const allocated = totals.get('ALOCADO') || {
      facts: 0,
      hours: new Prisma.Decimal(0),
    };
    const classifiedFacts = statusTotals.reduce(
      (sum, entry) => sum + entry.facts,
      0,
    );
    const classifiedHours = statusTotals.reduce(
      (sum, entry) => sum.plus(entry.hours),
      new Prisma.Decimal(0),
    );

    return {
      scope: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        dateFrom: dateKey(dateFrom),
        dateTo: dateKey(dateTo),
        includeUndated: Boolean(query.includeUndated),
      },
      formula:
        'ID_VEICULO + sourceDate dentro da vigencia + categoria identica',
      source: {
        dataset: 'ASPHALT_EQUIPMENT_HOURS',
        facts: totalFacts,
        hours: totalHours.toFixed(6),
      },
      allocated: {
        facts: allocated.facts,
        hours: allocated.hours.toFixed(6),
      },
      closure: {
        classifiedFacts,
        classifiedHours: classifiedHours.toFixed(6),
        factDelta: totalFacts - classifiedFacts,
        hourDelta: totalHours.minus(classifiedHours).toFixed(6),
      },
      statusTotals,
      groups,
      facts: query.includeFacts ? serializedFacts : undefined,
    };
  }

  async findFleetAssignments(competenceValue: unknown, role?: string | null) {
    this.ensureAccess(role);
    const competence = normalizeCompetence(competenceValue);
    const assignments =
      await this.prisma.usinaAsphaltTeamFleetAssignment.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          competence,
          deletedAt: null,
        },
        include: {
          team: {
            include: {
              versions: {
                where: {
                  deletedAt: null,
                  validFrom: { lte: monthEnd(competence) },
                  OR: [{ validTo: null }, { validTo: { gte: competence } }],
                },
                orderBy: { validFrom: 'desc' },
              },
            },
          },
        },
        orderBy: [{ fleetNumber: 'asc' }, { validFrom: 'asc' }],
      });
    return {
      competence: dateKey(competence),
      assignments: assignments.map((assignment) => ({
        ...this.serializeFleetAssignment(assignment),
        team: {
          id: assignment.team.id,
          businessCode: assignment.team.versions[0]?.businessCode || null,
          displayName: assignment.team.versions[0]?.displayName || null,
          responsibleName: assignment.team.versions[0]?.responsibleName || null,
        },
      })),
    };
  }

  async createFleetAssignment(
    teamId: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeFleetAssignmentInput(body);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_FLEET|${input.aethosVehicleId}|${dateKey(input.competence)}`}, 0))`,
        );
        const team = await tx.usinaAsphaltTeam.findFirst({
          where: {
            id: teamId,
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            deletedAt: null,
            validFrom: { lte: input.validTo },
            OR: [{ validTo: null }, { validTo: { gte: input.validFrom } }],
          },
        });
        if (!team)
          throw new BadRequestException('Equipe fora da vigencia informada');
        const vehicle = await tx.vehicle.findFirst({
          where: {
            active: true,
            aethosVehicleId: String(input.aethosVehicleId),
          },
          select: { aethosVehicleId: true, fleet: true, plate: true },
        });
        if (!vehicle) {
          throw new BadRequestException(
            'Veiculo ativo nao encontrado no cadastro Aethos',
          );
        }
        const created = await tx.usinaAsphaltTeamFleetAssignment.create({
          data: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            competence: input.competence,
            teamId,
            aethosVehicleId: input.aethosVehicleId,
            fleetNumber: input.fleetNumber || vehicle.fleet,
            plate: input.plate || vehicle.plate,
            category: input.category,
            validFrom: input.validFrom,
            validTo: input.validTo,
            origin: 'JR_MANUAL',
            observation: input.observation,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId,
          entityType: 'FLEET_ASSIGNMENT',
          entityId: created.id,
          action: 'CREATED',
          note: input.observation,
          after: this.serializeFleetAssignment(created),
          actorId,
        });
        return created.id;
      });
      const created =
        await this.prisma.usinaAsphaltTeamFleetAssignment.findUnique({
          where: { id },
        });
      return this.serializeFleetAssignment(created);
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async updateFleetAssignment(
    id: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const input = normalizeFleetAssignmentInput(body);
    const teamId = String(body?.teamId || '').trim();
    if (!teamId) throw new BadRequestException('Equipe e obrigatoria');
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.usinaAsphaltTeamFleetAssignment.findFirst({
          where: { id, deletedAt: null },
        });
        if (!existing)
          throw new NotFoundException('Vinculo de frota nao encontrado');
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_FLEET|${input.aethosVehicleId}|${dateKey(input.competence)}`}, 0))`,
        );
        const team = await tx.usinaAsphaltTeam.findFirst({
          where: {
            id: teamId,
            deletedAt: null,
            validFrom: { lte: input.validTo },
            OR: [{ validTo: null }, { validTo: { gte: input.validFrom } }],
          },
        });
        if (!team)
          throw new BadRequestException('Equipe fora da vigencia informada');
        const vehicle = await tx.vehicle.findFirst({
          where: {
            active: true,
            aethosVehicleId: String(input.aethosVehicleId),
          },
          select: { fleet: true, plate: true },
        });
        if (!vehicle)
          throw new BadRequestException('Veiculo ativo nao encontrado');
        const updated = await tx.usinaAsphaltTeamFleetAssignment.update({
          where: { id },
          data: {
            competence: input.competence,
            teamId,
            aethosVehicleId: input.aethosVehicleId,
            fleetNumber: input.fleetNumber || vehicle.fleet,
            plate: input.plate || vehicle.plate,
            category: input.category,
            validFrom: input.validFrom,
            validTo: input.validTo,
            observation: input.observation,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId,
          entityType: 'FLEET_ASSIGNMENT',
          entityId: id,
          action: 'UPDATED',
          note: input.observation,
          before: this.serializeFleetAssignment(existing),
          after: this.serializeFleetAssignment(updated),
          actorId,
        });
      });
      const updated =
        await this.prisma.usinaAsphaltTeamFleetAssignment.findUnique({
          where: { id },
        });
      return this.serializeFleetAssignment(updated);
    } catch (error) {
      this.translateDatabaseError(error);
    }
  }

  async deleteFleetAssignment(
    id: string,
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const reason = optionalText(body?.reason, 500);
    if (!reason)
      throw new BadRequestException('Motivo da exclusao e obrigatorio');
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.usinaAsphaltTeamFleetAssignment.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing)
        throw new NotFoundException('Vinculo de frota nao encontrado');
      await tx.usinaAsphaltTeamFleetAssignment.update({
        where: { id },
        data: { deletedAt, deletedById: actorId, updatedById: actorId },
      });
      await this.audit(tx, {
        teamId: existing.teamId,
        entityType: 'FLEET_ASSIGNMENT',
        entityId: id,
        action: 'SOFT_DELETED',
        note: reason,
        before: this.serializeFleetAssignment(existing),
        after: { deletedAt: deletedAt.toISOString() },
        actorId,
      });
    });
    return { ok: true, id, deletedAt: deletedAt.toISOString() };
  }

  async copyPreviousFleetAssignments(
    body: any,
    actorValue?: string | null,
    role?: string | null,
  ) {
    this.ensureAccess(role);
    const actorId = this.ensureActor(actorValue);
    const target = normalizeCompetence(body?.competence);
    const previous = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 1, 1),
    );
    const source = await this.prisma.usinaAsphaltTeamFleetAssignment.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: previous,
        deletedAt: null,
      },
      orderBy: [{ validFrom: 'asc' }, { fleetNumber: 'asc' }],
    });
    if (!source.length)
      throw new BadRequestException('Mes anterior sem cadastro de frotas');
    const existing = await this.prisma.usinaAsphaltTeamFleetAssignment.count({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: target,
        deletedAt: null,
      },
    });
    if (existing)
      throw new BadRequestException('Competencia de destino ja possui frotas');
    const sourceEnd = monthEnd(previous).getUTCDate();
    const targetEnd = monthEnd(target).getUTCDate();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`USINA_ASPHALT_FLEET_COPY|${dateKey(target)}`}, 0))`,
      );
      for (const item of source) {
        const fromDay = Math.min(item.validFrom.getUTCDate(), targetEnd);
        const toDay = Math.min(item.validTo.getUTCDate(), targetEnd);
        const created = await tx.usinaAsphaltTeamFleetAssignment.create({
          data: {
            companyId: item.companyId,
            unitId: item.unitId,
            competence: target,
            teamId: item.teamId,
            aethosVehicleId: item.aethosVehicleId,
            fleetNumber: item.fleetNumber,
            plate: item.plate,
            category: item.category,
            validFrom: new Date(
              Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), fromDay),
            ),
            validTo: new Date(
              Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), toDay),
            ),
            origin: 'JR_MANUAL',
            observation: `Copiado de ${dateKey(previous)} para revisao${item.observation ? ` - ${item.observation}` : ''}`,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await this.audit(tx, {
          teamId: item.teamId,
          entityType: 'FLEET_ASSIGNMENT',
          entityId: created.id,
          action: 'COPIED_FROM_PREVIOUS_MONTH',
          note: `Origem ${dateKey(previous)}`,
          before: { sourceAssignmentId: item.id, sourceMonthDays: sourceEnd },
          after: this.serializeFleetAssignment(created),
          actorId,
        });
      }
    });
    return this.findFleetAssignments(dateKey(target), role);
  }

  private parseYear(value: unknown) {
    const year = Number(value ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2025 || year > 2100) {
      throw new BadRequestException('Ano deve estar entre 2025 e 2100');
    }
    return year;
  }

  async reconciliation(
    yearValue: unknown,
    role?: string | null,
    includeFacts = false,
  ) {
    this.ensureAccess(role);
    const year = this.parseYear(yearValue);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const [
      teams,
      versions,
      assignments,
      facts,
      inactiveFacts,
      runs,
      duplicateRows,
    ] = await Promise.all([
      this.prisma.usinaAsphaltTeam.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.prisma.usinaAsphaltTeamVersion.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.prisma.usinaAsphaltTeamItemAssignment.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.prisma.usinaProductionFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          occurredDate: { gte: from, lt: to },
          active: true,
        },
        select: {
          id: true,
          source: true,
          sourceRecordId: true,
          weighingId: true,
          aethosProductId: true,
          productDescription: true,
          occurredDate: true,
          competence: true,
          quantityTon: true,
          active: true,
          contentHash: true,
        },
        orderBy: [{ occurredDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.usinaProductionFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          occurredDate: { gte: from, lt: to },
          active: false,
        },
        select: { deactivationReason: true, quantityTon: true },
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          dataset: 'PRODUCTION',
          status: 'COMPLETED',
          scopeCompanyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          scopeUnitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          scopeDateFrom: { lt: to },
          scopeDateTo: { gte: from },
        },
        select: { scopeDateFrom: true, scopeDateTo: true, syncRunId: true },
      }),
      this.prisma.$queryRaw<Array<{ sourceRecordId: string; total: bigint }>>`
          SELECT "sourceRecordId", COUNT(*)::bigint AS total
          FROM "UsinaProductionFact"
          WHERE "companyId" = ${USINA_ASPHALT_TEAM_CONTEXT.companyId}
            AND "unitId" = ${USINA_ASPHALT_TEAM_CONTEXT.unitId}
            AND "occurredDate" >= ${from}::date
            AND "occurredDate" < ${to}::date
            AND "active" = TRUE
          GROUP BY "sourceRecordId"
          HAVING COUNT(*) > 1
        `,
    ]);

    const coveredCompetences = new Set<string>();
    for (let month = 0; month < 12; month += 1) {
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 0));
      if (
        runs.some(
          (run) =>
            run.scopeDateFrom <= monthStart && run.scopeDateTo >= monthEnd,
        )
      ) {
        coveredCompetences.add(dateKey(monthStart));
      }
    }

    const result = reconcileUsinaAsphaltTeams({
      year,
      facts,
      teams,
      versions,
      assignments,
      coveredCompetences,
      includeFacts,
    });
    const exclusions = new Map<
      string,
      { tickets: number; totalTon: Prisma.Decimal }
    >();
    for (const fact of inactiveFacts) {
      const reason = fact.deactivationReason || 'SEM_MOTIVO_INFORMADO';
      const current = exclusions.get(reason) || {
        tickets: 0,
        totalTon: new Prisma.Decimal(0),
      };
      current.tickets += 1;
      current.totalTon = current.totalTon.plus(fact.quantityTon);
      exclusions.set(reason, current);
    }

    return {
      ...result,
      context: USINA_ASPHALT_TEAM_CONTEXT,
      source: {
        dataset: 'PRODUCTION',
        factTable: 'UsinaProductionFact',
        assignmentRule:
          'ID_ITEM + data da pesagem dentro da vigencia persistida',
        descriptionParsingUsed: false,
        completedRuns: runs.map((run) => run.syncRunId),
      },
      exclusions: [...exclusions.entries()].map(([reason, value]) => ({
        reason,
        tickets: value.tickets,
        totalTon: value.totalTon.toFixed(6),
      })),
      integrity: {
        ...result.integrity,
        databaseDuplicateFactKeys: duplicateRows.map((row) => ({
          sourceRecordId: row.sourceRecordId,
          count: Number(row.total),
        })),
        databaseDuplicateFactCount: duplicateRows.length,
      },
    };
  }

  async dashboard(
    yearValue: unknown,
    role?: string | null,
    includeFacts = false,
  ) {
    this.ensureAccess(role);
    const year = this.parseYear(yearValue);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const [
      production,
      profiles,
      assignments,
      facts,
      runs,
      sharedCostFacts,
      sharedCostRuns,
      lastProductionRun,
      lastFreightRun,
      lastPayableRun,
      lastInternalConsumptionRun,
    ] = await Promise.all([
      this.reconciliation(year, role, includeFacts),
      this.prisma.usinaAsphaltTeamVersion.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.prisma.usinaAsphaltTeamFleetAssignment.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          competence: { gte: from, lt: to },
        },
      }),
      this.prisma.usinaAsphaltFleetFreightFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          occurredDate: { gte: from, lt: to },
          active: true,
        },
        select: {
          id: true,
          sourceRecordId: true,
          sourceKind: true,
          sourceDocumentId: true,
          sourceInstallmentId: true,
          occurredDate: true,
          competence: true,
          aethosVehicleId: true,
          fleetNumber: true,
          plate: true,
          freightTypeId: true,
          freightTypeDescription: true,
          quantity: true,
          unit: true,
          amount: true,
          active: true,
        },
        orderBy: [{ occurredDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET,
          status: 'COMPLETED',
          scopeCompanyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          scopeUnitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          scopeDateFrom: { lt: to },
          scopeDateTo: { gte: from },
        },
        select: { scopeDateFrom: true, scopeDateTo: true, syncRunId: true },
      }),
      this.prisma.usinaOperationalCostFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          competence: { gte: from, lt: to },
          active: true,
          costClass: {
            in: USINA_ASPHALT_TEAM_SHARED_COSTS.map(
              (definition) => definition.costClass,
            ),
          },
        },
        select: {
          sourceRecordId: true,
          dataset: true,
          costClass: true,
          competence: true,
          amount: true,
          active: true,
        },
        orderBy: [{ competence: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          dataset: {
            in: USINA_ASPHALT_TEAM_SHARED_COSTS.map(
              (definition) => definition.dataset,
            ),
          },
          status: 'COMPLETED',
          scopeCompanyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          scopeUnitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          scopeDateFrom: { lt: to },
          scopeDateTo: { gte: from },
        },
        select: {
          dataset: true,
          scopeDateFrom: true,
          scopeDateTo: true,
          syncRunId: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: 'PRODUCTION' },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          syncRunId: true,
          completedAt: true,
          scopeDateFrom: true,
          scopeDateTo: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          syncRunId: true,
          completedAt: true,
          scopeDateFrom: true,
          scopeDateTo: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: 'PAYABLE_EXPENSES' },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          syncRunId: true,
          completedAt: true,
          scopeDateFrom: true,
          scopeDateTo: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: { dataset: 'INTERNAL_CONSUMPTION_EXPENSES' },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          syncRunId: true,
          completedAt: true,
          scopeDateFrom: true,
          scopeDateTo: true,
        },
      }),
    ]);

    const coveredCompetences = new Set<string>();
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(Date.UTC(year, month, 1));
      const end = new Date(Date.UTC(year, month + 1, 0));
      if (
        runs.some((run) => run.scopeDateFrom <= start && run.scopeDateTo >= end)
      ) {
        coveredCompetences.add(dateKey(start));
      }
    }
    const fleetFreight = reconcileUsinaAsphaltFleetFreights({
      year,
      facts,
      assignments,
      teamProfiles: profiles,
      coveredCompetences,
      includeFacts,
    });
    const coveredCompetencesByClass = Object.fromEntries(
      USINA_ASPHALT_TEAM_SHARED_COSTS.map((definition) => {
        const classHasFacts = sharedCostFacts.some(
          (fact) => fact.costClass === definition.costClass,
        );
        const covered = new Set<string>();
        if (classHasFacts) {
          for (let month = 0; month < 12; month += 1) {
            const start = new Date(Date.UTC(year, month, 1));
            const end = new Date(Date.UTC(year, month + 1, 0));
            if (
              sharedCostRuns.some(
                (run) =>
                  run.dataset === definition.dataset &&
                  run.scopeDateFrom <= start &&
                  run.scopeDateTo >= end,
              )
            ) {
              covered.add(dateKey(start));
            }
          }
        }
        return [definition.costClass, covered];
      }),
    );
    const sharedCosts = reconcileUsinaAsphaltTeamSharedCosts({
      year,
      facts: sharedCostFacts,
      productionMonths: production.months,
      coveredCompetencesByClass,
    });
    const derivedCosts = reconcileUsinaAsphaltTeamDerivedCosts({
      year,
      productionMonths: production.months,
      fleetFreightMonths: fleetFreight.months,
      sharedCostLines: sharedCosts.lines,
    });
    const [equipmentHourlyRates, equipmentHoursReadback] = await Promise.all([
      this.listEquipmentHourlyRates(year, role),
      this.equipmentHoursReadback(
        {
          dateFrom: dateKey(from),
          dateTo: dateKey(new Date(Date.UTC(year, 11, 31))),
          includeUndated: false,
          includeFacts: false,
        },
        role,
      ),
    ]);
    const equipmentCosts = reconcileUsinaAsphaltEquipmentCosts({
      year,
      groups: equipmentHoursReadback.groups,
      rateMonths: equipmentHourlyRates.months,
    });
    return {
      context: USINA_ASPHALT_TEAM_CONTEXT,
      production,
      fleetFreight: {
        ...fleetFreight,
        source: {
          dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET,
          procedure: 'PROC_REL_GERENCIAMENTO_FRETE',
          block: 'FATURAMENTO',
          assignmentRule:
            'ID_VEICULO + DT_LANCAMENTO dentro do cadastro mensal JR',
          completedRuns: runs.map((run) => run.syncRunId),
        },
      },
      sharedCosts: {
        ...sharedCosts,
        source: {
          definitions: USINA_ASPHALT_TEAM_SHARED_COSTS,
          completedRuns: sharedCostRuns.map((run) => ({
            dataset: run.dataset,
            syncRunId: run.syncRunId,
          })),
        },
      },
      derivedCosts,
      equipmentHourlyRates,
      equipmentCosts,
      synchronization: {
        production: lastProductionRun,
        fleetFreight: lastFreightRun,
        chemicalToilet: lastPayableRun,
        officeMaterial: lastInternalConsumptionRun,
        automaticPolicy: {
          production: 'EXTRACTOR_SERVER_CONTROLLED',
          fleetFreight: 'EXTRACTOR_SERVER_CONTROLLED',
          periodicSyncNeverWritesAssignments: true,
        },
      },
    };
  }

  async dashboardMemory(input: any, role?: string | null) {
    this.ensureAccess(role);
    const year = this.parseYear(input?.year);
    const month = Number(input?.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mes deve estar entre 1 e 12');
    }
    const teamId = String(input?.teamId || '').trim();
    if (!teamId) throw new BadRequestException('Equipe obrigatoria');
    const kind = String(input?.kind || '')
      .trim()
      .toLowerCase();
    if (
      ![
        'production',
        'freight',
        'shared_cost',
        'derived_cost',
        'equipment_cost',
      ].includes(kind)
    ) {
      throw new BadRequestException('Tipo de memoria invalido');
    }
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const competence = dateKey(from);

    if (kind === 'equipment_cost') {
      const metric = normalizeEquipmentCostMetric(input?.metric);
      const category = normalizeEquipmentRateCategory(input?.category);
      const hourType = metric.startsWith('PRODUCTIVE')
        ? 'PRODUTIVA'
        : 'IMPRODUTIVA';
      const [readback, rates] = await Promise.all([
        this.equipmentHoursReadback(
          {
            dateFrom: competence,
            dateTo: dateKey(new Date(Date.UTC(year, month, 0))),
            includeUndated: false,
            includeFacts: true,
          },
          role,
        ),
        this.listEquipmentHourlyRates(year, role),
      ]);
      const facts = (readback.facts || []).filter(
        (fact: any) =>
          fact.allocationStatus === 'ALOCADO' &&
          fact.teamId === teamId &&
          fact.category === category &&
          fact.hourType === hourType,
      );
      const hours = facts.length
        ? facts
            .reduce(
              (sum: Prisma.Decimal, fact: any) =>
                sum.plus(fact.quantityHours),
              new Prisma.Decimal(0),
            )
            .toFixed(6)
        : null;
      const rateRow = rates.months[month - 1]?.categories.find(
        (entry) => entry.category === category,
      );
      const rate =
        hourType === 'PRODUTIVA'
          ? rateRow?.productiveRate ?? null
          : rateRow?.unproductiveRate ?? null;
      const amount =
        hours !== null && rate !== null
          ? new Prisma.Decimal(hours).mul(rate).toFixed(6)
          : null;
      const isAmount = metric.endsWith('_AMOUNT');

      return {
        kind,
        metric,
        year,
        month,
        competence,
        teamId,
        category,
        hourType,
        formula: isAmount
          ? `tarifa ${hourType.toLowerCase()} mensal JR_MANUAL da categoria x horas ${hourType.toLowerCase()}`
          : `soma de quantityHours dos fatos ALOCADO com hourType ${hourType}`,
        sourceDataset: 'ASPHALT_EQUIPMENT_HOURS',
        assignmentRule:
          'ID_VEICULO + sourceDate dentro da vigencia + categoria identica',
        factsCount: facts.length,
        hours,
        rate,
        amount,
        value: isAmount ? amount : hours,
        persistence: 'DERIVED_ONLY_NO_NEW_FACTS',
        participatesInFirstConsolidated: false,
        facts: facts.map((fact: any) => ({
          ...fact,
          amount:
            rate === null
              ? null
              : new Prisma.Decimal(fact.quantityHours)
                  .mul(rate)
                  .toFixed(6),
        })),
      };
    }

    if (kind === 'production') {
      const [teams, versions, assignments, facts] = await Promise.all([
        this.prisma.usinaAsphaltTeam.findMany({
          where: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            deletedAt: null,
            validFrom: { lt: to },
            OR: [{ validTo: null }, { validTo: { gte: from } }],
          },
        }),
        this.prisma.usinaAsphaltTeamVersion.findMany({
          where: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            deletedAt: null,
            validFrom: { lt: to },
            OR: [{ validTo: null }, { validTo: { gte: from } }],
          },
        }),
        this.prisma.usinaAsphaltTeamItemAssignment.findMany({
          where: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            deletedAt: null,
            validFrom: { lt: to },
            OR: [{ validTo: null }, { validTo: { gte: from } }],
          },
        }),
        this.prisma.usinaProductionFact.findMany({
          where: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            occurredDate: { gte: from, lt: to },
            active: true,
          },
          select: {
            sourceRecordId: true,
            weighingId: true,
            aethosProductId: true,
            productDescription: true,
            occurredDate: true,
            competence: true,
            quantityTon: true,
            active: true,
            contentHash: true,
          },
          orderBy: [{ occurredDate: 'asc' }, { sourceRecordId: 'asc' }],
        }),
      ]);
      const result = reconcileUsinaAsphaltTeams({
        year,
        facts,
        teams,
        versions,
        assignments,
        coveredCompetences: [competence],
        includeFacts: true,
      });
      const bucket = result.months[month - 1].teams.find(
        (item) => item.teamId === teamId,
      );
      return {
        kind,
        year,
        month,
        competence,
        teamId,
        tickets: bucket?.tickets ?? 0,
        totalTon: bucket?.totalTon ?? '0.000000',
        facts: bucket?.facts || [],
      };
    }

    if (kind === 'derived_cost') {
      const metric = normalizeDerivedCostMetric(input?.metric);
      const dashboard = await this.dashboard(year, role, false);
      const monthRow = dashboard.derivedCosts.months[month - 1];
      const team = monthRow?.teams.find((item) => item.teamId === teamId);
      if (!team) throw new NotFoundException('Equipe nao encontrada no mes');
      return {
        kind,
        metric,
        year,
        month,
        competence,
        teamId,
        label: metric === 'TOTAL' ? 'TOTAL (R$)' : 'CUSTO UNIT. (R$/T)',
        covered:
          metric === 'TOTAL'
            ? team.costsCovered
            : team.status === 'CALCULADO',
        status: team.status,
        totalAmount: team.totalAmount,
        productionTon: team.productionTon,
        unitCost: team.unitCost,
        formula:
          metric === 'TOTAL'
            ? dashboard.derivedCosts.formulas.total
            : dashboard.derivedCosts.formulas.unitCost,
        components: team.components,
        persistence: dashboard.derivedCosts.persistence,
        facts: [],
      };
    }

    if (kind === 'shared_cost') {
      const costClass = normalizeSharedCostClass(input?.costClass);
      const [dashboard, facts] = await Promise.all([
        this.dashboard(year, role, false),
        this.prisma.usinaOperationalCostFact.findMany({
          where: {
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            competence: from,
            active: true,
            costClass,
          },
          select: {
            sourceRecordId: true,
            sourceDocumentId: true,
            sourceDocumentType: true,
            dataset: true,
            accountPlanId: true,
            accountPlanDescription: true,
            occurredDate: true,
            competence: true,
            amount: true,
            quantity: true,
            quantityUnit: true,
            internalConsumptionId: true,
            internalConsumptionItemId: true,
            aethosItemId: true,
            itemDescription: true,
            itemCategoryId: true,
            itemCategoryDescription: true,
            sourceStatus: true,
          },
          orderBy: [{ occurredDate: 'asc' }, { sourceRecordId: 'asc' }],
        }),
      ]);
      const line = dashboard.sharedCosts.lines.find(
        (item) => item.costClass === costClass,
      );
      const bucket = line?.months[month - 1];
      const team = bucket?.teams.find((item) => item.teamId === teamId);
      return {
        kind,
        year,
        month,
        competence,
        teamId,
        costClass,
        label: line?.label || costClass,
        covered: bucket?.covered ?? false,
        status: bucket?.status || 'FONTE_NAO_COBERTA',
        amount: team?.amount ?? null,
        productionTon: team?.productionTon ?? null,
        sourceTotal: bucket?.sourceTotal ?? null,
        sourceDocuments: bucket?.sourceDocuments ?? null,
        productiveTeamCount: bucket?.productiveTeamCount ?? null,
        quotient: bucket?.quotient ?? null,
        nonAllocated: bucket?.nonAllocated ?? null,
        roundingResidual: bucket?.roundingResidual ?? null,
        formula:
          'valor da equipe = total mensal da rubrica / quantidade de equipes com Producao (t) > 0',
        facts: facts.map((fact) => ({
          ...fact,
          occurredDate: dateKey(fact.occurredDate),
          competence: dateKey(fact.competence),
          amount: fact.amount.toFixed(6),
          quantity: fact.quantity?.toFixed(6) ?? null,
        })),
      };
    }

    const category = normalizeFleetCategory(input?.category);
    const [profiles, assignments, facts] = await Promise.all([
      this.prisma.usinaAsphaltTeamVersion.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.prisma.usinaAsphaltTeamFleetAssignment.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          deletedAt: null,
          competence: from,
        },
      }),
      this.prisma.usinaAsphaltFleetFreightFact.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          occurredDate: { gte: from, lt: to },
          active: true,
        },
        select: {
          id: true,
          sourceRecordId: true,
          sourceKind: true,
          sourceDocumentId: true,
          sourceInstallmentId: true,
          occurredDate: true,
          competence: true,
          aethosVehicleId: true,
          fleetNumber: true,
          plate: true,
          freightTypeId: true,
          freightTypeDescription: true,
          quantity: true,
          unit: true,
          amount: true,
          active: true,
        },
        orderBy: [{ occurredDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
    ]);
    const result = reconcileUsinaAsphaltFleetFreights({
      year,
      facts,
      assignments,
      teamProfiles: profiles,
      coveredCompetences: [competence],
      includeFacts: true,
    });
    const bucket = result.months[month - 1].teams
      .find((item) => item.teamId === teamId)
      ?.categories.find((item) => item.category === category);
    return {
      kind,
      year,
      month,
      competence,
      teamId,
      category,
      documents: bucket?.documents ?? 0,
      amount: bucket?.amount ?? '0.000000',
      facts: bucket?.facts || [],
    };
  }

  async currentSnapshot(keysValue: unknown, role?: string | null) {
    this.ensureAccess(role);
    const keys = String(keysValue || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (!keys.length)
      throw new BadRequestException('Informe ao menos uma chave');
    const facts = await this.prisma.usinaProductionFact.findMany({
      where: { sourceRecordId: { in: keys } },
      select: {
        sourceRecordId: true,
        weighingId: true,
        aethosProductId: true,
        productDescription: true,
        occurredDate: true,
        quantityTon: true,
        active: true,
        contentHash: true,
        weighingVehicleStatus: true,
        weighingStatus: true,
        deactivationReason: true,
        deactivatedAt: true,
      },
      orderBy: { sourceRecordId: 'asc' },
    });
    return {
      requested: keys.length,
      found: facts.length,
      missing: keys.filter(
        (key) => !facts.some((fact) => fact.sourceRecordId === key),
      ),
      facts: facts.map((fact) => ({
        ...fact,
        occurredDate: dateKey(fact.occurredDate),
        quantityTon: fact.quantityTon.toFixed(6),
      })),
    };
  }
}
