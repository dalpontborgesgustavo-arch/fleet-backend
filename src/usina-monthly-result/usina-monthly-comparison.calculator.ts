import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;

type AggregateCode = 'PO_DE_PEDRA' | 'PEDRISCO' | 'BRITA_3_4';
type CapCode = 'CAP_50_70' | 'CAP_BORRACHA' | 'CAP_POLIMERO';

export interface UsinaMonthlyComparisonInput {
  competence: string;
  productionTon: DecimalInput | null;
  forecasts: Record<string, DecimalInput | null | undefined>;
  costs: Record<string, DecimalInput | null | undefined>;
  aggregatePrices?: Partial<
    Record<AggregateCode, { totalUnitCostPerM3?: DecimalInput | null }>
  > | null;
  aggregateCosts?: Partial<
    Record<AggregateCode, { totalCost?: DecimalInput | null }>
  > | null;
  productionByCapClass?: Partial<Record<CapCode, DecimalInput | null>> | null;
  capPurchases?: Partial<
    Record<CapCode, { amount?: DecimalInput | null }>
  > | null;
  capConsumedCosts?: Partial<Record<CapCode, DecimalInput | null>> | null;
  maintenanceCumulative?: DecimalInput | null;
}

export const USINA_COMPARISON_ROWS = [
  {
    code: 'CAP_50_70',
    label: 'CAP 50/70',
    group: 'CAPS',
    sourceRow: 65,
    unit: 'R$/t produzida',
    forecastCode: 'CAP_50_70',
    capCode: 'CAP_50_70',
    actualType: 'CAP_PURCHASE_PER_PRODUCTION',
  },
  {
    code: 'CAP_BORRACHA',
    label: 'CAP Borracha',
    group: 'CAPS',
    sourceRow: 69,
    unit: 'R$/t produzida',
    forecastCode: 'CAP_BORRACHA',
    capCode: 'CAP_BORRACHA',
    actualType: 'CAP_PURCHASE_PER_PRODUCTION',
  },
  {
    code: 'CAP_POLIMERO',
    label: 'CAP Polímero',
    group: 'CAPS',
    sourceRow: 73,
    unit: 'R$/t produzida',
    forecastCode: 'CAP_POLIMERO',
    capCode: 'CAP_POLIMERO',
    actualType: 'CAP_PURCHASE_PER_PRODUCTION',
  },
  {
    code: 'PO_DE_PEDRA',
    label: 'Pó-de-pedra — custo unitário',
    group: 'BRITADOS',
    sourceRow: 80,
    unit: 'R$/m³',
    forecastCode: 'PO_DE_PEDRA',
    actualType: 'AGGREGATE_UNIT',
  },
  {
    code: 'PO_DE_PEDRA_POR_TON_PRODUZIDA',
    label: 'Pó-de-pedra — custo por tonelada produzida',
    group: 'BRITADOS',
    sourceRow: 82,
    unit: 'R$/t produzida',
    forecastCode: 'PO_DE_PEDRA_POR_TON_PRODUZIDA',
    aggregateCode: 'PO_DE_PEDRA',
    actualType: 'AGGREGATE_PER_PRODUCTION',
  },
  {
    code: 'PEDRISCO',
    label: 'Pedrisco — custo unitário',
    group: 'BRITADOS',
    sourceRow: 85,
    unit: 'R$/m³',
    forecastCode: 'PEDRISCO',
    actualType: 'AGGREGATE_UNIT',
  },
  {
    code: 'PEDRISCO_POR_TON_PRODUZIDA',
    label: 'Pedrisco — custo por tonelada produzida',
    group: 'BRITADOS',
    sourceRow: 87,
    unit: 'R$/t produzida',
    forecastCode: 'PEDRISCO_POR_TON_PRODUZIDA',
    aggregateCode: 'PEDRISCO',
    actualType: 'AGGREGATE_PER_PRODUCTION',
  },
  {
    code: 'BRITA_3_4',
    label: 'Brita 3/4 — custo unitário',
    group: 'BRITADOS',
    sourceRow: 90,
    unit: 'R$/m³',
    forecastCode: 'BRITA_3_4',
    actualType: 'AGGREGATE_UNIT',
  },
  {
    code: 'BRITA_3_4_POR_TON_PRODUZIDA',
    label: 'Brita 3/4 — custo por tonelada produzida',
    group: 'BRITADOS',
    sourceRow: 92,
    unit: 'R$/t produzida',
    forecastCode: 'BRITA_3_4_POR_TON_PRODUZIDA',
    aggregateCode: 'BRITA_3_4',
    actualType: 'AGGREGATE_PER_PRODUCTION',
  },
  {
    code: 'OLEO_RESIVALE',
    label: 'Óleo Resivale',
    group: 'TERMICO_DIESEL_CAL_DOP',
    sourceRow: 95,
    unit: 'R$/t produzida',
    forecastCode: 'OLEO_RESIVALE',
    costCode: 'OLEO_RESIVALE',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'DIESEL',
    label: 'Diesel da Usina',
    group: 'TERMICO_DIESEL_CAL_DOP',
    sourceRow: 99,
    unit: 'R$/t produzida',
    forecastCode: 'DIESEL',
    costCode: 'DIESEL_USINA',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'CAL_CH1',
    label: 'Cal CH1',
    group: 'TERMICO_DIESEL_CAL_DOP',
    sourceRow: 103,
    unit: 'R$/t produzida',
    forecastCode: 'CAL_CH1',
    costCode: 'CAL_CH1',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'DOP',
    label: 'DOP',
    group: 'TERMICO_DIESEL_CAL_DOP',
    sourceRow: 107,
    unit: 'R$/t produzida',
    forecastCode: 'DOP',
    costCode: 'DOP',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'MAO_DE_OBRA',
    label: 'Mão de obra',
    group: 'MO_CARREGADEIRA_ENERGIA',
    sourceRow: 111,
    unit: 'R$/t produzida',
    forecastCode: 'MAO_DE_OBRA',
    costCode: 'MAO_DE_OBRA',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'CARREGADEIRA',
    label: 'Carregadeiras',
    group: 'MO_CARREGADEIRA_ENERGIA',
    sourceRow: 115,
    unit: 'R$/t produzida',
    forecastCode: 'CARREGADEIRA',
    costCode: 'CARREGADEIRAS',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'ENERGIA_ELETRICA',
    label: 'Energia elétrica',
    group: 'MO_CARREGADEIRA_ENERGIA',
    sourceRow: 119,
    unit: 'R$/t produzida',
    forecastCode: 'ENERGIA_ELETRICA',
    costCode: 'ENERGIA',
    actualType: 'COST_PER_PRODUCTION',
  },
  {
    code: 'MANUTENCAO',
    label: 'Manutenção da Usina',
    group: 'MANUTENCAO',
    sourceRow: 123,
    unit: 'R$/t produzida',
    forecastCode: 'MANUTENCAO',
    costCode: 'MANUTENCAO_USINA',
    actualType: 'COST_PER_PRODUCTION',
  },
] as const;

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function fixed(value: Prisma.Decimal | null) {
  return value === null ? null : value.toFixed(6);
}

function divide(
  value: DecimalInput | null | undefined,
  production: DecimalInput | null,
) {
  if (value === null || value === undefined || production === null) return null;
  const denominator = decimal(production);
  return denominator.isZero() ? null : decimal(value).div(denominator);
}

function strictSum(values: Array<DecimalInput | null | undefined>) {
  let total = new Prisma.Decimal(0);
  for (const value of values) {
    if (value === null || value === undefined) return null;
    total = total.plus(decimal(value));
  }
  return total;
}

function capProduction(input: UsinaMonthlyComparisonInput) {
  if (!input.productionByCapClass) return null;
  return strictSum(
    (['CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO'] as const).map(
      (code) => input.productionByCapClass?.[code],
    ),
  );
}

function weightedCapForecast(input: UsinaMonthlyComparisonInput) {
  if (!input.productionByCapClass) return null;
  let production = new Prisma.Decimal(0);
  let amount = new Prisma.Decimal(0);
  for (const code of [
    'CAP_50_70',
    'CAP_BORRACHA',
    'CAP_POLIMERO',
  ] as const) {
    const classProductionValue = input.productionByCapClass[code];
    if (classProductionValue === null || classProductionValue === undefined)
      return null;
    const classProduction = decimal(classProductionValue);
    if (classProduction.isZero()) continue;
    const forecast = input.forecasts[code];
    if (forecast === null || forecast === undefined) return null;
    production = production.plus(classProduction);
    amount = amount.plus(classProduction.mul(decimal(forecast)));
  }
  return production.isZero() ? null : amount.div(production);
}

function classification(
  forecast: Prisma.Decimal | null,
  actual: Prisma.Decimal | null,
  impact: Prisma.Decimal | null,
) {
  if (forecast === null || actual === null) return 'PENDING' as const;
  if (impact !== null && impact.abs().lte(100)) return 'GREEN' as const;
  if (forecast.isZero())
    return actual.isZero() ? ('GREEN' as const) : ('RED' as const);
  const percent = actual.minus(forecast).abs().div(forecast.abs()).mul(100);
  if (percent.lte(2)) return 'GREEN' as const;
  if (percent.lte(5)) return 'YELLOW' as const;
  return 'RED' as const;
}

export function calculateUsinaMonthlyComparison(
  input: UsinaMonthlyComparisonInput,
) {
  return USINA_COMPARISON_ROWS.map((definition) => {
    const forecastValue = input.forecasts[definition.forecastCode];
    const forecast =
      forecastValue === null || forecastValue === undefined
        ? null
        : decimal(forecastValue);
    const aggregateCode =
      'aggregateCode' in definition
        ? definition.aggregateCode
        : definition.code;
    let actual: Prisma.Decimal | null = null;
    let impactProduction = input.productionTon;
    if (definition.actualType === 'CAP_PURCHASE_PER_PRODUCTION') {
      const capCode = definition.capCode as CapCode;
      const classProduction = input.productionByCapClass?.[capCode];
      impactProduction = classProduction ?? null;
      actual = divide(
        input.capPurchases?.[capCode]?.amount,
        impactProduction,
      );
    } else if (definition.actualType === 'AGGREGATE_UNIT') {
      const value =
        input.aggregatePrices?.[aggregateCode as AggregateCode]
          ?.totalUnitCostPerM3;
      actual = value === null || value === undefined ? null : decimal(value);
    } else if (definition.actualType === 'AGGREGATE_PER_PRODUCTION') {
      actual = divide(
        input.aggregateCosts?.[aggregateCode as AggregateCode]?.totalCost,
        input.productionTon,
      );
    } else {
      const costCode = 'costCode' in definition ? definition.costCode : null;
      actual = divide(
        costCode ? input.costs[costCode] : null,
        input.productionTon,
      );
    }
    const difference =
      forecast === null || actual === null ? null : forecast.minus(actual);
    const impact =
      difference === null ||
      impactProduction === null ||
      definition.unit !== 'R$/t produzida'
        ? null
        : difference.mul(decimal(impactProduction));
    const differencePercent =
      difference === null || forecast === null || forecast.isZero()
        ? forecast?.isZero() && actual?.isZero()
          ? new Prisma.Decimal(0)
          : null
        : actual!.minus(forecast).abs().div(forecast.abs()).mul(100);
    return {
      ...definition,
      forecast: fixed(forecast),
      actual: fixed(actual),
      difference: fixed(difference),
      differencePercent: fixed(differencePercent),
      impact: fixed(impact),
      classification: classification(forecast, actual, impact),
      productionTon:
        definition.unit === 'R$/t produzida' && impactProduction !== null
          ? fixed(decimal(impactProduction))
          : null,
      formula:
        definition.actualType === 'CAP_PURCHASE_PER_PRODUCTION'
          ? 'realizado = custo documental comprado da família ÷ produção da família; diferença = previsto - realizado; impacto = diferença × produção da família'
          : definition.actualType === 'AGGREGATE_UNIT'
          ? 'realizado = (custo unitário do material + frete) convertido para R$/m³'
          : 'realizado = custo da rubrica ÷ produção; diferença = previsto - realizado; impacto = diferença × produção',
    };
  });
}

export function calculateUsinaMonthlyComparisonSummary(
  input: UsinaMonthlyComparisonInput,
  rows: ReturnType<typeof calculateUsinaMonthlyComparison>,
) {
  const capProductionTon = capProduction(input);
  const capPurchasedAmount = input.capPurchases
    ? strictSum(
        (['CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO'] as const).map(
          (code) => input.capPurchases?.[code]?.amount,
        ),
      )
    : null;
  const capConsumedAmount = input.capConsumedCosts
    ? strictSum(
        (['CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO'] as const).map(
          (code) => input.capConsumedCosts?.[code],
        ),
      )
    : null;
  const impactRows = rows.filter(
    (row) => row.unit === 'R$/t produzida',
  );
  const sumRows = (codes: string[], field: 'forecast' | 'actual') =>
    strictSum(
      codes.map((code) => rows.find((row) => row.code === code)?.[field]),
    );
  const aggregateCodes = [
    'PO_DE_PEDRA_POR_TON_PRODUZIDA',
    'PEDRISCO_POR_TON_PRODUZIDA',
    'BRITA_3_4_POR_TON_PRODUZIDA',
  ];
  const thermalCodes = ['OLEO_RESIVALE', 'DIESEL', 'CAL_CH1', 'DOP'];
  const laborCodes = ['MAO_DE_OBRA', 'CARREGADEIRA', 'ENERGIA_ELETRICA'];
  return {
    totalCaps: {
      sourceRows: '77:79',
      productionTon: fixed(capProductionTon),
      forecast: fixed(weightedCapForecast(input)),
      purchased: fixed(divide(capPurchasedAmount, capProductionTon)),
      consumed: fixed(divide(capConsumedAmount, capProductionTon)),
      purchasedAmount: fixed(capPurchasedAmount),
      consumedAmount: fixed(capConsumedAmount),
      excludesHighModulus: true,
    },
    totalDifferenceImpact: {
      sourceRow: 127,
      value: fixed(strictSum(impactRows.map((row) => row.impact))),
      componentCount: impactRows.length,
    },
    aggregates: {
      sourceRows: '129:130',
      forecast: fixed(sumRows(aggregateCodes, 'forecast')),
      actual: fixed(sumRows(aggregateCodes, 'actual')),
    },
    thermalDieselCalDop: {
      sourceRows: '131:132',
      forecast: fixed(sumRows(thermalCodes, 'forecast')),
      actual: fixed(sumRows(thermalCodes, 'actual')),
    },
    laborLoadersEnergy: {
      sourceRows: '133:134',
      forecast: fixed(sumRows(laborCodes, 'forecast')),
      actual: fixed(sumRows(laborCodes, 'actual')),
    },
    maintenanceCumulative: {
      sourceRow: 135,
      value:
        input.maintenanceCumulative === null ||
        input.maintenanceCumulative === undefined
          ? null
          : fixed(decimal(input.maintenanceCumulative)),
      periodStart: '2020-08-01',
    },
  };
}
