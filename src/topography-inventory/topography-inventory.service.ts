import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_COMPANIES = new Set(['USINA_JR', 'PEDRAFORTE']);

type InventoryPayload = {
  company?: unknown;
  referenceYear?: unknown;
  referenceMonth?: unknown;
  measuredAt?: unknown;
  items?: unknown;
};

type InventoryItemPayload = {
  materialId?: unknown;
  volumeM3?: unknown;
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

function parseCompany(value: unknown) {
  const company = text(value).toUpperCase();
  if (!ALLOWED_COMPANIES.has(company)) {
    throw new BadRequestException('Empresa de inventário inválida');
  }
  return company;
}

function parseInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException(`${label} inválido`);
  }
  return parsed;
}

function parseReference(yearValue: unknown, monthValue: unknown) {
  const year = parseInteger(yearValue, 'Ano de referência');
  const month = parseInteger(monthValue, 'Mês de referência');
  if (year < 2020 || year > 2100) {
    throw new BadRequestException('Ano de referência inválido');
  }
  if (month < 1 || month > 12) {
    throw new BadRequestException('Mês de referência inválido');
  }
  return { year, month };
}

function parseMeasuredAt(value: unknown) {
  const raw = text(value);
  if (!raw) throw new BadRequestException('Data e hora da medição são obrigatórias');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Data e hora da medição inválidas');
  }
  return parsed;
}

export function parseInventoryVolume(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('Volume inválido');
    }
    return new Prisma.Decimal(value).toDecimalPlaces(3);
  }

  const raw = text(value).replace(/\s/g, '');
  if (!raw) throw new BadRequestException('Preencha o volume de todos os materiais');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException('Volume inválido');
  }
  return new Prisma.Decimal(parsed).toDecimalPlaces(3);
}

export function calculateInventoryTonnage(
  volume: Prisma.Decimal,
  density?: Prisma.Decimal | null,
) {
  return density
    ? volume.mul(density).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP)
    : null;
}

function decimal(value?: Prisma.Decimal | null) {
  return value === null || value === undefined ? null : Number(value);
}

const inventoryInclude = {
  items: {
    include: { material: true },
    orderBy: { material: { sortOrder: 'asc' as const } },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
};

@Injectable()
export class TopographyInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(
    role?: string | null,
    canAccessTopographyInventory?: boolean,
  ) {
    if (
      normalizeRole(role) !== 'topografia' ||
      canAccessTopographyInventory !== true
    ) {
      throw new ForbiddenException('Sem permissão para acessar o Inventário');
    }
  }

  async bootstrap(
    query: any,
    actorRole?: string | null,
    canAccessTopographyInventory?: boolean,
  ) {
    this.ensureAccess(actorRole, canAccessTopographyInventory);
    const company = parseCompany(query?.company);
    const { year, month } = parseReference(query?.year, query?.month);

    const [materials, inventory, previousInventory, history] =
      await Promise.all([
        this.prisma.topographyInventoryMaterial.findMany({
          where: { company, active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.topographyInventory.findUnique({
          where: {
            company_referenceYear_referenceMonth: {
              company,
              referenceYear: year,
              referenceMonth: month,
            },
          },
          include: inventoryInclude,
        }),
        this.prisma.topographyInventory.findFirst({
          where: {
            company,
            OR: [
              { referenceYear: { lt: year } },
              { referenceYear: year, referenceMonth: { lt: month } },
            ],
          },
          orderBy: [{ referenceYear: 'desc' }, { referenceMonth: 'desc' }],
          include: inventoryInclude,
        }),
        this.prisma.topographyInventory.findMany({
          where: { company },
          orderBy: [{ referenceYear: 'desc' }, { referenceMonth: 'desc' }],
          take: 12,
          include: inventoryInclude,
        }),
      ]);

    return {
      company,
      referenceYear: year,
      referenceMonth: month,
      materials: materials.map((material) => ({
        ...material,
        density: decimal(material.density),
      })),
      inventory: inventory ? this.serializeInventory(inventory) : null,
      previousInventory: previousInventory
        ? this.serializeInventory(previousInventory)
        : null,
      history: history.reverse().map((entry) => this.inventorySummary(entry)),
      dataQuality: {
        materialsWithoutDensity: materials
          .filter((material) => material.density === null)
          .map((material) => ({ id: material.id, name: material.name })),
      },
    };
  }

  async save(
    payload: InventoryPayload,
    actorRole?: string | null,
    actorId?: string | null,
    canAccessTopographyInventory?: boolean,
  ) {
    this.ensureAccess(actorRole, canAccessTopographyInventory);
    if (!actorId) {
      throw new BadRequestException('Usuário autenticado não encontrado');
    }

    const company = parseCompany(payload?.company);
    const { year, month } = parseReference(
      payload?.referenceYear,
      payload?.referenceMonth,
    );
    const measuredAt = parseMeasuredAt(payload?.measuredAt);
    if (!Array.isArray(payload?.items)) {
      throw new BadRequestException('Itens do inventário inválidos');
    }

    const materials = await this.prisma.topographyInventoryMaterial.findMany({
      where: { company, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const received = new Map<string, Prisma.Decimal>();

    for (const rawItem of payload.items as InventoryItemPayload[]) {
      const materialId = text(rawItem?.materialId);
      if (!materialById.has(materialId)) {
        throw new BadRequestException('Material inválido para a empresa selecionada');
      }
      if (received.has(materialId)) {
        throw new BadRequestException('Material repetido no inventário');
      }
      received.set(materialId, parseInventoryVolume(rawItem?.volumeM3));
    }

    if (received.size !== materials.length) {
      throw new BadRequestException('Preencha o volume de todos os materiais');
    }

    const calculatedItems = materials.map((material) => {
      const volumeM3 = received.get(material.id)!;
      return {
        materialId: material.id,
        volumeM3,
        densitySnapshot: material.density,
        tonnage: calculateInventoryTonnage(volumeM3, material.density),
      };
    });

    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.topographyInventory.findUnique({
        where: {
          company_referenceYear_referenceMonth: {
            company,
            referenceYear: year,
            referenceMonth: month,
          },
        },
        include: { items: true },
      });

      const inventory = await tx.topographyInventory.upsert({
        where: {
          company_referenceYear_referenceMonth: {
            company,
            referenceYear: year,
            referenceMonth: month,
          },
        },
        update: {
          measuredAt,
          updatedById: actorId,
          source: previous?.source === 'LEGACY_SPREADSHEET' ? 'SYSTEM' : previous?.source,
        },
        create: {
          company,
          referenceYear: year,
          referenceMonth: month,
          measuredAt,
          source: 'SYSTEM',
          createdById: actorId,
          updatedById: actorId,
        },
      });

      await tx.topographyInventoryItem.deleteMany({
        where: { inventoryId: inventory.id },
      });
      await tx.topographyInventoryItem.createMany({
        data: calculatedItems.map((item) => ({
          inventoryId: inventory.id,
          ...item,
        })),
      });

      await tx.topographyInventoryHistory.create({
        data: {
          inventoryId: inventory.id,
          actorId,
          action: previous ? 'UPDATED' : 'CREATED',
          snapshot: {
            before: previous
              ? {
                  measuredAt: previous.measuredAt.toISOString(),
                  items: previous.items.map((item) => ({
                    materialId: item.materialId,
                    volumeM3: decimal(item.volumeM3),
                    densitySnapshot: decimal(item.densitySnapshot),
                    tonnage: decimal(item.tonnage),
                  })),
                }
              : null,
            after: {
              company,
              referenceYear: year,
              referenceMonth: month,
              measuredAt: measuredAt.toISOString(),
              items: calculatedItems.map((item) => ({
                materialId: item.materialId,
                volumeM3: decimal(item.volumeM3),
                densitySnapshot: decimal(item.densitySnapshot),
                tonnage: decimal(item.tonnage),
              })),
            },
          } as Prisma.InputJsonValue,
        },
      });
    });

    return this.bootstrap(
      { company, year, month },
      actorRole,
      canAccessTopographyInventory,
    );
  }

  private serializeInventory(inventory: any) {
    const items = inventory.items.map((item: any) => ({
      id: item.id,
      materialId: item.materialId,
      volumeM3: decimal(item.volumeM3),
      densitySnapshot: decimal(item.densitySnapshot),
      tonnage: decimal(item.tonnage),
      material: {
        ...item.material,
        density: decimal(item.material?.density),
      },
    }));
    const totalVolumeM3 = items.reduce(
      (sum: number, item: any) => sum + (item.volumeM3 ?? 0),
      0,
    );
    const totalTonnage = items.reduce(
      (sum: number, item: any) => sum + (item.tonnage ?? 0),
      0,
    );

    return {
      ...inventory,
      items,
      totals: {
        volumeM3: Number(totalVolumeM3.toFixed(3)),
        tonnage: Number(totalTonnage.toFixed(3)),
      },
    };
  }

  private inventorySummary(inventory: any) {
    const serialized = this.serializeInventory(inventory);
    return {
      id: serialized.id,
      company: serialized.company,
      referenceYear: serialized.referenceYear,
      referenceMonth: serialized.referenceMonth,
      measuredAt: serialized.measuredAt,
      source: serialized.source,
      totals: serialized.totals,
    };
  }
}
