import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;

export const USINA_PHYSICAL_MATERIAL_FAMILIES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
  'PO_DE_PEDRA',
  'PEDRISCO',
  'BRITA_3_4',
  'OLEO_RESIVALE',
  'CAL_CH1',
  'DOP',
] as const;

export type UsinaPhysicalMaterialFamily =
  (typeof USINA_PHYSICAL_MATERIAL_FAMILIES)[number];

export const USINA_PHYSICAL_FAMILY_BY_AETHOS_ITEM: Record<
  number,
  UsinaPhysicalMaterialFamily
> = {
  1813: 'CAP_50_70',
  5525: 'CAP_BORRACHA',
  5643: 'CAP_POLIMERO',
  11734: 'CAP_POLIMERO',
  93: 'PO_DE_PEDRA',
  4953: 'PO_DE_PEDRA',
  9312: 'PO_DE_PEDRA',
  15496: 'PO_DE_PEDRA',
  15497: 'PO_DE_PEDRA',
  15498: 'PO_DE_PEDRA',
  15499: 'PO_DE_PEDRA',
  968: 'PO_DE_PEDRA',
  111: 'PEDRISCO',
  1465: 'BRITA_3_4',
  3024: 'OLEO_RESIVALE',
  2023: 'CAL_CH1',
  6796: 'DOP',
};

export interface UsinaPhysicalMovementInput {
  competence: Date;
  aethosItemId: number;
  movementType: 'ENTRY' | 'DIRECT_SALE';
  quantityTon: DecimalInput;
}

export interface UsinaPhysicalMovementCoverageInput {
  dataset: 'PHYSICAL_MATERIAL_MOVEMENTS';
  status?: string;
  scopeDateFrom: Date;
  scopeDateTo: Date;
}

export interface UsinaPhysicalInventoryInput {
  competence: string;
  items: Array<{
    aethosItemId: number | null;
    materialName: string;
    tonnage: DecimalInput | null;
  }>;
}

const decimal = (value: DecimalInput) => new Prisma.Decimal(value);
const fixed = (value: Prisma.Decimal) => value.toFixed(6);

function previousMonth(competence: string) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

function monthCovered(
  competence: string,
  coverage: UsinaPhysicalMovementCoverageInput[],
) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);
  return coverage.some(
    (run) =>
      run.dataset === 'PHYSICAL_MATERIAL_MOVEMENTS' &&
      (run.status === undefined || run.status === 'COMPLETED') &&
      run.scopeDateFrom.toISOString().slice(0, 10) <= competence &&
      run.scopeDateTo.toISOString().slice(0, 10) >= monthEnd,
  );
}

function inventoryFamily(item: UsinaPhysicalInventoryInput['items'][number]) {
  if (item.aethosItemId !== null) {
    const mapped = USINA_PHYSICAL_FAMILY_BY_AETHOS_ITEM[item.aethosItemId];
    if (mapped) return mapped;
  }
  const name = item.materialName.trim().toUpperCase();
  if (name.includes('BORRACHA')) return 'CAP_BORRACHA';
  if (name.includes('POLIM')) return 'CAP_POLIMERO';
  if (name.includes('50/70') || name.includes('50 70')) return 'CAP_50_70';
  if (name.includes('PO DE PEDRA') || name.includes('PÓ DE PEDRA'))
    return 'PO_DE_PEDRA';
  if (name.includes('PEDRISCO')) return 'PEDRISCO';
  if (name.includes('BRITA 3/4')) return 'BRITA_3_4';
  if (name.includes('RESIVALE')) return 'OLEO_RESIVALE';
  if (name.includes('CAL CH1') || name.includes('CAL CH-I')) return 'CAL_CH1';
  if (name === 'DOP' || name.includes(' DOP')) return 'DOP';
  return null;
}

export function calculateUsinaPhysicalMaterialConsumptionMonths(
  year: number,
  movements: UsinaPhysicalMovementInput[],
  coverage: UsinaPhysicalMovementCoverageInput[],
  inventories: UsinaPhysicalInventoryInput[],
) {
  const movementByMonth = new Map<
    string,
    Record<
      UsinaPhysicalMaterialFamily,
      {
        entryTon: Prisma.Decimal;
        directSaleTon: Prisma.Decimal;
        entryFactCount: number;
        directSaleFactCount: number;
      }
    >
  >();
  for (const movement of movements) {
    const family = USINA_PHYSICAL_FAMILY_BY_AETHOS_ITEM[movement.aethosItemId];
    if (!family) continue;
    const competence = movement.competence.toISOString().slice(0, 7) + '-01';
    const month =
      movementByMonth.get(competence) ||
      (Object.fromEntries(
        USINA_PHYSICAL_MATERIAL_FAMILIES.map((code) => [
          code,
          {
            entryTon: new Prisma.Decimal(0),
            directSaleTon: new Prisma.Decimal(0),
            entryFactCount: 0,
            directSaleFactCount: 0,
          },
        ]),
      ) as ReturnType<typeof movementByMonth.get> extends infer _T
        ? Record<
            UsinaPhysicalMaterialFamily,
            {
              entryTon: Prisma.Decimal;
              directSaleTon: Prisma.Decimal;
              entryFactCount: number;
              directSaleFactCount: number;
            }
          >
        : never);
    const target = month[family];
    if (movement.movementType === 'ENTRY') {
      target.entryTon = target.entryTon.plus(decimal(movement.quantityTon));
      target.entryFactCount += 1;
    } else {
      target.directSaleTon = target.directSaleTon.plus(
        decimal(movement.quantityTon),
      );
      target.directSaleFactCount += 1;
    }
    movementByMonth.set(competence, month);
  }

  const inventoryByMonth = new Map<
    string,
    Partial<Record<UsinaPhysicalMaterialFamily, Prisma.Decimal>>
  >();
  for (const inventory of inventories) {
    const values: Partial<Record<UsinaPhysicalMaterialFamily, Prisma.Decimal>> =
      {};
    for (const item of inventory.items) {
      const family = inventoryFamily(item);
      if (!family || item.tonnage === null) continue;
      values[family] = (values[family] || new Prisma.Decimal(0)).plus(
        decimal(item.tonnage),
      );
    }
    inventoryByMonth.set(inventory.competence, values);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const competence = new Date(Date.UTC(year, index, 1))
      .toISOString()
      .slice(0, 10);
    const physicalCovered = monthCovered(competence, coverage);
    const currentInventory = inventoryByMonth.get(competence) || {};
    const openingInventory =
      inventoryByMonth.get(previousMonth(competence)) || {};
    const monthMovement = movementByMonth.get(competence);
    const materials = {} as Record<
      UsinaPhysicalMaterialFamily,
      {
        openingTon: string | null;
        entryTon: string | null;
        closingTon: string | null;
        directSaleTon: string | null;
        consumptionTon: string | null;
        entryFactCount: number | null;
        directSaleFactCount: number | null;
        covered: boolean;
        issue: string | null;
      }
    >;
    for (const family of USINA_PHYSICAL_MATERIAL_FAMILIES) {
      const opening = openingInventory[family];
      const closing = currentInventory[family];
      const movement = monthMovement?.[family];
      let issue: string | null = null;
      if (!physicalCovered) issue = 'PHYSICAL_MOVEMENTS_NOT_COVERED';
      else if (opening === undefined) issue = 'OPENING_INVENTORY_NOT_AVAILABLE';
      else if (closing === undefined) issue = 'CLOSING_INVENTORY_NOT_AVAILABLE';
      const consumption =
        issue === null
          ? opening!
              .plus(movement?.entryTon || 0)
              .minus(closing!)
              .minus(movement?.directSaleTon || 0)
          : null;
      if (consumption?.isNegative()) issue = 'NEGATIVE_CALCULATED_CONSUMPTION';
      materials[family] = {
        openingTon: opening === undefined ? null : fixed(opening),
        entryTon: physicalCovered
          ? fixed(movement?.entryTon || new Prisma.Decimal(0))
          : null,
        closingTon: closing === undefined ? null : fixed(closing),
        directSaleTon: physicalCovered
          ? fixed(movement?.directSaleTon || new Prisma.Decimal(0))
          : null,
        consumptionTon:
          consumption === null || consumption.isNegative()
            ? null
            : fixed(consumption),
        entryFactCount: physicalCovered ? movement?.entryFactCount || 0 : null,
        directSaleFactCount: physicalCovered
          ? movement?.directSaleFactCount || 0
          : null,
        covered: physicalCovered,
        issue,
      };
    }
    return {
      competence,
      formula:
        'openingPhysicalStockTon + physicalEntriesTon - closingPhysicalStockTon - directMaterialSalesTon',
      source: 'PHYSICAL_MATERIAL_MOVEMENTS + TopographyInventory',
      covered: physicalCovered,
      materials,
    };
  });
}
