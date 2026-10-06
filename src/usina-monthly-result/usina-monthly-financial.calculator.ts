import { Prisma } from '@prisma/client';

export const USINA_ACTUAL_COST_LINES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
  'CAP_ALTO_MODULO',
  'BRITADOS',
  'FRETE_BRITADOS',
  'DIESEL_USINA',
  'CARREGADEIRAS',
  'VEICULO_USINA',
  'MANUTENCAO_USINA',
  'OLEO_RESIVALE',
  'CAL_CH1',
  'DOP',
  'MATERIAL_EXPEDIENTE',
  'ENERGIA',
  'MAO_DE_OBRA',
  'DEPRECIACAO_USINA',
  'IMPOSTO_VENDA',
] as const;

export type UsinaActualCostLine = (typeof USINA_ACTUAL_COST_LINES)[number];
export type DecimalInput = Prisma.Decimal | string | number;

export interface UsinaFinancialMonthInput {
  competence: string;
  internalRevenue: DecimalInput | null;
  externalRevenue: DecimalInput | null;
  costs: Partial<Record<UsinaActualCostLine, DecimalInput | null>>;
}

export function calculateSalesTaxOnExternalRevenue(
  externalRevenue: DecimalInput | null,
  taxRate: DecimalInput | null,
) {
  if (externalRevenue === null || taxRate === null) return null;
  return fixed(decimal(externalRevenue).mul(decimal(taxRate)));
}

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function fixed(value: Prisma.Decimal) {
  return value.toFixed(6);
}

function strictCostTotal(
  costs: Partial<Record<UsinaActualCostLine, DecimalInput | null>>,
) {
  let total = new Prisma.Decimal(0);
  for (const line of USINA_ACTUAL_COST_LINES) {
    const value = costs[line];
    if (value === null || value === undefined) return null;
    total = total.plus(decimal(value));
  }
  return total;
}

export function calculateUsinaFinancialMonths(
  inputs: UsinaFinancialMonthInput[],
) {
  let cumulativeRevenue = new Prisma.Decimal(0);
  let cumulativeCost = new Prisma.Decimal(0);
  let cumulativeComplete = true;

  return inputs.map((input) => {
    const revenueTotal =
      input.internalRevenue === null || input.externalRevenue === null
        ? null
        : decimal(input.internalRevenue).plus(decimal(input.externalRevenue));
    const costTotal = strictCostTotal(input.costs);
    const result =
      revenueTotal === null || costTotal === null
        ? null
        : revenueTotal.minus(costTotal);
    const resultRate =
      result === null || costTotal === null || costTotal.isZero()
        ? null
        : result.div(costTotal);

    if (revenueTotal === null || costTotal === null) {
      cumulativeComplete = false;
    } else if (cumulativeComplete) {
      cumulativeRevenue = cumulativeRevenue.plus(revenueTotal);
      cumulativeCost = cumulativeCost.plus(costTotal);
    }

    const cumulativeResult = cumulativeComplete
      ? cumulativeRevenue.minus(cumulativeCost)
      : null;
    const cumulativeRate =
      cumulativeResult === null || cumulativeCost.isZero()
        ? null
        : cumulativeResult.div(cumulativeCost);

    return {
      competence: input.competence,
      revenue: {
        internal:
          input.internalRevenue === null
            ? null
            : fixed(decimal(input.internalRevenue)),
        external:
          input.externalRevenue === null
            ? null
            : fixed(decimal(input.externalRevenue)),
        total: revenueTotal === null ? null : fixed(revenueTotal),
      },
      costs: {
        values: Object.fromEntries(
          USINA_ACTUAL_COST_LINES.map((line) => {
            const value = input.costs[line];
            return [
              line,
              value === null || value === undefined
                ? null
                : fixed(decimal(value)),
            ];
          }),
        ) as Record<UsinaActualCostLine, string | null>,
        total: costTotal === null ? null : fixed(costTotal),
      },
      result: result === null ? null : fixed(result),
      resultRate: resultRate === null ? null : resultRate.toFixed(6),
      cumulative: {
        revenue: cumulativeComplete ? fixed(cumulativeRevenue) : null,
        cost: cumulativeComplete ? fixed(cumulativeCost) : null,
        result: cumulativeResult === null ? null : fixed(cumulativeResult),
        resultRate: cumulativeRate === null ? null : cumulativeRate.toFixed(6),
      },
    };
  });
}
