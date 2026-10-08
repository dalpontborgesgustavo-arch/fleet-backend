import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_COMPANIES = new Set(['USINA_JR', 'PEDRAFORTE']);

const CAP_LITER_DENSITY_BY_AETHOS_CODE: Record<string, string> = {
  '1813': '1.000',
  '5525': '1.010',
  '5643': '1.005',
  '11734': '1.005',
  '13861': '1.028',
};

type InventoryPayload = {
  company?: unknown;
  referenceYear?: unknown;
  referenceMonth?: unknown;
  measuredAt?: unknown;
  notes?: unknown;
  items?: unknown;
};

type InventoryItemPayload = {
  materialId?: unknown;
  volumeM3?: unknown;
  inputLiters?: unknown;
};

type AddMaterialPayload = {
  company?: unknown;
  aethosItemId?: unknown;
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
  if (!raw)
    throw new BadRequestException('Data e hora da medição são obrigatórias');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Data e hora da medição inválidas');
  }
  return parsed;
}

function parseInventoryNotes(value: unknown) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new BadRequestException('Observação inválida');
  }
  const notes = typeof value === 'string' ? value.trim() : '';
  if (notes.length > 2000) {
    throw new BadRequestException('Observação deve ter até 2.000 caracteres');
  }
  return notes || null;
}

export function parseInventoryVolume(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('Volume inválido');
    }
    return new Prisma.Decimal(value).toDecimalPlaces(3);
  }

  const raw = text(value).replace(/\s/g, '');
  if (!raw)
    throw new BadRequestException('Preencha o volume de todos os materiais');
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
  inputValue: Prisma.Decimal,
  density?: Prisma.Decimal | null,
  inputUnit = 'M3',
) {
  if (inputUnit === 'TON') {
    return inputValue.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  }
  if (inputUnit === 'LITER') {
    return density
      ? inputValue
          .mul(density)
          .div(1000)
          .toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP)
      : null;
  }
  return density
    ? inputValue.mul(density).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP)
    : null;
}

export function capLiterDensityForAethosCode(value?: unknown) {
  const density = CAP_LITER_DENSITY_BY_AETHOS_CODE[text(value)];
  return density ? new Prisma.Decimal(density) : null;
}

function decimal(value?: Prisma.Decimal | null) {
  return value === null || value === undefined ? null : Number(value);
}

export function mapAethosInventoryInputUnit(value?: unknown) {
  const unit = text(value).toUpperCase();
  if (unit === 'TN' || unit === 'TON' || unit === 'T') return 'TON';
  if (unit === 'M3' || unit === 'M³') return 'M3';
  return null;
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
    const competenceDate = new Date(Date.UTC(year, month - 1, 1));

    const [materials, inventory, previousInventory, history] =
      await Promise.all([
        this.prisma.topographyInventoryMaterial.findMany({
          where: {
            company,
            active: true,
            OR: [
              { availableFromCompetence: null },
              { availableFromCompetence: { lte: competenceDate } },
            ],
            AND: [
              {
                OR: [
                  { availableThroughCompetence: null },
                  { availableThroughCompetence: { gte: competenceDate } },
                ],
              },
            ],
          },
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
          .filter(
            (material) =>
              material.inputUnit === 'M3' && material.density === null,
          )
          .map((material) => ({ id: material.id, name: material.name })),
      },
    };
  }

  async searchActiveAethosItems(
    query: any,
    actorRole?: string | null,
    canAccessTopographyInventory?: boolean,
  ) {
    this.ensureAccess(actorRole, canAccessTopographyInventory);
    const company = parseCompany(query?.company);
    const search = text(query?.search);
    if (search.length < 2) return [];

    const [items, existingMaterials] = await Promise.all([
      this.prisma.aethosItem.findMany({
        where: {
          active: true,
          unit: { in: ['M3', 'M³', 'TN', 'TON', 'T'] },
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ description: 'asc' }, { code: 'asc' }],
        take: 30,
        select: {
          id: true,
          code: true,
          description: true,
          unit: true,
          active: true,
        },
      }),
      this.prisma.topographyInventoryMaterial.findMany({
        where: { company, aethosItemCode: { not: null } },
        select: { aethosItemCode: true },
      }),
    ]);
    const existingCodes = new Set(
      existingMaterials.map((material) => material.aethosItemCode),
    );

    return items.map((item) => ({
      ...item,
      inputUnit: mapAethosInventoryInputUnit(item.unit),
      alreadyAdded: existingCodes.has(item.code),
    }));
  }

  async addAethosMaterial(
    payload: AddMaterialPayload,
    actorRole?: string | null,
    canAccessTopographyInventory?: boolean,
  ) {
    this.ensureAccess(actorRole, canAccessTopographyInventory);
    const company = parseCompany(payload?.company);
    const aethosItemId = text(payload?.aethosItemId);
    if (!aethosItemId) {
      throw new BadRequestException('Selecione um item do Aethos');
    }

    const aethosItem = await this.prisma.aethosItem.findUnique({
      where: { id: aethosItemId },
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        active: true,
      },
    });
    if (!aethosItem || !aethosItem.active) {
      throw new BadRequestException(
        'O item selecionado não está ativo no Aethos',
      );
    }

    const aethosInputUnit = mapAethosInventoryInputUnit(aethosItem.unit);
    const capDensity = capLiterDensityForAethosCode(aethosItem.code);
    const inputUnit = aethosInputUnit;
    if (!inputUnit) {
      throw new BadRequestException(
        `A unidade ${aethosItem.unit || 'não informada'} não é compatível com o inventário em m³ ou toneladas`,
      );
    }

    const existing = await this.prisma.topographyInventoryMaterial.findFirst({
      where: { company, aethosItemCode: aethosItem.code },
    });
    if (existing) {
      throw new ConflictException(
        'Este item do Aethos já foi adicionado à empresa',
      );
    }

    const lastMaterial =
      await this.prisma.topographyInventoryMaterial.findFirst({
        where: { company },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
    const duplicateName =
      await this.prisma.topographyInventoryMaterial.findUnique({
        where: {
          company_name: { company, name: aethosItem.description.trim() },
        },
        select: { id: true },
      });
    const name = duplicateName
      ? `${aethosItem.description.trim()} (${aethosItem.code})`
      : aethosItem.description.trim();

    return this.prisma.topographyInventoryMaterial.create({
      data: {
        company,
        name,
        aethosItemCode: aethosItem.code,
        aethosDescription: aethosItem.description,
        density: capDensity,
        inputUnit,
        active: true,
        sortOrder: (lastMaterial?.sortOrder ?? 0) + 10,
      },
    });
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
    const competenceDate = new Date(Date.UTC(year, month - 1, 1));
    const measuredAt = parseMeasuredAt(payload?.measuredAt);
    const notes = payload?.notes === undefined
      ? undefined
      : parseInventoryNotes(payload.notes);
    if (!Array.isArray(payload?.items)) {
      throw new BadRequestException('Itens do inventário inválidos');
    }

    const materials = await this.prisma.topographyInventoryMaterial.findMany({
      where: {
        company,
        active: true,
        OR: [
          { availableFromCompetence: null },
          { availableFromCompetence: { lte: competenceDate } },
        ],
        AND: [
          {
            OR: [
              { availableThroughCompetence: null },
              { availableThroughCompetence: { gte: competenceDate } },
            ],
          },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const materialById = new Map(
      materials.map((material) => [material.id, material]),
    );
    const received = new Map<
      string,
      {
        inputValue: Prisma.Decimal;
        densitySnapshot: Prisma.Decimal | null;
        tonnage: Prisma.Decimal | null;
      }
    >();

    for (const rawItem of payload.items as InventoryItemPayload[]) {
      const materialId = text(rawItem?.materialId);
      if (!materialById.has(materialId)) {
        throw new BadRequestException(
          'Material inválido para a empresa selecionada',
        );
      }
      if (received.has(materialId)) {
        throw new BadRequestException('Material repetido no inventário');
      }
      const material = materialById.get(materialId)!;
      const capDensity = capLiterDensityForAethosCode(material.aethosItemCode);
      const hasLiterInput = text(rawItem?.inputLiters) !== '';
      if (hasLiterInput && !capDensity) {
        throw new BadRequestException(
          'Litros são permitidos somente para as famílias de CAP configuradas',
        );
      }
      if (hasLiterInput) {
        const liters = parseInventoryVolume(rawItem?.inputLiters);
        const tonnage = calculateInventoryTonnage(liters, capDensity, 'LITER')!;
        received.set(materialId, {
          inputValue: tonnage,
          densitySnapshot: capDensity,
          tonnage,
        });
      } else {
        const inputValue = parseInventoryVolume(rawItem?.volumeM3);
        received.set(materialId, {
          inputValue,
          densitySnapshot: material.density,
          tonnage: calculateInventoryTonnage(
            inputValue,
            material.density,
            material.inputUnit,
          ),
        });
      }
    }

    if (received.size !== materials.length) {
      throw new BadRequestException('Preencha o volume de todos os materiais');
    }

    const calculatedItems = materials.map((material) => {
      const receivedItem = received.get(material.id)!;
      return {
        materialId: material.id,
        volumeM3: receivedItem.inputValue,
        densitySnapshot: receivedItem.densitySnapshot,
        tonnage: receivedItem.tonnage,
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
          notes: notes === undefined ? previous?.notes ?? null : notes,
          updatedById: actorId,
          source: previous?.source?.startsWith('LEGACY_SPREADSHEET')
            ? 'SYSTEM'
            : previous?.source,
        },
        create: {
          company,
          referenceYear: year,
          referenceMonth: month,
          measuredAt,
          notes: notes ?? null,
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
                  notes: previous.notes,
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
              notes: notes === undefined ? previous?.notes ?? null : notes,
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
      (sum: number, item: any) =>
        sum + (item.material?.inputUnit === 'M3' ? (item.volumeM3 ?? 0) : 0),
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
