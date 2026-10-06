import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  USINA_FORECAST_CONTEXT,
  canAccessUsinaForecasts,
} from '../usina-forecasts/usina-forecasts.service';
import {
  calculateUsinaProductionMonths,
  calculateUsinaRevenueMonths,
} from './usina-monthly-result.calculator';
import {
  calculateSalesTaxOnExternalRevenue,
  calculateUsinaFinancialMonths,
} from './usina-monthly-financial.calculator';
import { calculateUsinaMaterialCostMonths } from './usina-monthly-material-cost.calculator';
import { calculateUsinaOperationalCostMonths } from './usina-monthly-operational-cost.calculator';
import { calculateUsinaCapCostMonths } from './usina-monthly-cap-cost.calculator';
import { calculateUsinaMonthlyIndicators } from './usina-monthly-indicator.calculator';
import {
  calculateUsinaMonthlyComparison,
  calculateUsinaMonthlyComparisonSummary,
} from './usina-monthly-comparison.calculator';
import { UsinaBomMissingAlertService } from './usina-bom-missing-alert.service';
import {
  classifyUsinaVehicleExpense,
  USINA_MAINTENANCE_AETHOS_VEHICLE_IDS,
} from '../common/usina-maintenance-classification';
import {
  calculateUsinaPhysicalMaterialConsumptionMonths,
  UsinaPhysicalMaterialFamily,
} from './usina-physical-material-consumption.calculator';
import {
  buildMaintenanceCumulativeBase,
  maintenanceCumulativeQueryStart,
} from './usina-maintenance-cumulative';

function parseYear(value: unknown) {
  const year = Number(value ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2025 || year > 2100) {
    throw new BadRequestException('Ano deve estar entre 2025 e 2100');
  }
  return year;
}

function value(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

const CAP_CLASS_BY_AETHOS_ITEM: Record<number, string> = {
  1813: 'CAP_50_70',
  5525: 'CAP_BORRACHA',
  5643: 'CAP_POLIMERO',
  11734: 'CAP_POLIMERO',
  13861: 'CAP_ALTO_MODULO',
};

const OPERATIONAL_PRICE_FAMILY_BY_AETHOS_ITEM = {
  3024: 'OLEO_RESIVALE',
  6796: 'DOP',
} as const;

type OperationalPriceFamily =
  (typeof OPERATIONAL_PRICE_FAMILY_BY_AETHOS_ITEM)[keyof typeof OPERATIONAL_PRICE_FAMILY_BY_AETHOS_ITEM];

type ManagerialUnitPriceFact = {
  competence: Date;
  aethosItemId: number;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  totalValue: Prisma.Decimal;
};

function managerialQuantityTon(
  quantity: Prisma.Decimal | null,
  unit: string | null,
) {
  if (quantity === null || quantity.lte(0)) return null;
  const normalizedUnit = (unit || '').trim().toUpperCase();
  if (['TN', 'T', 'TON', 'TONELADA', 'TONELADAS'].includes(normalizedUnit)) {
    return quantity;
  }
  if (['KG', 'KGS', 'QUILOGRAMA', 'QUILOGRAMAS'].includes(normalizedUnit)) {
    return quantity.div(1000);
  }
  return null;
}

export function buildManagerialOperationalUnitPrices(
  year: number,
  facts: ManagerialUnitPriceFact[],
) {
  const monthly = new Map<
    string,
    Partial<Record<OperationalPriceFamily, string>>
  >();
  const accumulator = new Map<
    string,
    { quantityTon: Prisma.Decimal; amount: Prisma.Decimal; complete: boolean }
  >();

  for (const fact of facts) {
    const family =
      OPERATIONAL_PRICE_FAMILY_BY_AETHOS_ITEM[
        fact.aethosItemId as keyof typeof OPERATIONAL_PRICE_FAMILY_BY_AETHOS_ITEM
      ];
    if (!family) continue;
    const competence = fact.competence.toISOString().slice(0, 10);
    const key = `${competence}|${family}`;
    const current = accumulator.get(key) || {
      quantityTon: new Prisma.Decimal(0),
      amount: new Prisma.Decimal(0),
      complete: true,
    };
    const quantityTon = managerialQuantityTon(fact.quantity, fact.unit);
    if (quantityTon === null || fact.totalValue.lt(0)) {
      current.complete = false;
    } else {
      current.quantityTon = current.quantityTon.plus(quantityTon);
      current.amount = current.amount.plus(fact.totalValue);
    }
    accumulator.set(key, current);
  }

  const lastAvailable: Partial<Record<OperationalPriceFamily, string>> = {};
  for (let cursorYear = 2025; cursorYear <= year; cursorYear += 1) {
    for (let month = 0; month < 12; month += 1) {
      const competence = `${cursorYear}-${String(month + 1).padStart(2, '0')}-01`;
      for (const family of ['OLEO_RESIVALE', 'DOP'] as const) {
        const price = accumulator.get(`${competence}|${family}`);
        if (price?.complete && price.quantityTon.gt(0)) {
          lastAvailable[family] = price.amount
            .div(price.quantityTon)
            .toFixed(6);
        }
      }
      if (cursorYear === year) {
        monthly.set(competence, { ...lastAvailable });
      }
    }
  }
  return monthly;
}

export function carryForwardOperationalUnitPrices(
  year: number,
  monthly: Map<
    string,
    Partial<Record<UsinaPhysicalMaterialFamily, string | null>>
  >,
  firstYear = 2025,
) {
  const lastAvailable: Partial<Record<UsinaPhysicalMaterialFamily, string>> =
    {};
  for (let cursorYear = firstYear; cursorYear <= year; cursorYear += 1) {
    for (let month = 0; month < 12; month += 1) {
      const competence = `${cursorYear}-${String(month + 1).padStart(2, '0')}-01`;
      const current = monthly.get(competence) || {};
      for (const family of ['OLEO_RESIVALE', 'CAL_CH1', 'DOP'] as const) {
        const currentPrice = current[family];
        if (currentPrice !== null && currentPrice !== undefined) {
          lastAvailable[family] = currentPrice;
        } else {
          current[family] = lastAvailable[family] ?? null;
        }
      }
      monthly.set(competence, current);
    }
  }
  return monthly;
}

function multipliedCost(consumption: string | null, unitCost: string | null) {
  if (consumption === null || unitCost === null) return null;
  return new Prisma.Decimal(consumption)
    .mul(new Prisma.Decimal(unitCost))
    .toFixed(6);
}

function strictSum(values: Array<string | null>) {
  if (values.some((entry) => entry === null)) return null;
  return values
    .reduce(
      (sum, entry) => sum.plus(new Prisma.Decimal(entry!)),
      new Prisma.Decimal(0),
    )
    .toFixed(6);
}

const PHYSICAL_CAP_PURCHASE_CLASSES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
] as const;

export function applyPhysicalCapConsumption(
  capCost: any,
  physical: any,
  physicalPurchaseDocuments: Array<Record<string, unknown>> = [],
) {
  if (!capCost || !physical) return capCost;
  const purchases = {
    ...capCost.purchases,
    documentaryQuantityTon: capCost.purchases?.quantityTon ?? null,
    quantitySource: 'PHYSICAL_MATERIAL_MOVEMENTS',
    byMaterial: { ...capCost.purchases?.byMaterial },
  };
  for (const family of PHYSICAL_CAP_PURCHASE_CLASSES) {
    const balance = physical.materials[family];
    const documented = capCost.purchases?.byMaterial?.[family] || {};
    purchases.byMaterial[family] = {
      ...documented,
      quantityTon: balance?.covered ? balance.entryTon : null,
      documentaryQuantityTon: documented.quantityTon ?? null,
      quantitySource: 'PHYSICAL_MATERIAL_MOVEMENTS',
      documentaryQuantitySource: 'CAP_PURCHASE_ORDERS',
      quantityCovered: Boolean(balance?.covered),
      quantityFactCount: balance?.covered
        ? (balance.entryFactCount ?? 0)
        : null,
    };
  }
  purchases.quantityTon = strictSum([
    ...PHYSICAL_CAP_PURCHASE_CLASSES.map(
      (family) => purchases.byMaterial[family]?.quantityTon ?? null,
    ),
    purchases.byMaterial.CAP_ALTO_MODULO?.quantityTon ?? null,
  ]);
  const next = {
    ...capCost,
    materials: { ...capCost.materials },
    costs: { ...capCost.costs },
    purchases,
    physicalConsumption: physical,
    physicalPurchaseCovered: Boolean(physical.covered),
    physicalPurchaseQuantityEvidence: {
      dataset: 'PHYSICAL_MATERIAL_MOVEMENTS',
      covered: Boolean(physical.covered),
      formula: 'SUM(quantityTon)',
      competenceBasis: 'VW_LST_PESAGEM.DT_PRI_PESAGEM',
      canonicalKey: 'ID_PESAGEM|ID_ITEM',
      unit: 'TN',
      filters: [
        'movementType = ENTRY',
        "PESAGEM.FL_ORIGEM = 'PRO'",
        'PESAGEM e PESAGEM_VEICULO finalizadas',
        'peso positivo',
        'tara nula ou nao positiva',
        'menor etapa final elegivel',
      ],
      documents: physicalPurchaseDocuments,
    },
  };
  for (const family of ['CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO'] as const) {
    const balance = physical.materials[family];
    const previous = capCost.materials[family];
    const unitCost =
      previous?.unitCost ??
      capCost.purchases?.byMaterial?.[family]?.unitCost ??
      null;
    const hasZeroConsumption =
      balance.issue === null &&
      balance.consumptionTon !== null &&
      new Prisma.Decimal(balance.consumptionTon).isZero();
    const issue =
      balance.issue ??
      (!hasZeroConsumption && unitCost === null
        ? 'UNIT_COST_NOT_AVAILABLE'
        : null);
    const cost =
      issue !== null
        ? null
        : hasZeroConsumption
          ? '0.000000'
          : multipliedCost(balance.consumptionTon, unitCost);
    next.materials[family] = {
      ...previous,
      openingTon: balance.openingTon,
      entryTon: balance.entryTon,
      closingTon: balance.closingTon,
      directExitTon: balance.directSaleTon,
      consumedTon: balance.consumptionTon,
      unitCost,
      cost: issue === null ? cost : null,
      issue,
      quantitySource: 'PHYSICAL_MATERIAL_MOVEMENTS',
      inventorySource: 'TopographyInventory',
      entryFactCount: balance.entryFactCount,
      directSaleFactCount: balance.directSaleFactCount,
    };
    next.costs[family] = issue === null ? cost : null;
  }
  return next;
}

function applyPhysicalAggregateConsumption(materialCost: any, physical: any) {
  if (!materialCost || !physical) return materialCost;
  const next = {
    ...materialCost,
    costsByMaterial: { ...materialCost.costsByMaterial },
    costs: { ...materialCost.costs },
    physicalConsumption: physical,
  };
  const codes = ['PO_DE_PEDRA', 'PEDRISCO', 'BRITA_3_4'] as const;
  for (const code of codes) {
    const balance = physical.materials[code];
    const prices = materialCost.prices[code];
    const materialComponent =
      balance.issue === null
        ? multipliedCost(balance.consumptionTon, prices.materialUnitCost)
        : null;
    const freightComponent =
      balance.issue === null
        ? multipliedCost(balance.consumptionTon, prices.freightUnitCost)
        : null;
    next.costsByMaterial[code] = {
      ...materialCost.costsByMaterial[code],
      consumptionTon: balance.consumptionTon,
      materialCost: materialComponent,
      freightCost: freightComponent,
      totalCost:
        materialComponent === null || freightComponent === null
          ? null
          : new Prisma.Decimal(materialComponent)
              .plus(freightComponent)
              .toFixed(6),
      openingTon: balance.openingTon,
      entryTon: balance.entryTon,
      closingTon: balance.closingTon,
      directSaleTon: balance.directSaleTon,
      issue:
        balance.issue ??
        (prices.materialUnitCost === null
          ? 'UNIT_COST_NOT_AVAILABLE'
          : prices.freightUnitCost === null
            ? 'FREIGHT_UNIT_COST_NOT_AVAILABLE'
            : null),
      quantitySource: 'PHYSICAL_MATERIAL_MOVEMENTS',
      inventorySource: 'TopographyInventory',
      entryFactCount: balance.entryFactCount,
      directSaleFactCount: balance.directSaleFactCount,
    };
  }
  next.costs.BRITADOS = strictSum(
    codes.map((code) => next.costsByMaterial[code].materialCost),
  );
  // O frete e calculado uma unica vez, como componente separado do material.
  next.costs.FRETE_BRITADOS = strictSum(
    codes.map((code) => next.costsByMaterial[code].freightCost),
  );
  return next;
}

function applyPhysicalOperationalConsumption(
  operationalCost: any,
  physical: any,
  unitPrices: Partial<Record<UsinaPhysicalMaterialFamily, string | null>>,
) {
  if (!operationalCost || !physical) return operationalCost;
  const next = {
    ...operationalCost,
    costs: { ...operationalCost.costs },
    physicalMaterials: {} as Record<string, unknown>,
  };
  for (const family of ['OLEO_RESIVALE', 'CAL_CH1', 'DOP'] as const) {
    const balance = physical.materials[family];
    const unitCost = unitPrices[family] ?? null;
    const cost =
      balance.issue === null
        ? multipliedCost(balance.consumptionTon, unitCost)
        : null;
    const issue =
      balance.issue ?? (unitCost === null ? 'UNIT_COST_NOT_AVAILABLE' : null);
    next.costs[family] = issue === null ? cost : null;
    next.physicalMaterials[family] = {
      ...balance,
      unitCost,
      cost: issue === null ? cost : null,
      issue,
      quantitySource: 'PHYSICAL_MATERIAL_MOVEMENTS',
      inventorySource: 'TopographyInventory',
    };
  }
  return next;
}

@Injectable()
export class UsinaMonthlyResultService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly bomMissingAlertService?: UsinaBomMissingAlertService,
  ) {}

  async findAnnual(yearValue: unknown, actorRole?: string | null) {
    if (!canAccessUsinaForecasts(actorRole)) {
      throw new ForbiddenException(
        'Sem permissão para acessar o resultado mensal da Usina',
      );
    }
    const year = parseYear(yearValue);
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYear = new Date(Date.UTC(year + 1, 0, 1));
    const inventoryStart = new Date(Date.UTC(year - 1, 11, 1));
    const cumulativeQueryStart = maintenanceCumulativeQueryStart(year);

    const [
      facts,
      revenueFacts,
      materialFacts,
      materialExceptions,
      operationalFacts,
      managerialUnitPriceFacts,
      capInventories,
      aggregateMaterials,
      structures,
      forecasts,
      costConfigs,
      depreciation,
      targets,
      stonePowderFreights,
      stockValuations,
      physicalMaterialMovements,
      fleetLaborAllocations,
      fleetLaborDatasetActivation,
      completedRuns,
    ] = await Promise.all([
      this.prisma.usinaProductionFact.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: cumulativeQueryStart, lt: nextYear },
          active: true,
        },
        select: {
          aethosProductId: true,
          productDescription: true,
          classification: true,
          occurredAt: true,
          competence: true,
          quantityTon: true,
        },
      }),
      this.prisma.usinaRevenueFact.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
        },
        select: {
          revenueType: true,
          classification: true,
          competence: true,
          sourceRecordId: true,
          sourceOrderId: true,
          sourceDocumentId: true,
          sourceLineId: true,
          aethosProductId: true,
          productDescription: true,
          quantityOriginal: true,
          quantityUnit: true,
          quantityTon: true,
          amount: true,
          freightAmount: true,
          orderFreightAmount: true,
        },
      }),
      this.prisma.usinaMaterialReceiptFact.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
        },
        select: {
          dataset: true,
          competence: true,
          sourceRecordId: true,
          sourceDocumentId: true,
          sourceLineId: true,
          aethosMaterialId: true,
          materialDescription: true,
          materialClass: true,
          reportingFamily: true,
          movementType: true,
          occurredDate: true,
          quantityOriginal: true,
          quantityUnit: true,
          quantityTon: true,
          materialUnitCost: true,
          materialAmount: true,
          totalAmount: true,
          freightAmount: true,
          sourceUsedQuantity: true,
          sourceBalanceQuantity: true,
          sourceDiscountAmount: true,
          aethosCompanyId: true,
          supplierId: true,
          sourceStatus: true,
        },
      }),
      this.prisma.usinaMaterialReceiptException.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
        },
        orderBy: [{ occurredAt: 'asc' }, { sourceRecordId: 'asc' }],
        select: {
          sourceRecordId: true,
          sourceTicketId: true,
          occurredAt: true,
          finalizedAt: true,
          competence: true,
          plate: true,
          sourcePartyName: true,
          aethosItemId: true,
          itemDescription: true,
          materialClass: true,
          quantityOriginal: true,
          quantityUnit: true,
          sourceDirection: true,
          reasonCode: true,
          reason: true,
          correlatedEntryId: true,
          correlatedEntryItemId: true,
          correlatedFreightTypeId: true,
          correlatedEntryQuantityOriginal: true,
          correlatedEntryQuantityUnit: true,
        },
      }),
      this.prisma.usinaOperationalCostFact.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: cumulativeQueryStart, lt: nextYear },
          active: true,
        },
        select: {
          dataset: true,
          competence: true,
          costClass: true,
          amount: true,
          quantity: true,
          aethosVehicleId: true,
          fleetNumber: true,
          sourceRecordId: true,
          sourceDocumentId: true,
          sourceDocumentType: true,
          accountPlanId: true,
          accountPlanDescription: true,
          internalConsumptionId: true,
          internalConsumptionItemId: true,
          materialEntryId: true,
          materialEntryItemId: true,
          sourceNoteNumber: true,
          receivedDate: true,
          aethosItemId: true,
          itemDescription: true,
          itemCategoryId: true,
          itemCategoryDescription: true,
          occurredDate: true,
          quantityUnit: true,
          quantityOriginal: true,
          quantityOriginalUnit: true,
          quantityTon: true,
          unitPriceOriginal: true,
          unitPriceTon: true,
          sourceItemTotal: true,
          quantityNormalizationBasis: true,
          priceNormalizationBasis: true,
          competenceBasis: true,
          selectionBasis: true,
          sourceStatus: true,
        },
      }),
      this.prisma.costPurchaseManagerialEntryFact.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: 'AETHOS_ID_EMPRESA_1',
          competence: {
            gte: new Date(Date.UTC(2025, 0, 1)),
            lt: nextYear,
          },
          aethosItemId: { in: [3024, 6796] },
          sourceStatus: 'F',
          active: true,
        },
        select: {
          competence: true,
          aethosItemId: true,
          unit: true,
          quantity: true,
          totalValue: true,
        },
      }),
      this.prisma.topographyInventory.findMany({
        where: {
          company: 'USINA_JR',
          OR: [
            { referenceYear: year - 1, referenceMonth: 12 },
            { referenceYear: year },
          ],
        },
        orderBy: [{ referenceYear: 'asc' }, { referenceMonth: 'asc' }],
        select: {
          id: true,
          referenceYear: true,
          referenceMonth: true,
          measuredAt: true,
          source: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          history: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              action: true,
              createdAt: true,
              actor: { select: { id: true, name: true } },
            },
          },
          items: {
            select: {
              id: true,
              tonnage: true,
              material: {
                select: { id: true, aethosItemCode: true, name: true },
              },
            },
          },
        },
      }),
      this.prisma.topographyInventoryMaterial.findMany({
        where: {
          company: 'USINA_JR',
          active: true,
          aethosItemCode: { in: ['111', '968', '1465'] },
          density: { not: null },
        },
        select: { aethosItemCode: true, density: true },
      }),
      this.prisma.usinaBomStructure.findMany({
        where: {
          deletedAt: null,
          OR: [
            {
              companyId: USINA_FORECAST_CONTEXT.companyId,
              unitId: USINA_FORECAST_CONTEXT.unitId,
            },
            { companyId: null, unitId: null },
          ],
        },
        select: {
          aethosProductId: true,
          companyId: true,
          unitId: true,
          deletedAt: true,
          versions: {
            where: { deletedAt: null, validFrom: { lt: nextYear } },
            select: {
              version: true,
              traceName: true,
              validFrom: true,
              validTo: true,
              deletedAt: true,
              components: {
                where: { deletedAt: null },
                select: {
                  aethosMaterialId: true,
                  consumptionPercent: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.usinaForecast.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
        },
        select: {
          competence: true,
          materialCode: true,
          indicatorCode: true,
          forecastValue: true,
        },
      }),
      this.prisma.usinaMonthlyCostConfig.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          status: 'CONFIRMED',
          isCurrent: true,
          deletedAt: null,
        },
        select: {
          competence: true,
          version: true,
          taxRate: true,
          equipment: {
            where: { deletedAt: null },
            select: { equipmentType: true, aethosVehicleId: true },
          },
        },
      }),
      this.prisma.usinaAnnualDepreciation.findFirst({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          exercise: year,
          status: 'CONFIRMED',
          isCurrent: true,
          deletedAt: null,
        },
        select: { version: true, annualValue: true, monthlyValue: true },
      }),
      this.prisma.usinaMonthlyResultTarget.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          status: 'CONFIRMED',
          isCurrent: true,
          deletedAt: null,
        },
        select: { competence: true, version: true, targetRate: true },
      }),
      this.prisma.usinaMonthlyStonePowderFreight.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          status: 'CONFIRMED',
          isCurrent: true,
          deletedAt: null,
        },
        select: { competence: true, version: true, unitCostPerM3: true },
      }),
      this.prisma.usinaMaterialStockValuation.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: inventoryStart, lt: nextYear },
          active: true,
          lastSeenRun: { status: 'COMPLETED' },
        },
        select: {
          competence: true,
          aethosItemId: true,
          quantityUnit: true,
          closingQuantity: true,
          closingAverageCost: true,
        },
      }),
      this.prisma.usinaPhysicalMaterialMovement.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
          lastSeenRun: { status: 'COMPLETED' },
        },
        orderBy: [
          { competence: 'asc' },
          { occurredAt: 'asc' },
          { sourceRecordId: 'asc' },
        ],
        select: {
          sourceRecordId: true,
          competence: true,
          aethosItemId: true,
          movementType: true,
          occurredAt: true,
          quantityOriginal: true,
          quantityUnit: true,
          densityTonPerM3: true,
          quantityTon: true,
          sourceWeighingId: true,
          sourceItemId: true,
        },
      }),
      this.prisma.usinaFleetMaintenanceLaborAllocation.findMany({
        where: {
          companyId: USINA_FORECAST_CONTEXT.companyId,
          unitId: USINA_FORECAST_CONTEXT.unitId,
          competence: { gte: yearStart, lt: nextYear },
          active: true,
          lastSeenRun: { status: 'COMPLETED' },
        },
        orderBy: [
          { competence: 'asc' },
          { targetCostClass: 'asc' },
          { fleetNumber: 'asc' },
        ],
        select: {
          sourceRecordId: true,
          competence: true,
          aethosVehicleId: true,
          fleetNumber: true,
          targetCostClass: true,
          vehicleExpenseAmount: true,
          rateGroup: true,
          groupShare: true,
          groupExpenseBase: true,
          eligibleLaborPoolAmount: true,
          allocatedLaborAmount: true,
          expectedLineAmount: true,
          sourceSentence: true,
          sourceGeneratedAt: true,
        },
      }),
      this.prisma.usinaSyncRun.findFirst({
        where: {
          dataset: 'FLEET_MAINTENANCE_LABOR_ALLOCATIONS',
          status: 'COMPLETED',
        },
        select: { id: true },
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          dataset: {
            in: [
              'PRODUCTION',
              'INTERNAL_REVENUE',
              'EXTERNAL_REVENUE',
              'CAP_MOVEMENTS',
              'CAP_PURCHASE_ORDERS',
              'AGGREGATE_RECEIPTS',
              'VEHICLE_EXPENSES',
              'PAYABLE_EXPENSES',
              'LABOR_COSTS',
              'INTERNAL_CONSUMPTION_EXPENSES',
              'MATERIAL_PURCHASE_EXPENSES',
              'MATERIAL_STOCK_VALUATIONS',
              'PHYSICAL_MATERIAL_MOVEMENTS',
              'FLEET_MAINTENANCE_LABOR_ALLOCATIONS',
            ],
          },
          status: 'COMPLETED',
          scopeDateTo: { gte: yearStart },
          scopeDateFrom: { lt: nextYear },
        },
        orderBy: { completedAt: 'desc' },
        select: {
          dataset: true,
          syncRunId: true,
          syncMode: true,
          generatedAt: true,
          scopeDateFrom: true,
          scopeDateTo: true,
          completedAt: true,
        },
      }),
    ]);

    const productionMonths = calculateUsinaProductionMonths(
      facts,
      structures,
      USINA_FORECAST_CONTEXT.companyId,
      USINA_FORECAST_CONTEXT.unitId,
    );
    const productionByCompetence = new Map(
      productionMonths.map((month) => [month.competence, month]),
    );
    const revenueMonths = calculateUsinaRevenueMonths(
      year,
      revenueFacts.map((fact) => ({
        ...fact,
        revenueType: fact.revenueType as 'INTERNAL' | 'EXTERNAL',
      })),
      completedRuns
        .filter(
          (run) =>
            run.dataset === 'INTERNAL_REVENUE' ||
            run.dataset === 'EXTERNAL_REVENUE',
        )
        .map((run) => ({
          dataset: run.dataset as 'INTERNAL_REVENUE' | 'EXTERNAL_REVENUE',
          generatedAt: run.generatedAt,
          scopeDateFrom: run.scopeDateFrom,
          scopeDateTo: run.scopeDateTo,
        })),
    );
    const revenueByCompetence = new Map(
      revenueMonths.map((month) => [month.competence, month]),
    );
    const revenueDocumentsByCompetence = new Map<
      string,
      {
        INTERNAL: Array<{
          sourceRecordId: string;
          sourceOrderId: string | null;
          sourceDocumentId: string;
          sourceLineId: string | null;
          aethosProductId: number;
          productDescription: string;
          amount: string;
        }>;
        EXTERNAL: Array<{
          sourceRecordId: string;
          sourceOrderId: string | null;
          sourceDocumentId: string;
          sourceLineId: string | null;
          aethosProductId: number;
          productDescription: string;
          amount: string;
        }>;
      }
    >();
    for (const fact of revenueFacts) {
      const competence = fact.competence.toISOString().slice(0, 10);
      const bucket = revenueDocumentsByCompetence.get(competence) || {
        INTERNAL: [],
        EXTERNAL: [],
      };
      const revenueType = fact.revenueType as 'INTERNAL' | 'EXTERNAL';
      bucket[revenueType].push({
        sourceRecordId: fact.sourceRecordId,
        sourceOrderId: fact.sourceOrderId,
        sourceDocumentId: fact.sourceDocumentId,
        sourceLineId: fact.sourceLineId,
        aethosProductId: fact.aethosProductId,
        productDescription: fact.productDescription,
        amount: fact.amount.toFixed(6),
      });
      revenueDocumentsByCompetence.set(competence, bucket);
    }
    const materialCostMonths = calculateUsinaMaterialCostMonths(
      year,
      materialFacts.map((fact) => ({
        ...fact,
        dataset: fact.dataset as 'CAP_MOVEMENTS' | 'AGGREGATE_RECEIPTS',
        movementType: fact.movementType as 'ENTRY' | 'DIRECT_EXIT',
      })),
      completedRuns
        .filter(
          (run) =>
            run.dataset === 'CAP_MOVEMENTS' ||
            run.dataset === 'AGGREGATE_RECEIPTS',
        )
        .map((run) => ({
          dataset: run.dataset as 'CAP_MOVEMENTS' | 'AGGREGATE_RECEIPTS',
          generatedAt: run.generatedAt,
          scopeDateFrom: run.scopeDateFrom,
          scopeDateTo: run.scopeDateTo,
        })),
      productionMonths.map((month) => ({
        competence: month.competence,
        bomComplete:
          month.bom.missingProductIds.length === 0 &&
          month.bom.factsWithBom === month.production.factCount,
        materialConsumptionTon: month.bom.materialConsumptionTon,
      })),
      Object.fromEntries(
        aggregateMaterials
          .filter(
            (material) =>
              material.aethosItemCode !== null && material.density !== null,
          )
          .map((material) => [
            Number(material.aethosItemCode),
            material.density!,
          ]),
      ),
      stonePowderFreights.map((freight) => ({
        competence: freight.competence.toISOString().slice(0, 10),
        unitCostPerM3: freight.unitCostPerM3,
      })),
      stockValuations
        .filter((valuation) => valuation.aethosItemId === 968)
        .map((valuation) => ({
          competence: valuation.competence.toISOString().slice(0, 10),
          aethosMaterialId: valuation.aethosItemId,
          quantityUnit: valuation.quantityUnit,
          closingAverageCost: valuation.closingAverageCost,
        })),
    );
    const materialCostByCompetence = new Map(
      materialCostMonths.map((month) => [month.competence, month]),
    );
    const capStockValuationsByCompetence = new Map<
      string,
      Array<{
        aethosMaterialId: number;
        materialName: string;
        tonnage: Prisma.Decimal;
      }>
    >();
    for (const valuation of stockValuations) {
      if (
        valuation.quantityUnit.toUpperCase() !== 'TN' ||
        ![1813, 5525, 5643, 11734, 13861].includes(valuation.aethosItemId)
      )
        continue;
      const competence = valuation.competence.toISOString().slice(0, 10);
      const items = capStockValuationsByCompetence.get(competence) || [];
      items.push({
        aethosMaterialId: valuation.aethosItemId,
        materialName: `Aethos ${valuation.aethosItemId}`,
        tonnage: valuation.closingQuantity,
      });
      capStockValuationsByCompetence.set(competence, items);
    }
    // O balanço físico usa exclusivamente inventários medidos e auditados da
    // Usina. MATERIAL_STOCK_VALUATIONS representa posição contábil do Aethos e
    // permanece apenas como evidência separada: nunca preenche tanque físico.
    const capPhysicalInventories = capInventories.map((inventory) => ({
      competence: `${inventory.referenceYear}-${String(
        inventory.referenceMonth,
      ).padStart(2, '0')}-01`,
      items: inventory.items.map((item) => ({
        aethosMaterialId:
          item.material.aethosItemCode === null
            ? null
            : Number(item.material.aethosItemCode),
        materialName: item.material.name,
        tonnage: item.tonnage,
      })),
    }));
    const physicalInventories = capInventories.map((inventory) => ({
      competence: `${inventory.referenceYear}-${String(
        inventory.referenceMonth,
      ).padStart(2, '0')}-01`,
      items: inventory.items.map((item) => ({
        aethosItemId:
          item.material.aethosItemCode === null
            ? null
            : Number(item.material.aethosItemCode),
        materialName: item.material.name,
        tonnage: item.tonnage,
      })),
    }));
    const physicalConsumptionMonths =
      calculateUsinaPhysicalMaterialConsumptionMonths(
        year,
        physicalMaterialMovements.map((movement) => ({
          competence: movement.competence,
          aethosItemId: movement.aethosItemId,
          movementType: movement.movementType as 'ENTRY' | 'DIRECT_SALE',
          quantityTon: movement.quantityTon,
        })),
        completedRuns
          .filter((run) => run.dataset === 'PHYSICAL_MATERIAL_MOVEMENTS')
          .map((run) => ({
            dataset: 'PHYSICAL_MATERIAL_MOVEMENTS' as const,
            status: 'COMPLETED',
            scopeDateFrom: run.scopeDateFrom,
            scopeDateTo: run.scopeDateTo,
          })),
        physicalInventories,
      );
    const physicalConsumptionByCompetence = new Map(
      physicalConsumptionMonths.map((month) => [month.competence, month]),
    );
    const capPhysicalPurchaseDocumentsByCompetence = new Map<
      string,
      Array<{
        sourceRecordId: string;
        sourceWeighingId: string | null;
        sourceItemId: string | null;
        occurredAt: string;
        competence: string;
        aethosItemId: number;
        materialClass: string;
        movementType: string;
        quantityOriginal: string;
        quantityUnit: string;
        densityTonPerM3: string | null;
        quantityTon: string;
      }>
    >();
    for (const movement of physicalMaterialMovements) {
      const materialClass = CAP_CLASS_BY_AETHOS_ITEM[movement.aethosItemId];
      if (
        movement.movementType !== 'ENTRY' ||
        !materialClass ||
        !PHYSICAL_CAP_PURCHASE_CLASSES.includes(
          materialClass as (typeof PHYSICAL_CAP_PURCHASE_CLASSES)[number],
        )
      ) {
        continue;
      }
      const competence = movement.competence.toISOString().slice(0, 10);
      const documents =
        capPhysicalPurchaseDocumentsByCompetence.get(competence) || [];
      documents.push({
        sourceRecordId: movement.sourceRecordId,
        sourceWeighingId: movement.sourceWeighingId?.toString() ?? null,
        sourceItemId: movement.sourceItemId?.toString() ?? null,
        occurredAt: movement.occurredAt.toISOString(),
        competence,
        aethosItemId: movement.aethosItemId,
        materialClass,
        movementType: movement.movementType,
        quantityOriginal: movement.quantityOriginal.toFixed(6),
        quantityUnit: movement.quantityUnit,
        densityTonPerM3: movement.densityTonPerM3?.toFixed(6) ?? null,
        quantityTon: movement.quantityTon.toFixed(6),
      });
      capPhysicalPurchaseDocumentsByCompetence.set(competence, documents);
    }
    const capCostMonths = calculateUsinaCapCostMonths(
      year,
      materialFacts
        .filter(
          (fact) =>
            fact.dataset === 'CAP_MOVEMENTS' ||
            fact.dataset === 'CAP_PURCHASE_ORDERS',
        )
        .map((fact) => ({
          dataset: fact.dataset as 'CAP_MOVEMENTS' | 'CAP_PURCHASE_ORDERS',
          competence: fact.competence,
          aethosMaterialId: fact.aethosMaterialId,
          movementType: fact.movementType as 'ENTRY' | 'DIRECT_EXIT',
          quantityTon: fact.quantityTon,
          materialAmount: fact.materialAmount,
          totalAmount: fact.totalAmount,
        })),
      completedRuns
        .filter(
          (run) =>
            run.dataset === 'CAP_MOVEMENTS' ||
            run.dataset === 'CAP_PURCHASE_ORDERS',
        )
        .map((run) => ({
          dataset: run.dataset as 'CAP_MOVEMENTS' | 'CAP_PURCHASE_ORDERS',
          scopeDateFrom: run.scopeDateFrom,
          scopeDateTo: run.scopeDateTo,
        })),
      capPhysicalInventories,
      productionMonths.map((month) => ({
        competence: month.competence,
        traceName: month.bom.customerSuppliedCapRule.traceName,
        byMaterial: {
          CAP_50_70: month.bom.customerSuppliedCapConsumptionTon.CAP_50_70,
          CAP_BORRACHA:
            month.bom.customerSuppliedCapConsumptionTon.CAP_BORRACHA,
          CAP_POLIMERO:
            month.bom.customerSuppliedCapConsumptionTon.CAP_POLIMERO,
          CAP_ALTO_MODULO:
            month.bom.customerSuppliedCapConsumptionTon.CAP_ALTO_MODULO,
        },
      })),
    );
    const capCostByCompetence = new Map(
      capCostMonths.map((month) => [month.competence, month]),
    );
    const capDocumentsByCompetence = new Map<
      string,
      Array<{
        dataset: 'CAP_PURCHASE_ORDERS' | 'CAP_MOVEMENTS';
        movementType: string;
        sourceRecordId: string;
        sourceDocumentId: string;
        sourceLineId: string | null;
        aethosMaterialId: number;
        materialDescription: string;
        materialClass: string;
        reportingFamily: string | null;
        occurredDate: string;
        quantityOriginal: string;
        quantityUnit: string;
        quantityTon: string | null;
        materialUnitCost: string | null;
        materialAmount: string | null;
        totalAmount: string | null;
        freightAmount: string | null;
        sourceUsedQuantity: string | null;
        sourceBalanceQuantity: string | null;
        sourceDiscountAmount: string | null;
        aethosCompanyId: number | null;
        supplierId: number | null;
        sourceStatus: string;
      }>
    >();
    for (const fact of materialFacts) {
      if (
        fact.dataset !== 'CAP_PURCHASE_ORDERS' &&
        fact.dataset !== 'CAP_MOVEMENTS'
      ) {
        continue;
      }
      const competence = fact.competence.toISOString().slice(0, 10);
      const documents = capDocumentsByCompetence.get(competence) || [];
      documents.push({
        dataset: fact.dataset as 'CAP_PURCHASE_ORDERS' | 'CAP_MOVEMENTS',
        movementType: fact.movementType,
        sourceRecordId: fact.sourceRecordId,
        sourceDocumentId: fact.sourceDocumentId,
        sourceLineId: fact.sourceLineId,
        aethosMaterialId: fact.aethosMaterialId,
        materialDescription: fact.materialDescription,
        materialClass: fact.materialClass,
        reportingFamily: fact.reportingFamily,
        occurredDate: fact.occurredDate.toISOString().slice(0, 10),
        quantityOriginal: fact.quantityOriginal.toFixed(6),
        quantityUnit: fact.quantityUnit,
        quantityTon: fact.quantityTon?.toFixed(6) ?? null,
        materialUnitCost: fact.materialUnitCost?.toFixed(6) ?? null,
        materialAmount: fact.materialAmount?.toFixed(6) ?? null,
        totalAmount: fact.totalAmount?.toFixed(6) ?? null,
        freightAmount: fact.freightAmount?.toFixed(6) ?? null,
        sourceUsedQuantity: fact.sourceUsedQuantity?.toFixed(6) ?? null,
        sourceBalanceQuantity: fact.sourceBalanceQuantity?.toFixed(6) ?? null,
        sourceDiscountAmount: fact.sourceDiscountAmount?.toFixed(6) ?? null,
        aethosCompanyId: fact.aethosCompanyId,
        supplierId: fact.supplierId,
        sourceStatus: fact.sourceStatus,
      });
      capDocumentsByCompetence.set(competence, documents);
    }
    const capPhysicalInventoryByCompetence = new Map(
      capInventories.map((inventory) => {
        const competence = `${inventory.referenceYear}-${String(
          inventory.referenceMonth,
        ).padStart(2, '0')}-01`;
        return [
          competence,
          {
            inventoryId: inventory.id,
            competence,
            measuredAt: inventory.measuredAt.toISOString(),
            source: inventory.source,
            createdAt: inventory.createdAt.toISOString(),
            updatedAt: inventory.updatedAt.toISOString(),
            createdBy: inventory.createdBy,
            updatedBy: inventory.updatedBy,
            history: inventory.history.map((entry) => ({
              id: entry.id,
              action: entry.action,
              createdAt: entry.createdAt.toISOString(),
              actor: entry.actor,
            })),
            items: inventory.items
              .map((item) => {
                const aethosItemId = Number(item.material.aethosItemCode);
                const materialClass = CAP_CLASS_BY_AETHOS_ITEM[aethosItemId];
                return materialClass
                  ? {
                      itemId: item.id,
                      materialId: item.material.id,
                      aethosItemId,
                      materialClass,
                      materialName: item.material.name,
                      closingStockTon: item.tonnage?.toFixed(6) ?? null,
                    }
                  : null;
              })
              .filter((item) => item !== null),
          },
        ] as const;
      }),
    );
    const operationalCostMonths = calculateUsinaOperationalCostMonths(
      year,
      operationalFacts.map((fact) => ({
        ...fact,
        dataset: fact.dataset as
          | 'VEHICLE_EXPENSES'
          | 'PAYABLE_EXPENSES'
          | 'LABOR_COSTS'
          | 'INTERNAL_CONSUMPTION_EXPENSES'
          | 'MATERIAL_PURCHASE_EXPENSES',
        costClass: fact.costClass as any,
      })),
      completedRuns
        .filter((run) =>
          [
            'VEHICLE_EXPENSES',
            'PAYABLE_EXPENSES',
            'LABOR_COSTS',
            'INTERNAL_CONSUMPTION_EXPENSES',
            'MATERIAL_PURCHASE_EXPENSES',
            'FLEET_MAINTENANCE_LABOR_ALLOCATIONS',
          ].includes(run.dataset),
        )
        .map((run) => ({
          dataset: run.dataset as
            | 'VEHICLE_EXPENSES'
            | 'PAYABLE_EXPENSES'
            | 'LABOR_COSTS'
            | 'INTERNAL_CONSUMPTION_EXPENSES'
            | 'MATERIAL_PURCHASE_EXPENSES'
            | 'FLEET_MAINTENANCE_LABOR_ALLOCATIONS',
          generatedAt: run.generatedAt,
          scopeDateFrom: run.scopeDateFrom,
          scopeDateTo: run.scopeDateTo,
        })),
      costConfigs.map((config) => ({
        competence: config.competence.toISOString().slice(0, 10),
        loaders: (config.equipment || [])
          .filter((item) => item.equipmentType === 'CARREGADEIRA')
          .map((item) => item.aethosVehicleId),
        supportVehicle:
          (config.equipment || []).find(
            (item) => item.equipmentType === 'VEICULO_USINA',
          )?.aethosVehicleId ?? null,
      })),
      fleetLaborAllocations.map((allocation) => ({
        competence: allocation.competence,
        aethosVehicleId: allocation.aethosVehicleId,
        targetCostClass: allocation.targetCostClass as
          | 'CARREGADEIRAS'
          | 'VEICULO_USINA',
        vehicleExpenseAmount: allocation.vehicleExpenseAmount,
        allocatedLaborAmount: allocation.allocatedLaborAmount,
      })),
      Boolean(fleetLaborDatasetActivation),
    );
    const operationalCostByCompetence = new Map(
      operationalCostMonths.map((month) => [month.competence, month]),
    );
    const operationalPriceAccumulator = new Map<
      string,
      {
        quantityTon: Prisma.Decimal;
        amount: Prisma.Decimal;
        complete: boolean;
        factCount: number;
      }
    >();
    for (const fact of operationalFacts) {
      const family = ['OLEO_RESIVALE', 'CAL_CH1', 'DOP'].includes(
        fact.costClass,
      )
        ? (fact.costClass as 'OLEO_RESIVALE' | 'CAL_CH1' | 'DOP')
        : null;
      if (!family) continue;
      if (
        (family === 'CAL_CH1' &&
          fact.dataset !== 'MATERIAL_PURCHASE_EXPENSES') ||
        (family !== 'CAL_CH1' && fact.dataset !== 'PAYABLE_EXPENSES')
      )
        continue;
      const competence = fact.competence.toISOString().slice(0, 10);
      const key = `${competence}|${family}`;
      const current = operationalPriceAccumulator.get(key) || {
        quantityTon: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
        complete: true,
        factCount: 0,
      };
      current.factCount += 1;
      current.amount = current.amount.plus(fact.amount);
      if (fact.quantityTon === null) current.complete = false;
      else current.quantityTon = current.quantityTon.plus(fact.quantityTon);
      operationalPriceAccumulator.set(key, current);
    }
    const operationalUnitPricesByCompetence = new Map<
      string,
      Partial<Record<UsinaPhysicalMaterialFamily, string | null>>
    >();
    for (const [key, price] of operationalPriceAccumulator) {
      const [competence, family] = key.split('|') as [
        string,
        UsinaPhysicalMaterialFamily,
      ];
      const current = operationalUnitPricesByCompetence.get(competence) || {};
      current[family] =
        price.complete && price.factCount > 0 && price.quantityTon.gt(0)
          ? price.amount.div(price.quantityTon).toFixed(6)
          : null;
      operationalUnitPricesByCompetence.set(competence, current);
    }
    const managerialUnitPricesByCompetence =
      buildManagerialOperationalUnitPrices(year, managerialUnitPriceFacts);
    for (const [
      competence,
      fallbackPrices,
    ] of managerialUnitPricesByCompetence) {
      const current = operationalUnitPricesByCompetence.get(competence) || {};
      for (const family of ['OLEO_RESIVALE', 'DOP'] as const) {
        if (current[family] === null || current[family] === undefined) {
          current[family] = fallbackPrices[family] ?? null;
        }
      }
      operationalUnitPricesByCompetence.set(competence, current);
    }
    carryForwardOperationalUnitPrices(year, operationalUnitPricesByCompetence);
    const operationalDocumentsByCompetence = new Map<
      string,
      Array<{
        sourceRecordId: string;
        sourceDocumentId: string | null;
        sourceDocumentType: string | null;
        internalConsumptionId: number | null;
        internalConsumptionItemId: number | null;
        accountPlanId: number | null;
        accountPlanDescription: string | null;
        aethosItemId: number | null;
        itemDescription: string | null;
        itemCategoryId: number | null;
        itemCategoryDescription: string | null;
        occurredDate: string;
        quantity: string | null;
        amount: string;
        selectionBasis: string | null;
      }>
    >();
    for (const fact of operationalFacts) {
      if (
        fact.dataset !== 'INTERNAL_CONSUMPTION_EXPENSES' ||
        fact.costClass !== 'MATERIAL_EXPEDIENTE'
      ) {
        continue;
      }
      const competence = fact.competence.toISOString().slice(0, 10);
      const documents = operationalDocumentsByCompetence.get(competence) || [];
      documents.push({
        sourceRecordId: fact.sourceRecordId,
        sourceDocumentId: fact.sourceDocumentId,
        sourceDocumentType: fact.sourceDocumentType,
        internalConsumptionId: fact.internalConsumptionId,
        internalConsumptionItemId: fact.internalConsumptionItemId,
        accountPlanId: fact.accountPlanId,
        accountPlanDescription: fact.accountPlanDescription,
        aethosItemId: fact.aethosItemId,
        itemDescription: fact.itemDescription,
        itemCategoryId: fact.itemCategoryId,
        itemCategoryDescription: fact.itemCategoryDescription,
        occurredDate: fact.occurredDate.toISOString().slice(0, 10),
        quantity: fact.quantity?.toFixed(6) ?? null,
        amount: fact.amount.toFixed(6),
        selectionBasis: fact.selectionBasis,
      });
      operationalDocumentsByCompetence.set(competence, documents);
    }
    const maintenanceDocumentsByCompetence = new Map<
      string,
      Array<{
        sourceRecordId: string;
        sourceDocumentId: string | null;
        sourceDocumentType: string | null;
        aethosVehicleId: number;
        fleetNumber: number | null;
        equipmentName: string;
        accountPlanId: number | null;
        accountPlanDescription: string | null;
        occurredDate: string;
        amount: string;
        sourceStatus: string;
      }>
    >();
    for (const fact of operationalFacts) {
      const effectiveClass =
        fact.dataset === 'VEHICLE_EXPENSES'
          ? classifyUsinaVehicleExpense(
              fact.aethosVehicleId,
              fact.accountPlanDescription,
            )
          : fact.costClass;
      if (
        effectiveClass !== 'MANUTENCAO_USINA' ||
        !USINA_MAINTENANCE_AETHOS_VEHICLE_IDS.includes(
          Number(fact.aethosVehicleId) as 426,
        )
      ) {
        continue;
      }
      const competence = fact.competence.toISOString().slice(0, 10);
      const documents = maintenanceDocumentsByCompetence.get(competence) || [];
      const vehicleId = Number(fact.aethosVehicleId) as 426;
      documents.push({
        sourceRecordId: fact.sourceRecordId,
        sourceDocumentId: fact.sourceDocumentId,
        sourceDocumentType: fact.sourceDocumentType,
        aethosVehicleId: vehicleId,
        fleetNumber: fact.fleetNumber,
        equipmentName: 'USI-2018',
        accountPlanId: fact.accountPlanId,
        accountPlanDescription: fact.accountPlanDescription,
        occurredDate: fact.occurredDate.toISOString().slice(0, 10),
        amount: fact.amount.toFixed(6),
        sourceStatus: fact.sourceStatus,
      });
      maintenanceDocumentsByCompetence.set(competence, documents);
    }
    const fleetLaborAllocationsByCompetence = new Map<
      string,
      Array<{
        sourceRecordId: string;
        aethosVehicleId: number;
        fleetNumber: number;
        targetCostClass: string;
        vehicleExpenseAmount: string;
        rateGroup: string;
        groupShare: string;
        groupExpenseBase: string;
        eligibleLaborPoolAmount: string;
        allocatedLaborAmount: string;
        expectedLineAmount: string;
        sourceSentence: string;
        sourceGeneratedAt: string;
      }>
    >();
    for (const allocation of fleetLaborAllocations) {
      const competence = allocation.competence.toISOString().slice(0, 10);
      const rows = fleetLaborAllocationsByCompetence.get(competence) || [];
      rows.push({
        sourceRecordId: allocation.sourceRecordId,
        aethosVehicleId: allocation.aethosVehicleId,
        fleetNumber: allocation.fleetNumber,
        targetCostClass: allocation.targetCostClass,
        vehicleExpenseAmount: allocation.vehicleExpenseAmount.toFixed(12),
        rateGroup: allocation.rateGroup,
        groupShare: allocation.groupShare.toFixed(6),
        groupExpenseBase: allocation.groupExpenseBase.toFixed(12),
        eligibleLaborPoolAmount: allocation.eligibleLaborPoolAmount.toFixed(12),
        allocatedLaborAmount: allocation.allocatedLaborAmount.toFixed(12),
        expectedLineAmount: allocation.expectedLineAmount.toFixed(12),
        sourceSentence: allocation.sourceSentence,
        sourceGeneratedAt: allocation.sourceGeneratedAt.toISOString(),
      });
      fleetLaborAllocationsByCompetence.set(competence, rows);
    }
    const calDocumentsByCompetence = new Map<
      string,
      Array<{
        sourceRecordId: string;
        sourceDocumentId: string | null;
        sourceDocumentType: string | null;
        materialEntryId: number | null;
        materialEntryItemId: number | null;
        sourceNoteNumber: string | null;
        aethosItemId: number | null;
        itemDescription: string | null;
        occurredDate: string;
        receivedDate: string | null;
        competence: string;
        quantityOriginal: string | null;
        quantityOriginalUnit: string | null;
        quantityTon: string | null;
        unitPriceOriginal: string | null;
        unitPriceTon: string | null;
        sourceItemTotal: string | null;
        amount: string;
        quantityNormalizationBasis: string | null;
        priceNormalizationBasis: string | null;
        competenceBasis: string | null;
      }>
    >();
    for (const fact of operationalFacts) {
      if (
        fact.dataset !== 'MATERIAL_PURCHASE_EXPENSES' ||
        fact.costClass !== 'CAL_CH1'
      ) {
        continue;
      }
      const competence = fact.competence.toISOString().slice(0, 10);
      const documents = calDocumentsByCompetence.get(competence) || [];
      documents.push({
        sourceRecordId: fact.sourceRecordId,
        sourceDocumentId: fact.sourceDocumentId,
        sourceDocumentType: fact.sourceDocumentType,
        materialEntryId: fact.materialEntryId,
        materialEntryItemId: fact.materialEntryItemId,
        sourceNoteNumber: fact.sourceNoteNumber,
        aethosItemId: fact.aethosItemId,
        itemDescription: fact.itemDescription,
        occurredDate: fact.occurredDate.toISOString().slice(0, 10),
        receivedDate: fact.receivedDate?.toISOString().slice(0, 10) ?? null,
        competence,
        quantityOriginal: fact.quantityOriginal?.toFixed(6) ?? null,
        quantityOriginalUnit: fact.quantityOriginalUnit,
        quantityTon: fact.quantityTon?.toFixed(6) ?? null,
        unitPriceOriginal: fact.unitPriceOriginal?.toFixed(6) ?? null,
        unitPriceTon: fact.unitPriceTon?.toFixed(6) ?? null,
        sourceItemTotal: fact.sourceItemTotal?.toFixed(6) ?? null,
        amount: fact.amount.toFixed(6),
        quantityNormalizationBasis: fact.quantityNormalizationBasis,
        priceNormalizationBasis: fact.priceNormalizationBasis,
        competenceBasis: fact.competenceBasis,
      });
      calDocumentsByCompetence.set(competence, documents);
    }
    const forecastByCompetence = new Map<
      string,
      Record<string, number | null>
    >();
    for (const forecast of forecasts) {
      const key = forecast.competence.toISOString().slice(0, 10);
      const current = forecastByCompetence.get(key) || {};
      current[forecast.materialCode] = value(forecast.forecastValue);
      forecastByCompetence.set(key, current);
    }
    const configByCompetence = new Map(
      costConfigs.map((config) => [
        config.competence.toISOString().slice(0, 10),
        config,
      ]),
    );
    const targetByCompetence = new Map(
      targets.map((target) => [
        target.competence.toISOString().slice(0, 10),
        target,
      ]),
    );
    const stonePowderFreightByCompetence = new Map(
      stonePowderFreights.map((freight) => [
        freight.competence.toISOString().slice(0, 10),
        freight,
      ]),
    );
    const exceptionsByCompetence = new Map<string, typeof materialExceptions>();
    for (const exception of materialExceptions) {
      const key = exception.competence.toISOString().slice(0, 10);
      const current = exceptionsByCompetence.get(key) || [];
      current.push(exception);
      exceptionsByCompetence.set(key, current);
    }

    const months = Array.from({ length: 12 }, (_, index) => {
      const competence = new Date(Date.UTC(year, index, 1))
        .toISOString()
        .slice(0, 10);
      const forecast = forecastByCompetence.get(competence) || {};
      const config = configByCompetence.get(competence);
      const target = targetByCompetence.get(competence);
      const stonePowderFreight = stonePowderFreightByCompetence.get(competence);
      const physicalConsumption =
        physicalConsumptionByCompetence.get(competence) || null;
      const materialCost = applyPhysicalAggregateConsumption(
        materialCostByCompetence.get(competence) || null,
        physicalConsumption,
      );
      const capCost = applyPhysicalCapConsumption(
        capCostByCompetence.get(competence) || null,
        physicalConsumption,
        capPhysicalPurchaseDocumentsByCompetence.get(competence) || [],
      );
      const operationalCost = applyPhysicalOperationalConsumption(
        operationalCostByCompetence.get(competence) || null,
        physicalConsumption,
        operationalUnitPricesByCompetence.get(competence) || {},
      );
      const revenue = revenueByCompetence.get(competence) || {
        competence,
        internal: null,
        external: null,
        totalAmount: null,
      };
      const externalSalesTax = calculateSalesTaxOnExternalRevenue(
        revenue.external?.amount ?? null,
        config?.taxRate ?? null,
      );
      const revenueDocuments = revenueDocumentsByCompetence.get(competence) || {
        INTERNAL: [],
        EXTERNAL: [],
      };
      const uniqueDocumentCount = (type: 'INTERNAL' | 'EXTERNAL') =>
        new Set(
          revenueDocuments[type].map((document) => document.sourceDocumentId),
        ).size;
      return {
        competence,
        production: productionByCompetence.get(competence)?.production ?? null,
        bom: productionByCompetence.get(competence)?.bom ?? null,
        revenue,
        forecast: {
          values: forecast,
          totalCapRt: null,
        },
        parameters: {
          taxRate: value(config?.taxRate),
          taxVersion: config?.version ?? null,
          depreciationAnnual: value(depreciation?.annualValue),
          depreciationMonthly: value(depreciation?.monthlyValue),
          depreciationVersion: depreciation?.version ?? null,
          targetRate: value(target?.targetRate),
          targetVersion: target?.version ?? null,
          stonePowderFreightUnitCostPerM3: value(
            stonePowderFreight?.unitCostPerM3,
          ),
          stonePowderFreightVersion: stonePowderFreight?.version ?? null,
        },
        calculated: {
          physicalMaterialConsumption: physicalConsumption,
          salesTaxOnExternalRevenue: externalSalesTax,
          salesTaxEvidence: {
            sourceTable: 'UsinaRevenueFact',
            includedCriterion: 'active = true AND revenueType = EXTERNAL',
            excludedCriterion: 'active = true AND revenueType = INTERNAL',
            sourceComplete: revenue.external !== null,
            taxableBase: revenue.external?.amount ?? null,
            taxRate: value(config?.taxRate),
            taxAmount: externalSalesTax,
            externalIncluded: {
              factCount: revenue.external?.factCount ?? null,
              documentCount:
                revenue.external === null
                  ? null
                  : uniqueDocumentCount('EXTERNAL'),
              amount: revenue.external?.amount ?? null,
              byClassification: revenue.external?.byClassification ?? null,
              sampleDocuments: revenueDocuments.EXTERNAL.slice(0, 20),
            },
            internalExcluded: {
              factCount: revenue.internal?.factCount ?? null,
              documentCount:
                revenue.internal === null
                  ? null
                  : uniqueDocumentCount('INTERNAL'),
              amount: revenue.internal?.amount ?? null,
              byClassification: revenue.internal?.byClassification ?? null,
              sampleDocuments: revenueDocuments.INTERNAL.slice(0, 20),
            },
          },
          capCosts: capCost
            ? {
                ...capCost,
                documents: capDocumentsByCompetence.get(competence) || [],
                physicalInventory:
                  capPhysicalInventoryByCompetence.get(competence) || null,
                accountingStockValuations: (
                  capStockValuationsByCompetence.get(competence) || []
                ).map((valuation) => ({
                  aethosItemId: valuation.aethosMaterialId,
                  materialName: valuation.materialName,
                  closingQuantity: valuation.tonnage.toFixed(6),
                  quantityUnit: 'TN',
                  source: 'MATERIAL_STOCK_VALUATIONS',
                  usedAsPhysicalInventory: false,
                })),
              }
            : null,
          materialCosts: materialCost,
          operationalCosts: operationalCost
            ? {
                ...operationalCost,
                fleetMaintenanceLabor: {
                  ...operationalCost.fleetMaintenanceLabor,
                  allocations:
                    fleetLaborAllocationsByCompetence.get(competence) || [],
                },
                documents: {
                  MATERIAL_EXPEDIENTE:
                    operationalDocumentsByCompetence.get(competence) || [],
                  CAL_CH1: calDocumentsByCompetence.get(competence) || [],
                  MANUTENCAO_USINA:
                    maintenanceDocumentsByCompetence.get(competence) || [],
                },
              }
            : null,
        },
        materialReceiptExceptions: (
          exceptionsByCompetence.get(competence) || []
        ).map((exception) => ({
          ...exception,
          occurredAt: exception.occurredAt.toISOString(),
          finalizedAt: exception.finalizedAt?.toISOString() ?? null,
          competence: exception.competence.toISOString().slice(0, 10),
          quantityOriginal: exception.quantityOriginal.toFixed(6),
          correlatedEntryId: exception.correlatedEntryId?.toString() ?? null,
          correlatedEntryItemId:
            exception.correlatedEntryItemId?.toString() ?? null,
          correlatedEntryQuantityOriginal:
            exception.correlatedEntryQuantityOriginal?.toFixed(6) ?? null,
        })),
      };
    });
    const financialByCompetence = new Map(
      calculateUsinaFinancialMonths(
        months.map((month) => ({
          competence: month.competence,
          internalRevenue: month.revenue.internal?.amount ?? null,
          externalRevenue: month.revenue.external?.amount ?? null,
          costs: {
            ...(month.calculated.operationalCosts?.costs || {}),
            ...(month.calculated.capCosts?.costs || {}),
            BRITADOS: month.calculated.materialCosts?.costs.BRITADOS ?? null,
            FRETE_BRITADOS:
              month.calculated.materialCosts?.costs.FRETE_BRITADOS ?? null,
            DEPRECIACAO_USINA: month.parameters.depreciationMonthly,
            IMPOSTO_VENDA: month.calculated.salesTaxOnExternalRevenue,
          },
        })),
      ).map((month) => [month.competence, month]),
    );
    const maintenanceCumulativeBase = buildMaintenanceCumulativeBase(
      year,
      facts,
      operationalFacts,
    );
    const indicatorsByCompetence = new Map(
      calculateUsinaMonthlyIndicators(
        months.map((month) => {
          const financial = financialByCompetence.get(month.competence)!;
          return {
            competence: month.competence,
            productionTon: month.production?.totalTon ?? null,
            productionByCapClass: month.production
              ? {
                  CAP_50_70: month.production.byClassification.CAP_50_70,
                  CAP_BORRACHA: month.production.byClassification.CAP_BORRACHA,
                  CAP_POLIMERO: month.production.byClassification.CAP_POLIMERO,
                }
              : null,
            materialConsumptionTon:
              month.bom?.coveragePercent === '100.0000'
                ? month.bom.materialConsumptionTon
                : null,
            forecasts: month.forecast.values,
            costs: financial.costs.values,
            resultRate: financial.resultRate,
            targetRate: month.parameters.targetRate,
            cumulativeResultRate: financial.cumulative.resultRate,
            capPurchases: month.calculated.capCosts?.purchases ?? null,
          };
        }),
        maintenanceCumulativeBase
          ? {
              maintenanceCumulativeBase: {
                maintenanceAmount: maintenanceCumulativeBase.maintenanceAmount,
                productionTon: maintenanceCumulativeBase.productionTon,
              },
            }
          : {},
      ).map((month) => [month.competence, month]),
    );
    const resultMonths = months.map((month) => {
      const indicators = indicatorsByCompetence.get(month.competence) || null;
      const comparisonInput = {
        competence: month.competence,
        productionTon: month.production?.totalTon ?? null,
        forecasts: month.forecast.values,
        costs: financialByCompetence.get(month.competence)?.costs.values || {},
        aggregatePrices: month.calculated.materialCosts?.prices ?? null,
        aggregateCosts: month.calculated.materialCosts?.costsByMaterial ?? null,
        productionByCapClass: month.production
          ? {
              CAP_50_70: month.production.byClassification.CAP_50_70,
              CAP_BORRACHA: month.production.byClassification.CAP_BORRACHA,
              CAP_POLIMERO: month.production.byClassification.CAP_POLIMERO,
            }
          : null,
        capPurchases: month.calculated.capCosts?.purchases.byMaterial ?? null,
        capConsumedCosts: month.calculated.capCosts
          ? {
              CAP_50_70:
                month.calculated.capCosts.materials.CAP_50_70?.cost ?? null,
              CAP_BORRACHA:
                month.calculated.capCosts.materials.CAP_BORRACHA?.cost ?? null,
              CAP_POLIMERO:
                month.calculated.capCosts.materials.CAP_POLIMERO?.cost ?? null,
            }
          : null,
        maintenanceCumulative: indicators?.maintenancePerTon.cumulative ?? null,
      };
      const comparison = calculateUsinaMonthlyComparison(comparisonInput);
      const comparisonSummary = calculateUsinaMonthlyComparisonSummary(
        comparisonInput,
        comparison,
      );
      return {
        ...month,
        forecast: {
          ...month.forecast,
          totalCapRt:
            comparisonSummary.totalCaps.forecast === null
              ? null
              : Number(comparisonSummary.totalCaps.forecast),
        },
        financial: financialByCompetence.get(month.competence) || null,
        indicators,
        comparison,
        comparisonSummary,
      };
    });

    if (this.bomMissingAlertService) {
      try {
        await this.bomMissingAlertService.syncFromMonthlyResult(resultMonths);
      } catch (error) {
        console.warn(
          '[usina-bom-alert] Falha ao processar alertas sem bloquear a apresentacao:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    return {
      year,
      context: USINA_FORECAST_CONTEXT,
      auditBasis: {
        legacyWorkbook: {
          year: 2025,
          forecastColumns: 'BD:BO',
          comparisonRows: '65:127',
        },
        maintenanceCumulative: maintenanceCumulativeBase
          ? {
              status: 'VERIFIED_EXCEL_BASELINE_CONTINUED',
              periodStart: maintenanceCumulativeBase.periodStart,
              periodEnd: maintenanceCumulativeBase.periodEnd,
              competences: maintenanceCumulativeBase.competences,
              maintenanceAmount: maintenanceCumulativeBase.maintenanceAmount,
              productionTon: maintenanceCumulativeBase.productionTon,
              januaryFormula:
                'Σ manutenção desde ago/2020 ÷ Σ produção desde ago/2020',
            }
          : null,
        operationalSelections: {
          loadersAethosVehicleIds: [38, 53],
          supportVehicleAethosVehicleId: 486,
          usinaEquipmentAethosVehicleId: 426,
          usinaMaintenanceAethosVehicleIds: [426],
          maintenanceExcludedPlanIds: [37],
        },
        legacyObsoleteRows: [
          {
            row: 21,
            code: 'GERENCIAMENTO',
            label: 'Gerenciamento',
            status: 'OBSOLETO_NULL',
            reason:
              'Planilha apresenta hífen em todas as competências de 2025.',
          },
          {
            row: 51,
            code: 'OUTROS_CLIENTES',
            label: 'Outros clientes',
            status: 'OBSOLETO_NULL',
            reason:
              'Fatos de terceiros aparecem na receita externa por categoria; não somar novamente.',
          },
          {
            row: 52,
            code: 'OUTROS_CLIENTES_SEM_CAP',
            label: 'Outros clientes — asfalto sem CAP',
            status: 'OBSOLETO_NULL',
            reason: 'Linha dedicada obsoleta em 2025; preservar como NULL.',
          },
          {
            row: 53,
            code: 'OBRA_CCR_SEM_CAP',
            label: 'Obra CCR — asfalto sem CAP',
            status: 'OBSOLETO_NULL',
            reason:
              'Fatos atuais pertencem à receita externa sem CAP; não duplicar.',
          },
        ],
        trackedDivergences: [
          'Material de expediente em outubro/2025: o Excel inclui o consumo 23621 (R$ 397,70), atualmente cancelado no Aethos; a divergência histórica é justificada e não recebe backfill.',
          'Manutenção: somente a USI-2018 (426) compõe a rubrica. A USI-2025 (1324) pertence a outra usina e fica excluída do cálculo; janeiro, maio, setembro e outubro preservam diferenças históricas sem documento ativo para backfill.',
          'Dezembro/2025: residual de produção de 851,75 t sem fato rastreável; não realizar backfill.',
          'CAP 2025: estoque absoluto e consumo contábil indisponíveis; totais dependentes permanecem NULL.',
        ],
      },
      syncCoverage: completedRuns.map((run) => ({
        ...run,
        generatedAt: run.generatedAt.toISOString(),
        scopeDateFrom: run.scopeDateFrom.toISOString().slice(0, 10),
        scopeDateTo: run.scopeDateTo.toISOString().slice(0, 10),
        completedAt: run.completedAt?.toISOString() ?? null,
      })),
      productionCoverage: completedRuns
        .filter((run) => run.dataset === 'PRODUCTION')
        .map((run) => ({
          ...run,
          generatedAt: run.generatedAt.toISOString(),
          scopeDateFrom: run.scopeDateFrom.toISOString().slice(0, 10),
          scopeDateTo: run.scopeDateTo.toISOString().slice(0, 10),
          completedAt: run.completedAt?.toISOString() ?? null,
        })),
      months: resultMonths,
    };
  }
}
