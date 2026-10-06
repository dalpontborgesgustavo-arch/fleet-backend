import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;

export const USINA_CAP_COST_CLASSES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
  'CAP_ALTO_MODULO',
] as const;

export type UsinaCapCostClass = (typeof USINA_CAP_COST_CLASSES)[number];

export interface UsinaCapCostFactInput {
  dataset: 'CAP_MOVEMENTS' | 'CAP_PURCHASE_ORDERS';
  competence: Date;
  aethosMaterialId: number;
  movementType: 'ENTRY' | 'DIRECT_EXIT';
  quantityTon: DecimalInput | null;
  materialAmount: DecimalInput | null;
  totalAmount?: DecimalInput | null;
}

export interface UsinaCapCoverageInput {
  dataset: 'CAP_MOVEMENTS' | 'CAP_PURCHASE_ORDERS';
  scopeDateFrom: Date;
  scopeDateTo: Date;
}

export interface UsinaCapInventoryInput {
  competence: string;
  items: Array<{
    aethosMaterialId: number | null;
    materialName: string;
    tonnage: DecimalInput | null;
  }>;
}

export interface UsinaCapCustomerSuppliedInput {
  competence: string;
  traceName: string;
  byMaterial: Partial<Record<UsinaCapCostClass, DecimalInput>>;
}

const CAP_CLASS_BY_AETHOS_ID: Record<number, UsinaCapCostClass> = {
  1813: 'CAP_50_70',
  5525: 'CAP_BORRACHA',
  5643: 'CAP_POLIMERO',
  11734: 'CAP_POLIMERO',
  13861: 'CAP_ALTO_MODULO',
};

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function fixed(value: Prisma.Decimal) {
  return value.toFixed(6);
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7) + '-01';
}

function previousMonth(competence: string) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

function monthCovered(
  competence: string,
  dataset: UsinaCapCoverageInput['dataset'],
  coverage: UsinaCapCoverageInput[],
) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return coverage.some(
    (run) =>
      run.dataset === dataset &&
      run.scopeDateFrom.toISOString().slice(0, 10) <= competence &&
      run.scopeDateTo.toISOString().slice(0, 10) >= monthEnd,
  );
}

function inventoryClass(item: UsinaCapInventoryInput['items'][number]) {
  if (item.aethosMaterialId !== null) {
    const byId = CAP_CLASS_BY_AETHOS_ID[item.aethosMaterialId];
    if (byId) return byId;
  }
  const name = item.materialName.trim().toUpperCase();
  if (name.includes('BORRACHA')) return 'CAP_BORRACHA';
  if (name.includes('POLIM')) return 'CAP_POLIMERO';
  if (name.includes('ALTO M')) return 'CAP_ALTO_MODULO';
  if (name.includes('50/70') || name.includes('50 70')) return 'CAP_50_70';
  return null;
}

interface MutableMovement {
  entryFactCount: number;
  entryQuantity: Prisma.Decimal;
  entryAmount: Prisma.Decimal;
  directExitQuantity: Prisma.Decimal;
  quantityComplete: boolean;
  amountComplete: boolean;
}

function emptyMovement(): MutableMovement {
  return {
    entryFactCount: 0,
    entryQuantity: new Prisma.Decimal(0),
    entryAmount: new Prisma.Decimal(0),
    directExitQuantity: new Prisma.Decimal(0),
    quantityComplete: true,
    amountComplete: true,
  };
}

export function calculateUsinaCapCostMonths(
  year: number,
  facts: UsinaCapCostFactInput[],
  coverage: UsinaCapCoverageInput[],
  inventories: UsinaCapInventoryInput[],
  customerSuppliedInputs: UsinaCapCustomerSuppliedInput[] = [],
) {
  const movements = new Map<
    string,
    Record<UsinaCapCostClass, MutableMovement>
  >();
  const purchaseOrders = new Map<
    string,
    Record<UsinaCapCostClass, MutableMovement>
  >();
  for (const fact of facts) {
    const capClass = CAP_CLASS_BY_AETHOS_ID[fact.aethosMaterialId];
    if (!capClass) continue;
    const competence = monthKey(fact.competence);
    const target =
      fact.dataset === 'CAP_PURCHASE_ORDERS' ? purchaseOrders : movements;
    const month =
      target.get(competence) ||
      Object.fromEntries(
        USINA_CAP_COST_CLASSES.map((code) => [code, emptyMovement()]),
      ) as Record<UsinaCapCostClass, MutableMovement>;
    const current = month[capClass];
    if (fact.quantityTon === null) {
      current.quantityComplete = false;
    } else if (fact.movementType === 'ENTRY') {
      current.entryQuantity = current.entryQuantity.plus(
        decimal(fact.quantityTon),
      );
    } else {
      current.directExitQuantity = current.directExitQuantity.plus(
        decimal(fact.quantityTon),
      );
    }
    if (fact.movementType === 'ENTRY') {
      current.entryFactCount += 1;
      const effectiveAmount = fact.materialAmount ?? fact.totalAmount;
      if (effectiveAmount == null) current.amountComplete = false;
      else
        current.entryAmount = current.entryAmount.plus(
          decimal(effectiveAmount),
        );
    }
    target.set(competence, month);
  }

  const stock = new Map<
    string,
    Partial<Record<UsinaCapCostClass, Prisma.Decimal>>
  >();
  for (const inventory of inventories) {
    const month: Partial<Record<UsinaCapCostClass, Prisma.Decimal>> = {};
    for (const item of inventory.items) {
      const capClass = inventoryClass(item);
      if (!capClass || item.tonnage === null) continue;
      month[capClass] = (month[capClass] || new Prisma.Decimal(0)).plus(
        decimal(item.tonnage),
      );
    }
    stock.set(inventory.competence, month);
  }

  const customerSupplied = new Map(
    customerSuppliedInputs.map((entry) => [entry.competence, entry]),
  );

  return Array.from({ length: 12 }, (_, index) => {
    const competence = new Date(Date.UTC(year, index, 1))
      .toISOString()
      .slice(0, 10);
    const movementCovered = monthCovered(
      competence,
      'CAP_MOVEMENTS',
      coverage,
    );
    const purchaseCovered = monthCovered(
      competence,
      'CAP_PURCHASE_ORDERS',
      coverage,
    );
    const currentStock = stock.get(competence) || {};
    const openingStock = stock.get(previousMonth(competence)) || {};
    const monthMovement = movements.get(competence);
    const monthPurchaseOrders = purchaseOrders.get(competence);
    const costs = {} as Record<UsinaCapCostClass, string | null>;
    const materials = {} as Record<
      UsinaCapCostClass,
      {
        openingTon: string | null;
        entryTon: string | null;
        closingTon: string | null;
        directExitTon: string | null;
        consumedTon: string | null;
        unitCost: string | null;
        cost: string | null;
        issue: string | null;
      }
    >;
    const purchaseByMaterial = {} as Record<
      UsinaCapCostClass,
      {
        quantityTon: string | null;
        amount: string | null;
        unitCost: string | null;
      }
    >;
    const costSources = {} as Record<
      UsinaCapCostClass,
      | 'CAP_PURCHASE_ORDERS'
      | 'CAP_MOVEMENTS_FALLBACK'
      | 'CUSTOMER_SUPPLIED_CCR'
      | null
    >;
    const customerSuppliedByMaterial = {} as Record<
      UsinaCapCostClass,
      { excludedTon: string; traceName: string } | null
    >;
    let purchaseQuantity = new Prisma.Decimal(0);
    let purchaseAmount = new Prisma.Decimal(0);
    let purchaseComplete = purchaseCovered;

    for (const capClass of USINA_CAP_COST_CLASSES) {
      const movement = monthMovement?.[capClass] || emptyMovement();
      const opening = openingStock[capClass];
      const closing = currentStock[capClass];
      let issue: string | null = null;
      if (!movementCovered) issue = 'CAP_MOVEMENTS_NOT_COVERED';
      else if (opening === undefined || closing === undefined)
        issue = 'INVENTORY_NOT_AVAILABLE';
      else if (!movement.quantityComplete) issue = 'MOVEMENT_QUANTITY_MISSING';
      const consumed =
        issue === null
          ? opening!
              .plus(movement.entryQuantity)
              .minus(closing!)
              .minus(movement.directExitQuantity)
          : null;
      if (consumed?.isNegative()) issue = 'NEGATIVE_CALCULATED_CONSUMPTION';
      else if (consumed?.gt(0) && movement.entryQuantity.lte(0))
        issue = 'PURCHASE_UNIT_COST_NOT_AVAILABLE';
      else if (consumed?.gt(0) && !movement.amountComplete)
        issue = 'PURCHASE_AMOUNT_MISSING';
      const unitCost =
        issue === null && movement.entryQuantity.gt(0)
          ? movement.entryAmount.div(movement.entryQuantity)
          : null;
      const cost =
        issue === null && consumed
          ? consumed.isZero()
            ? new Prisma.Decimal(0)
            : unitCost
              ? consumed.mul(unitCost)
              : null
          : null;

      const documentedPurchase =
        monthPurchaseOrders?.[capClass] || emptyMovement();
      const suppliedInput = customerSupplied.get(competence);
      const suppliedQuantity = suppliedInput?.byMaterial[capClass]
        ? decimal(suppliedInput.byMaterial[capClass]!)
        : new Prisma.Decimal(0);
      const useCustomerSuppliedRule =
        capClass === 'CAP_ALTO_MODULO' &&
        purchaseCovered &&
        documentedPurchase.entryFactCount === 0 &&
        suppliedQuantity.gt(0);
      const useMovementFallback =
        !useCustomerSuppliedRule &&
        capClass === 'CAP_ALTO_MODULO' &&
        purchaseCovered &&
        documentedPurchase.entryFactCount === 0;
      const purchaseMovement = useCustomerSuppliedRule
        ? emptyMovement()
        : useMovementFallback
          ? movement
          : documentedPurchase;
      const purchaseClassComplete = useCustomerSuppliedRule
        ? purchaseCovered
        : useMovementFallback
          ? movementCovered &&
            purchaseMovement.quantityComplete &&
            purchaseMovement.amountComplete
          : purchaseCovered &&
            purchaseMovement.quantityComplete &&
            purchaseMovement.amountComplete;
      const purchaseUnitCost =
        purchaseClassComplete && purchaseMovement.entryQuantity.gt(0)
          ? purchaseMovement.entryAmount.div(purchaseMovement.entryQuantity)
          : null;
      purchaseByMaterial[capClass] = {
        quantityTon: purchaseClassComplete
          ? fixed(purchaseMovement.entryQuantity)
          : null,
        amount: purchaseClassComplete
          ? fixed(purchaseMovement.entryAmount)
          : null,
        unitCost:
          purchaseUnitCost === null ? null : fixed(purchaseUnitCost),
      };
      costSources[capClass] = purchaseClassComplete
        ? useCustomerSuppliedRule
          ? 'CUSTOMER_SUPPLIED_CCR'
          : useMovementFallback
            ? 'CAP_MOVEMENTS_FALLBACK'
            : 'CAP_PURCHASE_ORDERS'
        : null;
      customerSuppliedByMaterial[capClass] = suppliedQuantity.gt(0)
        ? {
            excludedTon: fixed(suppliedQuantity),
            traceName: suppliedInput?.traceName || 'CCR ALTO MÓDULO',
          }
        : null;
      if (!purchaseClassComplete) {
        purchaseComplete = false;
      } else {
        purchaseQuantity = purchaseQuantity.plus(
          purchaseMovement.entryQuantity,
        );
        purchaseAmount = purchaseAmount.plus(purchaseMovement.entryAmount);
      }

      costs[capClass] = purchaseClassComplete
        ? fixed(purchaseMovement.entryAmount)
        : null;
      materials[capClass] = {
        openingTon: opening === undefined ? null : fixed(opening),
        entryTon: movementCovered ? fixed(movement.entryQuantity) : null,
        closingTon: closing === undefined ? null : fixed(closing),
        directExitTon: movementCovered
          ? fixed(movement.directExitQuantity)
          : null,
        consumedTon:
          consumed === null || consumed.isNegative() ? null : fixed(consumed),
        unitCost: unitCost === null ? null : fixed(unitCost),
        cost: cost === null ? null : fixed(cost),
        issue,
      };
    }

    const purchaseUnitCost =
      purchaseComplete && purchaseQuantity.gt(0)
        ? purchaseAmount.div(purchaseQuantity)
        : null;

    return {
      competence,
      covered: movementCovered,
      purchaseCovered,
      costSources,
      customerSuppliedByMaterial,
      materials,
      costs,
      purchases: {
        quantityTon: purchaseComplete ? fixed(purchaseQuantity) : null,
        amount: purchaseComplete ? fixed(purchaseAmount) : null,
        unitCost: purchaseUnitCost === null ? null : fixed(purchaseUnitCost),
        byMaterial: purchaseByMaterial,
      },
    };
  });
}
