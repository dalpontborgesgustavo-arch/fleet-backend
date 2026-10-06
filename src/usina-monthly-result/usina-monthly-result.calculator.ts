import { Prisma } from '@prisma/client';

export const USINA_RESULT_CLASSIFICATIONS = [
  'USINAGEM_SEM_CAP',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
  'CAP_50_70',
] as const;

export const USINA_RESULT_MATERIALS = {
  111: 'PEDRISCO',
  968: 'PO_DE_PEDRA',
  1465: 'BRITA_3_4',
  1813: 'CAP_50_70',
  5525: 'CAP_BORRACHA',
  5643: 'CAP_POLIMERO',
  11734: 'CAP_POLIMERO',
  13861: 'CAP_ALTO_MODULO',
} as const;

type Classification = (typeof USINA_RESULT_CLASSIFICATIONS)[number];
type MaterialCode =
  (typeof USINA_RESULT_MATERIALS)[keyof typeof USINA_RESULT_MATERIALS];

export interface ProductionFactInput {
  aethosProductId: number;
  productDescription?: string | null;
  classification: string;
  occurredAt: Date;
  competence: Date;
  quantityTon: Prisma.Decimal | string | number;
}

export interface RevenueFactInput {
  revenueType: 'INTERNAL' | 'EXTERNAL';
  classification?: string | null;
  competence: Date;
  quantityOriginal: Prisma.Decimal | string | number;
  quantityUnit: string;
  quantityTon?: Prisma.Decimal | string | number | null;
  amount: Prisma.Decimal | string | number;
  freightAmount?: Prisma.Decimal | string | number | null;
  orderFreightAmount?: Prisma.Decimal | string | number | null;
}

export interface RevenueCoverageInput {
  dataset: 'INTERNAL_REVENUE' | 'EXTERNAL_REVENUE';
  generatedAt: Date;
  scopeDateFrom: Date;
  scopeDateTo: Date;
}

export interface BomComponentInput {
  aethosMaterialId: number;
  consumptionPercent: Prisma.Decimal | string | number;
  deletedAt?: Date | null;
}

export interface BomVersionInput {
  version: number;
  traceName?: string | null;
  validFrom: Date;
  validTo?: Date | null;
  deletedAt?: Date | null;
  components: BomComponentInput[];
}

export interface BomStructureInput {
  aethosProductId: number;
  companyId?: string | null;
  unitId?: string | null;
  deletedAt?: Date | null;
  versions: BomVersionInput[];
}

interface MutableMonth {
  total: Prisma.Decimal;
  byClassification: Record<Classification, Prisma.Decimal>;
  materialConsumption: Record<MaterialCode, Prisma.Decimal>;
  customerSuppliedCapConsumption: Record<MaterialCode, Prisma.Decimal>;
  materialConsumptionDetails: Map<string, MutableBomConsumptionDetail>;
  facts: number;
  factsWithBom: number;
  tonWithBom: Prisma.Decimal;
  missingBomProductIds: Set<number>;
  missingBomProducts: Map<number, string | null>;
}

interface MutableBomConsumptionDetail {
  aethosProductId: number;
  productDescription: string | null;
  traceName: string | null;
  bomVersion: number;
  validFrom: string;
  validTo: string | null;
  materialCode: MaterialCode;
  aethosMaterialId: number;
  consumptionPercent: Prisma.Decimal;
  productionFactCount: number;
  productionTon: Prisma.Decimal;
  consumptionTon: Prisma.Decimal;
}

function decimal(value: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(value);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function saoPauloDateKey(value: Date) {
  const parts = Object.fromEntries(
    SAO_PAULO_DATE_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7) + '-01';
}

function emptyClassificationTotals() {
  return Object.fromEntries(
    USINA_RESULT_CLASSIFICATIONS.map((code) => [code, new Prisma.Decimal(0)]),
  ) as Record<Classification, Prisma.Decimal>;
}

function emptyMaterialTotals() {
  return Object.fromEntries(
    [...new Set(Object.values(USINA_RESULT_MATERIALS))].map((code) => [
      code,
      new Prisma.Decimal(0),
    ]),
  ) as Record<MaterialCode, Prisma.Decimal>;
}

function normalizedRuleText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function isCcrCustomerSuppliedCapTrace(traceName?: string | null) {
  return normalizedRuleText(traceName) === 'CCR ALTO MODULO';
}

function specificity(
  structure: BomStructureInput,
  companyId: string,
  unitId: string,
) {
  if (structure.companyId === companyId && structure.unitId === unitId)
    return 2;
  if (structure.companyId === null && structure.unitId === null) return 0;
  return -1;
}

function selectVersion(
  structures: BomStructureInput[],
  productId: number,
  occurredAt: Date,
  companyId: string,
  unitId: string,
) {
  const day = saoPauloDateKey(occurredAt);
  return structures
    .filter(
      (structure) =>
        !structure.deletedAt &&
        structure.aethosProductId === productId &&
        specificity(structure, companyId, unitId) >= 0,
    )
    .flatMap((structure) =>
      structure.versions
        .filter(
          (version) =>
            !version.deletedAt &&
            dateKey(version.validFrom) <= day &&
            (!version.validTo || dateKey(version.validTo) >= day),
        )
        .map((version) => ({
          version,
          specificity: specificity(structure, companyId, unitId),
        })),
    )
    .sort(
      (left, right) =>
        right.specificity - left.specificity ||
        right.version.version - left.version.version,
    )[0]?.version;
}

function fixed(value: Prisma.Decimal) {
  return value.toFixed(6);
}

function monthCovered(
  competence: string,
  dataset: RevenueCoverageInput['dataset'],
  coverage: RevenueCoverageInput[],
) {
  const monthStart = competence;
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);
  return coverage.some((run) => {
    const generatedDate = saoPauloDateKey(run.generatedAt);
    if (generatedDate < monthStart) return false;
    const requiredThrough = generatedDate < monthEnd ? generatedDate : monthEnd;
    return (
      run.dataset === dataset &&
      dateKey(run.scopeDateFrom) <= monthStart &&
      dateKey(run.scopeDateTo) >= requiredThrough
    );
  });
}

interface MutableRevenueType {
  factCount: number;
  amount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  hasFreightValue: boolean;
  orderFreightAmount: Prisma.Decimal;
  hasOrderFreightValue: boolean;
  quantityTon: Prisma.Decimal;
  hasQuantityTon: boolean;
  hasMissingQuantityTon: boolean;
  quantityOriginalByUnit: Map<string, Prisma.Decimal>;
  byClassification: Map<
    string,
    {
      factCount: number;
      amount: Prisma.Decimal;
      quantityTon: Prisma.Decimal;
      quantityComplete: boolean;
    }
  >;
}

function emptyRevenueType(): MutableRevenueType {
  return {
    factCount: 0,
    amount: new Prisma.Decimal(0),
    freightAmount: new Prisma.Decimal(0),
    hasFreightValue: false,
    orderFreightAmount: new Prisma.Decimal(0),
    hasOrderFreightValue: false,
    quantityTon: new Prisma.Decimal(0),
    hasQuantityTon: false,
    hasMissingQuantityTon: false,
    quantityOriginalByUnit: new Map(),
    byClassification: new Map(),
  };
}

function serializeRevenueType(value: MutableRevenueType) {
  return {
    factCount: value.factCount,
    amount: fixed(value.amount),
    freightAmount: value.hasFreightValue ? fixed(value.freightAmount) : null,
    orderFreightAmount: value.hasOrderFreightValue
      ? fixed(value.orderFreightAmount)
      : null,
    quantityTon:
      value.hasQuantityTon && !value.hasMissingQuantityTon
        ? fixed(value.quantityTon)
        : null,
    quantityOriginalByUnit: Object.fromEntries(
      [...value.quantityOriginalByUnit.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([unit, quantity]) => [unit, fixed(quantity)]),
    ),
    byClassification: Object.fromEntries(
      [...value.byClassification.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([classification, summary]) => [
          classification,
          {
            factCount: summary.factCount,
            amount: fixed(summary.amount),
            quantityTon: summary.quantityComplete
              ? fixed(summary.quantityTon)
              : null,
          },
        ]),
    ),
  };
}

export function calculateUsinaRevenueMonths(
  year: number,
  facts: RevenueFactInput[],
  coverage: RevenueCoverageInput[],
) {
  const months = new Map<
    string,
    { INTERNAL: MutableRevenueType; EXTERNAL: MutableRevenueType }
  >();

  for (const fact of facts) {
    const competence = monthKey(fact.competence);
    const current =
      months.get(competence) ||
      ({
        INTERNAL: emptyRevenueType(),
        EXTERNAL: emptyRevenueType(),
      } satisfies {
        INTERNAL: MutableRevenueType;
        EXTERNAL: MutableRevenueType;
      });
    const target = current[fact.revenueType];
    target.factCount += 1;
    target.amount = target.amount.plus(decimal(fact.amount));
    const classification = String(fact.classification || 'NAO_CLASSIFICADO')
      .trim()
      .toUpperCase();
    const category = target.byClassification.get(classification) || {
      factCount: 0,
      amount: new Prisma.Decimal(0),
      quantityTon: new Prisma.Decimal(0),
      quantityComplete: true,
    };
    category.factCount += 1;
    category.amount = category.amount.plus(decimal(fact.amount));
    if (fact.quantityTon === null || fact.quantityTon === undefined) {
      category.quantityComplete = false;
    } else {
      category.quantityTon = category.quantityTon.plus(
        decimal(fact.quantityTon),
      );
    }
    target.byClassification.set(classification, category);
    const unit = String(fact.quantityUnit || '')
      .trim()
      .toUpperCase();
    target.quantityOriginalByUnit.set(
      unit,
      (target.quantityOriginalByUnit.get(unit) || new Prisma.Decimal(0)).plus(
        decimal(fact.quantityOriginal),
      ),
    );
    if (fact.quantityTon === null || fact.quantityTon === undefined) {
      target.hasMissingQuantityTon = true;
    } else {
      target.hasQuantityTon = true;
      target.quantityTon = target.quantityTon.plus(decimal(fact.quantityTon));
    }
    if (fact.freightAmount !== null && fact.freightAmount !== undefined) {
      target.hasFreightValue = true;
      target.freightAmount = target.freightAmount.plus(
        decimal(fact.freightAmount),
      );
    }
    if (
      fact.orderFreightAmount !== null &&
      fact.orderFreightAmount !== undefined
    ) {
      target.hasOrderFreightValue = true;
      target.orderFreightAmount = target.orderFreightAmount.plus(
        decimal(fact.orderFreightAmount),
      );
    }
    months.set(competence, current);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const competence = new Date(Date.UTC(year, index, 1))
      .toISOString()
      .slice(0, 10);
    const current = months.get(competence) || {
      INTERNAL: emptyRevenueType(),
      EXTERNAL: emptyRevenueType(),
    };
    const internalCovered = monthCovered(
      competence,
      'INTERNAL_REVENUE',
      coverage,
    );
    const externalCovered = monthCovered(
      competence,
      'EXTERNAL_REVENUE',
      coverage,
    );
    const internal = internalCovered
      ? serializeRevenueType(current.INTERNAL)
      : null;
    const external = externalCovered
      ? serializeRevenueType(current.EXTERNAL)
      : null;
    return {
      competence,
      internal,
      external,
      totalAmount:
        internalCovered && externalCovered
          ? fixed(current.INTERNAL.amount.plus(current.EXTERNAL.amount))
          : null,
    };
  });
}

export function calculateUsinaProductionMonths(
  facts: ProductionFactInput[],
  structures: BomStructureInput[],
  companyId: string,
  unitId: string,
) {
  const months = new Map<string, MutableMonth>();

  for (const fact of facts) {
    if (
      !(USINA_RESULT_CLASSIFICATIONS as readonly string[]).includes(
        fact.classification,
      )
    ) {
      continue;
    }
    const key = monthKey(fact.competence);
    const current =
      months.get(key) ||
      ({
        total: new Prisma.Decimal(0),
        byClassification: emptyClassificationTotals(),
        materialConsumption: emptyMaterialTotals(),
        customerSuppliedCapConsumption: emptyMaterialTotals(),
        materialConsumptionDetails: new Map(),
        facts: 0,
        factsWithBom: 0,
        tonWithBom: new Prisma.Decimal(0),
        missingBomProductIds: new Set<number>(),
        missingBomProducts: new Map<number, string | null>(),
      } satisfies MutableMonth);
    const quantity = decimal(fact.quantityTon);
    current.total = current.total.plus(quantity);
    current.byClassification[fact.classification as Classification] =
      current.byClassification[fact.classification as Classification].plus(
        quantity,
      );
    current.facts += 1;

    const version = selectVersion(
      structures,
      fact.aethosProductId,
      fact.occurredAt,
      companyId,
      unitId,
    );
    if (!version) {
      current.missingBomProductIds.add(fact.aethosProductId);
      const description = String(fact.productDescription || '').trim() || null;
      if (
        !current.missingBomProducts.has(fact.aethosProductId) ||
        description !== null
      ) {
        current.missingBomProducts.set(fact.aethosProductId, description);
      }
      months.set(key, current);
      continue;
    }
    current.factsWithBom += 1;
    current.tonWithBom = current.tonWithBom.plus(quantity);
    for (const component of version.components) {
      if (component.deletedAt) continue;
      const materialCode =
        USINA_RESULT_MATERIALS[
          component.aethosMaterialId as keyof typeof USINA_RESULT_MATERIALS
        ];
      if (!materialCode) continue;
      const consumption = quantity
        .mul(decimal(component.consumptionPercent))
        .div(100);
      const detailKey = [
        fact.aethosProductId,
        version.version,
        component.aethosMaterialId,
      ].join('|');
      const detail = current.materialConsumptionDetails.get(detailKey) || {
        aethosProductId: fact.aethosProductId,
        productDescription:
          String(fact.productDescription || '').trim() || null,
        traceName: version.traceName || null,
        bomVersion: version.version,
        validFrom: dateKey(version.validFrom),
        validTo: version.validTo ? dateKey(version.validTo) : null,
        materialCode,
        aethosMaterialId: component.aethosMaterialId,
        consumptionPercent: decimal(component.consumptionPercent),
        productionFactCount: 0,
        productionTon: new Prisma.Decimal(0),
        consumptionTon: new Prisma.Decimal(0),
      };
      detail.productionFactCount += 1;
      detail.productionTon = detail.productionTon.plus(quantity);
      detail.consumptionTon = detail.consumptionTon.plus(consumption);
      current.materialConsumptionDetails.set(detailKey, detail);
      if (
        materialCode.startsWith('CAP_') &&
        isCcrCustomerSuppliedCapTrace(version.traceName)
      ) {
        current.customerSuppliedCapConsumption[materialCode] =
          current.customerSuppliedCapConsumption[materialCode].plus(
            consumption,
          );
        continue;
      }
      current.materialConsumption[materialCode] =
        current.materialConsumption[materialCode].plus(consumption);
    }
    months.set(key, current);
  }

  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([competence, month]) => ({
      competence,
      production: {
        factCount: month.facts,
        totalTon: fixed(month.total),
        byClassification: Object.fromEntries(
          Object.entries(month.byClassification).map(([code, value]) => [
            code,
            fixed(value),
          ]),
        ) as Record<Classification, string>,
      },
      bom: {
        factsWithBom: month.factsWithBom,
        tonWithBom: fixed(month.tonWithBom),
        coveragePercent: month.total.isZero()
          ? null
          : month.tonWithBom.div(month.total).mul(100).toFixed(4),
        missingProductIds: [...month.missingBomProductIds].sort(
          (left, right) => left - right,
        ),
        missingProducts: [...month.missingBomProducts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([aethosProductId, productDescription]) => ({
            aethosProductId,
            productDescription,
          })),
        materialConsumptionTon: Object.fromEntries(
          Object.entries(month.materialConsumption).map(([code, value]) => [
            code,
            fixed(value),
          ]),
        ) as Record<MaterialCode, string>,
        customerSuppliedCapConsumptionTon: Object.fromEntries(
          Object.entries(month.customerSuppliedCapConsumption).map(
            ([code, value]) => [code, fixed(value)],
          ),
        ) as Record<MaterialCode, string>,
        customerSuppliedCapRule: {
          traceName: 'CCR ALTO MÓDULO',
          reason: 'CAP fornecido pelo cliente CCR; não compõe o custo da JR.',
        },
        materialConsumptionDetails: [
          ...month.materialConsumptionDetails.values(),
        ]
          .sort(
            (left, right) =>
              left.materialCode.localeCompare(right.materialCode) ||
              left.aethosProductId - right.aethosProductId ||
              left.bomVersion - right.bomVersion,
          )
          .map((detail) => ({
            ...detail,
            consumptionPercent: fixed(detail.consumptionPercent),
            productionTon: fixed(detail.productionTon),
            consumptionTon: fixed(detail.consumptionTon),
          })),
      },
    }));
}
