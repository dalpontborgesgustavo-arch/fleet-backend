import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  bomSnapshot,
  canAccessUsinaBom,
  dateKey,
  normalizeBomComponents,
  parseIsoDate,
  parseNullableText,
  parsePositiveInteger,
  parseRequiredText,
  previousUtcDate,
} from './usina-bom.rules';

const visibleComponents = {
  where: { deletedAt: null },
  orderBy: { sortOrder: 'asc' as const },
};

const visibleVersions = {
  where: { deletedAt: null },
  orderBy: { version: 'desc' as const },
  include: { components: visibleComponents },
};

@Injectable()
export class UsinaBomService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!canAccessUsinaBom(role)) {
      throw new ForbiddenException(
        'Somente Qualidade e Administrador podem acessar as estruturas da Usina',
      );
    }
  }

  private ensureActor(actorId?: string | null) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }
    return actorId;
  }

  private async ensureActiveAethosComponents(
    tx: any,
    components: Array<{ aethosMaterialId: number }>,
  ) {
    const expectedCodes = [
      ...new Set(
        components.map((component) => String(component.aethosMaterialId)),
      ),
    ];
    const activeItems = await tx.aethosItem.findMany({
      where: { active: true, code: { in: expectedCodes } },
      select: { code: true },
    });
    const activeCodes = new Set(activeItems.map((item: any) => item.code));
    const unavailableCodes = expectedCodes.filter(
      (code) => !activeCodes.has(code),
    );
    if (unavailableCodes.length > 0) {
      throw new BadRequestException(
        `Selecione somente materias-primas ativas da lista do Aethos. Itens indisponiveis: ${unavailableCodes.join(', ')}`,
      );
    }
  }

  private normalizeContext(body: any) {
    return {
      companyId: parseNullableText(body?.companyId),
      unitId: parseNullableText(body?.unitId),
    };
  }

  private async actorNamesFor(structures: any[]) {
    const ids = new Set<string>();
    const add = (value?: string | null) => {
      if (value) ids.add(value);
    };
    for (const structure of structures) {
      add(structure.createdById);
      add(structure.updatedById);
      add(structure.inactivatedById);
      add(structure.deletedById);
      for (const version of structure.versions || []) {
        add(version.createdById);
        add(version.updatedById);
        add(version.inactivatedById);
        add(version.deletedById);
      }
      for (const audit of structure.audit || []) add(audit.actorId);
    }
    if (ids.size === 0) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private async productDescriptionsFor(structures: any[]) {
    const codes = [
      ...new Set(
        structures.map((structure) => String(structure.aethosProductId)),
      ),
    ];
    if (codes.length === 0) return new Map<string, string>();
    const items = await this.prisma.aethosItem.findMany({
      where: { code: { in: codes } },
      select: { code: true, description: true },
    });
    return new Map(items.map((item) => [item.code, item.description]));
  }

  private serialize(
    structure: any,
    actorNames = new Map<string, string>(),
    productDescriptions = new Map<string, string>(),
  ) {
    const versions = (structure.versions || []).map((version: any) => {
      const components = (version.components || []).map((component: any) => ({
        ...component,
        consumptionPercent: component.consumptionPercent.toString(),
        createdByName: component.createdById
          ? actorNames.get(component.createdById) || null
          : null,
        updatedByName: component.updatedById
          ? actorNames.get(component.updatedById) || null
          : null,
      }));
      const total = components.reduce(
        (sum: Prisma.Decimal, component: any) =>
          sum.plus(component.consumptionPercent),
        new Prisma.Decimal(0),
      );
      return {
        ...version,
        validFrom: dateKey(version.validFrom),
        validTo: version.validTo ? dateKey(version.validTo) : null,
        componentCount: components.length,
        totalPercent: total.toString(),
        createdByName: version.createdById
          ? actorNames.get(version.createdById) || null
          : null,
        updatedByName: version.updatedById
          ? actorNames.get(version.updatedById) || null
          : null,
        inactivatedByName: version.inactivatedById
          ? actorNames.get(version.inactivatedById) || null
          : null,
        components,
      };
    });
    const currentVersion =
      versions.find((version: any) => version.active) || null;
    return {
      ...structure,
      aethosProductDescription:
        productDescriptions.get(String(structure.aethosProductId)) || null,
      createdByName: structure.createdById
        ? actorNames.get(structure.createdById) || null
        : null,
      updatedByName: structure.updatedById
        ? actorNames.get(structure.updatedById) || null
        : null,
      inactivatedByName: structure.inactivatedById
        ? actorNames.get(structure.inactivatedById) || null
        : null,
      versions,
      currentVersion,
      audit: (structure.audit || []).map((item: any) => ({
        ...item,
        actorName: item.actorId
          ? actorNames.get(item.actorId) || null
          : 'Sistema',
      })),
    };
  }

  async searchActiveAethosItems(
    search?: string,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const normalizedSearch = String(search || '').trim();
    const items = await this.prisma.aethosItem.findMany({
      where: {
        active: true,
        ...(normalizedSearch
          ? {
              OR: [
                {
                  code: {
                    contains: normalizedSearch,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  description: {
                    contains: normalizedSearch,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ description: 'asc' }, { code: 'asc' }],
      take: 100,
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        active: true,
      },
    });
    return items.filter((item) => /^\d+$/.test(item.code)).slice(0, 50);
  }

  async findAll(
    filters: { search?: string; status?: string },
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const status = String(filters.status || 'all')
      .trim()
      .toLowerCase();
    if (!['all', 'active', 'inactive'].includes(status)) {
      throw new BadRequestException(
        'Situacao deve ser active, inactive ou all',
      );
    }
    const search = String(filters.search || '').trim();
    const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
    const structures = await this.prisma.usinaBomStructure.findMany({
      where: {
        deletedAt: null,
        ...(status === 'all' ? {} : { active: status === 'active' }),
        ...(search
          ? {
              OR: [
                ...(numericSearch ? [{ aethosProductId: numericSearch }] : []),
                {
                  versions: {
                    some: {
                      deletedAt: null,
                      traceName: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: { versions: visibleVersions },
      orderBy: { aethosProductId: 'asc' },
    });
    const [actorNames, productDescriptions] = await Promise.all([
      this.actorNamesFor(structures),
      this.productDescriptionsFor(structures),
    ]);
    return structures.map((structure) =>
      this.serialize(structure, actorNames, productDescriptions),
    );
  }

  async findOne(id: string, actorRole?: string | null) {
    this.ensureAccess(actorRole);
    const structure = await this.prisma.usinaBomStructure.findFirst({
      where: { id, deletedAt: null },
      include: {
        versions: visibleVersions,
        audit: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!structure) throw new NotFoundException('Estrutura nao encontrada');
    const [actorNames, productDescriptions] = await Promise.all([
      this.actorNamesFor([structure]),
      this.productDescriptionsFor([structure]),
    ]);
    return this.serialize(structure, actorNames, productDescriptions);
  }

  async create(
    body: any,
    actorIdValue?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const actorId = this.ensureActor(actorIdValue);
    const context = this.normalizeContext(body);
    const aethosProductId = parsePositiveInteger(
      body?.aethosProductId,
      'Codigo Aethos do produto acabado',
    );
    const traceName = parseRequiredText(body?.traceName, 'Traco');
    const validFrom = parseIsoDate(body?.validFrom, 'Inicio da vigencia');
    const components = normalizeBomComponents(body?.components);
    const contextLock = `${context.companyId || 'GLOBAL'}|${context.unitId || 'GLOBAL'}|${aethosProductId}`;

    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`WITH acquired_lock AS (
            SELECT pg_advisory_xact_lock(hashtextextended(${contextLock}, 0))
          ) SELECT 1 AS "locked" FROM acquired_lock`,
        );
        const existing = await tx.usinaBomStructure.findFirst({
          where: { ...context, aethosProductId, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException(
            `Ja existe uma estrutura para o produto Aethos ${aethosProductId}`,
          );
        }

        const activeAethosItem = await tx.aethosItem.findUnique({
          where: { code: String(aethosProductId) },
          select: { active: true },
        });
        if (!activeAethosItem?.active) {
          throw new BadRequestException(
            'Selecione um produto ativo da lista de itens do Aethos',
          );
        }
        await this.ensureActiveAethosComponents(tx, components);

        const structure = await tx.usinaBomStructure.create({
          data: {
            ...context,
            aethosProductId,
            active: true,
            createdById: actorId,
            updatedById: actorId,
            versions: {
              create: {
                version: 1,
                traceName,
                validFrom,
                active: true,
                createdById: actorId,
                updatedById: actorId,
                components: {
                  create: components.map((component) => ({
                    ...component,
                    createdById: actorId,
                    updatedById: actorId,
                  })),
                },
              },
            },
          },
          include: { versions: visibleVersions },
        });
        const version = structure.versions[0];
        await tx.usinaBomAudit.create({
          data: {
            structureId: structure.id,
            versionId: version.id,
            action: 'CREATED',
            note: 'Estrutura criada no Sistema JR',
            snapshot: bomSnapshot({
              aethosProductId,
              traceName,
              version: 1,
              validFrom,
              components,
            }) as Prisma.InputJsonValue,
            actorId,
          },
        });
        return structure.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.findOne(created, actorRole);
  }

  async createVersion(
    id: string,
    body: any,
    actorIdValue?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const actorId = this.ensureActor(actorIdValue);
    const traceName = parseRequiredText(body?.traceName, 'Traco');
    const validFrom = parseIsoDate(body?.validFrom, 'Inicio da vigencia');
    const components = normalizeBomComponents(body?.components);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "UsinaBomStructure" WHERE "id" = ${id} FOR UPDATE`,
        );
        const structure = await tx.usinaBomStructure.findFirst({
          where: { id, deletedAt: null },
          include: { versions: visibleVersions },
        });
        if (!structure) throw new NotFoundException('Estrutura nao encontrada');
        if (!structure.active) {
          throw new BadRequestException(
            'Estrutura inativa deve ser reativada antes de receber nova versao',
          );
        }
        await this.ensureActiveAethosComponents(tx, components);
        const current = structure.versions.find((version) => version.active);
        if (!current) {
          throw new BadRequestException(
            'Estrutura nao possui uma versao vigente',
          );
        }
        if (validFrom <= current.validFrom) {
          throw new BadRequestException(
            'A nova vigencia deve iniciar depois da vigencia da versao atual',
          );
        }
        const previousEnd = previousUtcDate(validFrom);
        const nextVersion =
          Math.max(...structure.versions.map((item) => item.version)) + 1;
        const changedAt = new Date();

        await tx.usinaBomVersion.update({
          where: { id: current.id },
          data: {
            active: false,
            validTo: previousEnd,
            updatedById: actorId,
            inactivatedById: actorId,
            inactivatedAt: changedAt,
            inactivationReason: `Substituida pela versao ${nextVersion}`,
          },
        });
        const version = await tx.usinaBomVersion.create({
          data: {
            structureId: id,
            version: nextVersion,
            traceName,
            validFrom,
            active: true,
            createdById: actorId,
            updatedById: actorId,
            components: {
              create: components.map((component) => ({
                ...component,
                createdById: actorId,
                updatedById: actorId,
              })),
            },
          },
        });
        await tx.usinaBomStructure.update({
          where: { id },
          data: { updatedById: actorId },
        });
        await tx.usinaBomAudit.create({
          data: {
            structureId: id,
            versionId: version.id,
            action: 'VERSION_CREATED',
            note: `Versao ${nextVersion} criada; versao ${current.version} encerrada em ${dateKey(previousEnd)}`,
            snapshot: bomSnapshot({
              aethosProductId: structure.aethosProductId,
              traceName,
              version: nextVersion,
              validFrom,
              components,
            }) as Prisma.InputJsonValue,
            actorId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.findOne(id, actorRole);
  }

  async setStatus(
    id: string,
    body: any,
    actorIdValue?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const actorId = this.ensureActor(actorIdValue);
    if (typeof body?.active !== 'boolean') {
      throw new BadRequestException('Informe a situacao ativa ou inativa');
    }
    const effectiveDate = parseIsoDate(
      body?.effectiveDate,
      'Data da alteracao',
    );
    const reason = parseNullableText(body?.reason, 500);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "UsinaBomStructure" WHERE "id" = ${id} FOR UPDATE`,
        );
        const structure = await tx.usinaBomStructure.findFirst({
          where: { id, deletedAt: null },
          include: { versions: visibleVersions },
        });
        if (!structure) throw new NotFoundException('Estrutura nao encontrada');
        if (structure.active === body.active) return;
        const changedAt = new Date();

        if (!body.active) {
          const current = structure.versions.find((version) => version.active);
          if (!current)
            throw new BadRequestException('Versao vigente nao encontrada');
          if (effectiveDate < current.validFrom) {
            throw new BadRequestException(
              'A data de inativacao nao pode ser anterior ao inicio da vigencia',
            );
          }
          await tx.usinaBomVersion.update({
            where: { id: current.id },
            data: {
              active: false,
              validTo: effectiveDate,
              updatedById: actorId,
              inactivatedById: actorId,
              inactivatedAt: changedAt,
              inactivationReason: reason,
            },
          });
          await tx.usinaBomStructure.update({
            where: { id },
            data: {
              active: false,
              updatedById: actorId,
              inactivatedById: actorId,
              inactivatedAt: changedAt,
              inactivationReason: reason,
            },
          });
          await tx.usinaBomAudit.create({
            data: {
              structureId: id,
              versionId: current.id,
              action: 'INACTIVATED',
              note:
                reason || `Estrutura inativada em ${dateKey(effectiveDate)}`,
              actorId,
            },
          });
          return;
        }

        const latest = structure.versions[0];
        if (!latest)
          throw new BadRequestException(
            'Historico da estrutura nao encontrado',
          );
        const lowerBound = latest.validTo || latest.validFrom;
        if (effectiveDate <= lowerBound) {
          throw new BadRequestException(
            `A reativacao deve ocorrer depois de ${dateKey(lowerBound)}`,
          );
        }
        const nextVersion = latest.version + 1;
        const copiedComponents = latest.components.map((component) => ({
          aethosMaterialId: component.aethosMaterialId,
          materialName: component.materialName,
          consumptionPercent: component.consumptionPercent,
          sortOrder: component.sortOrder,
        }));
        const version = await tx.usinaBomVersion.create({
          data: {
            structureId: id,
            version: nextVersion,
            traceName: latest.traceName,
            validFrom: effectiveDate,
            active: true,
            createdById: actorId,
            updatedById: actorId,
            components: {
              create: copiedComponents.map((component) => ({
                ...component,
                createdById: actorId,
                updatedById: actorId,
              })),
            },
          },
        });
        await tx.usinaBomStructure.update({
          where: { id },
          data: {
            active: true,
            updatedById: actorId,
            inactivatedById: null,
            inactivatedAt: null,
            inactivationReason: null,
          },
        });
        await tx.usinaBomAudit.create({
          data: {
            structureId: id,
            versionId: version.id,
            action: 'REACTIVATED',
            note: reason || `Estrutura reativada na versao ${nextVersion}`,
            actorId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.findOne(id, actorRole);
  }

  async softDelete(
    id: string,
    body: any,
    actorIdValue?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);
    const actorId = this.ensureActor(actorIdValue);
    const reason = parseRequiredText(body?.reason, 'Motivo da exclusao', 500);
    const deletedAt = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "UsinaBomStructure" WHERE "id" = ${id} FOR UPDATE`,
        );
        const structure = await tx.usinaBomStructure.findFirst({
          where: { id, deletedAt: null },
          include: { versions: visibleVersions },
        });
        if (!structure) throw new NotFoundException('Estrutura nao encontrada');
        await tx.usinaBomVersion.updateMany({
          where: { structureId: id, deletedAt: null },
          data: {
            active: false,
            deletedAt,
            deletedById: actorId,
            updatedById: actorId,
          },
        });
        await tx.usinaBomComponent.updateMany({
          where: { version: { structureId: id }, deletedAt: null },
          data: {
            deletedAt,
            deletedById: actorId,
            updatedById: actorId,
          },
        });
        await tx.usinaBomStructure.update({
          where: { id },
          data: {
            active: false,
            deletedAt,
            deletedById: actorId,
            updatedById: actorId,
          },
        });
        await tx.usinaBomAudit.create({
          data: {
            structureId: id,
            action: 'SOFT_DELETED',
            note: reason,
            actorId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ok: true, id, deletedAt: deletedAt.toISOString() };
  }
}
