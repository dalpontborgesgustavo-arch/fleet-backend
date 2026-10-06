import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;

export interface UsinaMaterialCostFactInput {
  dataset: 'CAP_MOVEMENTS' | 'AGGREGATE_RECEIPTS';
  competence: Date;
  aethosMaterialId: number;
  movementType: 'ENTRY' | 'DIRECT_EXIT';
  quantityOriginal?: DecimalInput | null;
  quantityUnit?: string | null;
  quantityTon: DecimalInput | null;
  materialAmount: DecimalInput | null;
  freightAmount: DecimalInput | null;
}

export interface UsinaMaterialCoverageInput {
  dataset: 'CAP_MOVEMENTS' | 'AGGREGATE_RECEIPTS';
  generatedAt: Date;
  scopeDateFrom: Date;
  scopeDateTo: Date;
}

export interface UsinaBomConsumptionInput {
  competence: string;
  bomComplete: boolean;
  materialConsumptionTon: Record<string, string>;
}

export interface UsinaStonePowderFreightRateInput {
  competence: string;
  unitCostPerM3: DecimalInput;
}

export interface UsinaMaterialStockValuationInput {
  competence: string;
  aethosMaterialId: number;
  quantityUnit: string;
  closingAverageCost: DecimalInput | null;
}

const AGGREGATES = {
  111: 'PEDRISCO',
  968: 'PO_DE_PEDRA',
  1465: 'BRITA_3_4',
} as const;

type AggregateCode = (typeof AGGREGATES)[keyof typeof AGGREGATES];

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function fixed(value: Prisma.Decimal) {
  return value.toFixed(6);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

const SAO_PAULO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function civilDate(value: Date) {
  const parts = Object.fromEntries(
    SAO_PAULO.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthCovered(
  competence: string,
  coverage: UsinaMaterialCoverageInput[],
) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);
  return coverage.some((run) => {
    const generatedDate = civilDate(run.generatedAt);
    if (generatedDate < competence) return false;
    const requiredThrough = generatedDate < monthEnd ? generatedDate : monthEnd;
    return (
      run.dataset === 'AGGREGATE_RECEIPTS' &&
      dateKey(run.scopeDateFrom) <= competence &&
      dateKey(run.scopeDateTo) >= requiredThrough
    );
  });
}

interface MutablePrice {
  factCount: number;
  quantityTon: Prisma.Decimal;
  quantityOriginalByUnit: Map<string, Prisma.Decimal>;
  materialAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  materialComplete: boolean;
  freightComplete: boolean;
}

function emptyPrice(): MutablePrice {
  return {
    factCount: 0,
    quantityTon: new Prisma.Decimal(0),
    quantityOriginalByUnit: new Map(),
    materialAmount: new Prisma.Decimal(0),
    freightAmount: new Prisma.Decimal(0),
    materialComplete: true,
    freightComplete: true,
  };
}

function unitPrice(price: MutablePrice, kind: 'material' | 'freight') {
  if (price.factCount === 0 || price.quantityTon.lte(0)) return null;
  if (kind === 'material' && !price.materialComplete) return null;
  if (kind === 'freight' && !price.freightComplete) return null;
  const amount =
    kind === 'material' ? price.materialAmount : price.freightAmount;
  return amount.div(price.quantityTon);
}

function unitPriceByOriginalUnit(
  price: MutablePrice,
  kind: 'material' | 'freight',
  unit: string,
) {
  const quantity = price.quantityOriginalByUnit.get(unit);
  if (!quantity || quantity.lte(0)) return null;
  if (kind === 'material' && !price.materialComplete) return null;
  if (kind === 'freight' && !price.freightComplete) return null;
  const amount =
    kind === 'material' ? price.materialAmount : price.freightAmount;
  return amount.div(quantity);
}

export function calculateUsinaMaterialCostMonths(
  year: number,
  facts: UsinaMaterialCostFactInput[],
  coverage: UsinaMaterialCoverageInput[],
  bomMonths: UsinaBomConsumptionInput[],
  densities: Partial<Record<number, DecimalInput>> = {},
  stonePowderFreightRates: UsinaStonePowderFreightRateInput[] = [],
  stockValuations: UsinaMaterialStockValuationInput[] = [],
) {
  const pricesByMonth = new Map<string, Record<AggregateCode, MutablePrice>>();
  for (const fact of facts) {
    if (fact.dataset !== 'AGGREGATE_RECEIPTS' || fact.movementType !== 'ENTRY')
      continue;
    const code = AGGREGATES[fact.aethosMaterialId as keyof typeof AGGREGATES];
    if (!code) continue;
    const competence = fact.competence.toISOString().slice(0, 7) + '-01';
    const month = pricesByMonth.get(competence) || {
      PEDRISCO: emptyPrice(),
      PO_DE_PEDRA: emptyPrice(),
      BRITA_3_4: emptyPrice(),
    };
    const price = month[code];
    price.factCount += 1;
    const originalUnit = String(fact.quantityUnit || '').trim().toUpperCase();
    if (
      originalUnit &&
      fact.quantityOriginal !== null &&
      fact.quantityOriginal !== undefined
    ) {
      price.quantityOriginalByUnit.set(
        originalUnit,
        (price.quantityOriginalByUnit.get(originalUnit) ||
          new Prisma.Decimal(0)).plus(decimal(fact.quantityOriginal)),
      );
    }
    const derivedQuantityTon =
      fact.quantityTon !== null
        ? decimal(fact.quantityTon)
        : String(fact.quantityUnit || '').toUpperCase() === 'M3' &&
            fact.quantityOriginal !== null &&
            fact.quantityOriginal !== undefined &&
            densities[fact.aethosMaterialId] !== undefined
          ? decimal(fact.quantityOriginal).mul(
              decimal(densities[fact.aethosMaterialId]!),
            )
          : null;
    if (derivedQuantityTon === null) {
      price.materialComplete = false;
      price.freightComplete = false;
    } else {
      price.quantityTon = price.quantityTon.plus(derivedQuantityTon);
    }
    if (fact.materialAmount === null) price.materialComplete = false;
    else
      price.materialAmount = price.materialAmount.plus(
        decimal(fact.materialAmount),
      );
    if (fact.freightAmount === null) price.freightComplete = false;
    else
      price.freightAmount = price.freightAmount.plus(
        decimal(fact.freightAmount),
      );
    pricesByMonth.set(competence, month);
  }

  const bomByMonth = new Map(
    bomMonths.map((month) => [month.competence, month]),
  );
  const stonePowderFreightByMonth = new Map(
    stonePowderFreightRates.map((item) => [
      item.competence,
      decimal(item.unitCostPerM3),
    ]),
  );
  const stockValuationByMonthAndItem = new Map(
    stockValuations.map((item) => [
      `${item.competence}|${item.aethosMaterialId}`,
      item,
    ]),
  );
  return Array.from({ length: 12 }, (_, index) => {
    const competence = new Date(Date.UTC(year, index, 1))
      .toISOString()
      .slice(0, 10);
    const covered = monthCovered(competence, coverage);
    const monthPrices = pricesByMonth.get(competence) || {
      PEDRISCO: emptyPrice(),
      PO_DE_PEDRA: emptyPrice(),
      BRITA_3_4: emptyPrice(),
    };
    const bom = bomByMonth.get(competence);
    let materialCost: Prisma.Decimal | null = bom?.bomComplete
      ? new Prisma.Decimal(0)
      : null;
    const configuredStonePowderFreight =
      stonePowderFreightByMonth.get(competence);
    let freightCost: Prisma.Decimal | null =
      (covered || configuredStonePowderFreight !== undefined) &&
      bom?.bomComplete
        ? new Prisma.Decimal(0)
        : null;
    const prices = {} as Record<
      AggregateCode,
      {
        factCount: number;
        quantityTon: string | null;
        receivedQuantityOriginalByUnit: Record<string, string>;
        densityTonPerM3: string | null;
        materialUnitCost: string | null;
        materialUnitCostPerM3: string | null;
        receiptMaterialUnitCostPerM3: string | null;
        stockValuationUnitCostPerM3: string | null;
        materialSource: 'AETHOS_STOCK_VALUATION' | 'AETHOS_RECEIPT' | null;
        freightUnitCost: string | null;
        freightUnitCostPerM3: string | null;
        receiptFreightUnitCostPerM3: string | null;
        configuredFreightUnitCostPerM3: string | null;
        freightSource: 'MONTHLY_PARAMETER' | 'AETHOS_RECEIPT' | null;
        totalUnitCostPerM3: string | null;
      }
    >;
    const costsByMaterial = {} as Record<
      AggregateCode,
      {
        consumptionTon: string | null;
        materialCost: string | null;
        freightCost: string | null;
        totalCost: string | null;
      }
    >;
    for (const code of Object.values(AGGREGATES)) {
      const price = monthPrices[code];
      const receiptMaterialUnitCost = covered
        ? unitPrice(price, 'material')
        : null;
      const receiptFreightUnitCost = covered
        ? unitPrice(price, 'freight')
        : null;
      const receiptMaterialUnitCostPerM3 = covered
        ? unitPriceByOriginalUnit(price, 'material', 'M3')
        : null;
      const receiptFreightUnitCostPerM3 = covered
        ? unitPriceByOriginalUnit(price, 'freight', 'M3')
        : null;
      const powderDensity =
        code === 'PO_DE_PEDRA' && densities[968] !== undefined
          ? decimal(densities[968]!)
          : null;
      const stockValuation =
        code === 'PO_DE_PEDRA'
          ? stockValuationByMonthAndItem.get(`${competence}|968`)
          : undefined;
      const stockValuationUnitCostPerM3 =
        stockValuation?.quantityUnit.toUpperCase() === 'M3' &&
        stockValuation.closingAverageCost !== null
          ? decimal(stockValuation.closingAverageCost)
          : null;
      const stockValuationUnitCostPerTon =
        stockValuationUnitCostPerM3 !== null &&
        powderDensity !== null &&
        powderDensity.gt(0)
          ? stockValuationUnitCostPerM3.div(powderDensity)
          : null;
      const materialUnitCost =
        receiptMaterialUnitCost ??
        (code === 'PO_DE_PEDRA' ? stockValuationUnitCostPerTon : null);
      const materialUnitCostPerM3 =
        receiptMaterialUnitCostPerM3 ??
        (code === 'PO_DE_PEDRA' ? stockValuationUnitCostPerM3 : null);
      const configuredFreightUnitCost =
        code === 'PO_DE_PEDRA' &&
        configuredStonePowderFreight !== undefined &&
        powderDensity !== null &&
        powderDensity.gt(0)
          ? configuredStonePowderFreight.div(powderDensity)
          : null;
      // O documento real do Aethos e a fonte primaria. O parametro mensal de
      // po de pedra existe somente como fallback excepcional quando o mes nao
      // possui cobertura documental completa de frete.
      const freightUnitCost =
        receiptFreightUnitCost ??
        (code === 'PO_DE_PEDRA' ? configuredFreightUnitCost : null);
      const freightUnitCostPerM3 =
        receiptFreightUnitCostPerM3 ??
        (code === 'PO_DE_PEDRA' &&
        configuredStonePowderFreight !== undefined
          ? configuredStonePowderFreight
          : null);
      const aethosItemId = Number(
        Object.entries(AGGREGATES).find(
          ([, itemCode]) => itemCode === code,
        )?.[0],
      );
      const density =
        densities[aethosItemId] === undefined
          ? null
          : decimal(densities[aethosItemId]!);
      const totalUnitCostPerM3 =
        materialUnitCostPerM3 !== null && freightUnitCostPerM3 !== null
          ? materialUnitCostPerM3.plus(freightUnitCostPerM3)
          : null;
      prices[code] = {
        factCount: covered ? price.factCount : 0,
        quantityTon:
          covered && price.factCount ? fixed(price.quantityTon) : null,
        receivedQuantityOriginalByUnit: covered
          ? Object.fromEntries(
              [...price.quantityOriginalByUnit.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([unit, quantity]) => [unit, fixed(quantity)]),
            )
          : {},
        densityTonPerM3: density === null ? null : fixed(density),
        materialUnitCost: materialUnitCost ? fixed(materialUnitCost) : null,
        materialUnitCostPerM3:
          materialUnitCostPerM3 === null
            ? null
            : fixed(materialUnitCostPerM3),
        receiptMaterialUnitCostPerM3:
          receiptMaterialUnitCostPerM3 === null
            ? null
            : fixed(receiptMaterialUnitCostPerM3),
        stockValuationUnitCostPerM3:
          stockValuationUnitCostPerM3 === null
            ? null
            : fixed(stockValuationUnitCostPerM3),
        materialSource:
          receiptMaterialUnitCost !== null
            ? 'AETHOS_RECEIPT'
            : code === 'PO_DE_PEDRA' &&
                stockValuationUnitCostPerTon !== null
              ? 'AETHOS_STOCK_VALUATION'
              : null,
        freightUnitCost: freightUnitCost ? fixed(freightUnitCost) : null,
        freightUnitCostPerM3:
          freightUnitCostPerM3 === null
            ? null
            : fixed(freightUnitCostPerM3),
        receiptFreightUnitCostPerM3:
          receiptFreightUnitCostPerM3 === null
            ? null
            : fixed(receiptFreightUnitCostPerM3),
        configuredFreightUnitCostPerM3:
          code === 'PO_DE_PEDRA' && configuredStonePowderFreight !== undefined
            ? fixed(configuredStonePowderFreight)
            : null,
        freightSource:
          receiptFreightUnitCost !== null
            ? 'AETHOS_RECEIPT'
            : code === 'PO_DE_PEDRA' &&
                configuredStonePowderFreight !== undefined
              ? 'MONTHLY_PARAMETER'
              : null,
        totalUnitCostPerM3:
          totalUnitCostPerM3 === null ? null : fixed(totalUnitCostPerM3),
      };
      const consumption = decimal(bom?.materialConsumptionTon[code] || 0);
      const materialComponentCost =
        materialCost === null
          ? null
          : consumption.isZero()
            ? new Prisma.Decimal(0)
            : materialUnitCost === null
              ? null
              : consumption.mul(materialUnitCost);
      const freightComponentCost =
        freightCost === null
          ? null
          : consumption.isZero()
            ? new Prisma.Decimal(0)
            : freightUnitCost === null
              ? null
              : consumption.mul(freightUnitCost);
      costsByMaterial[code] = {
        consumptionTon: bom?.bomComplete ? fixed(consumption) : null,
        materialCost:
          materialComponentCost === null ? null : fixed(materialComponentCost),
        freightCost:
          freightComponentCost === null ? null : fixed(freightComponentCost),
        totalCost:
          materialComponentCost === null || freightComponentCost === null
            ? null
            : fixed(materialComponentCost.plus(freightComponentCost)),
      };
      if (materialCost !== null) {
        materialCost =
          materialComponentCost === null
            ? null
            : materialCost.plus(materialComponentCost);
      }
      if (freightCost !== null) {
        freightCost =
          freightComponentCost === null
            ? null
            : freightCost.plus(freightComponentCost);
      }
    }
    return {
      competence,
      covered,
      stockValuationCovered: stockValuationByMonthAndItem.has(
        `${competence}|968`,
      ),
      prices,
      costsByMaterial,
      costs: {
        BRITADOS: materialCost === null ? null : fixed(materialCost),
        FRETE_BRITADOS: freightCost === null ? null : fixed(freightCost),
      },
    };
  });
}
