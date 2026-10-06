import { Prisma } from '@prisma/client';
import {
  USINA_ACTUAL_COST_LINES,
  UsinaActualCostLine,
} from './usina-monthly-financial.calculator';

type DecimalInput = Prisma.Decimal | string | number;

const CAP_PURCHASE_CODES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
  'CAP_ALTO_MODULO',
] as const;

const CAP_BUSINESS_CLASSES = [
  'CAP_50_70',
  'CAP_BORRACHA',
  'CAP_POLIMERO',
] as const;

export const USINA_CAP_PHYSICAL_TO_BUSINESS_CLASS = {
  CAP_50_70: 'CAP_50_70',
  CAP_ALTO_MODULO: 'CAP_POLIMERO',
  CAP_BORRACHA: 'CAP_BORRACHA',
  CAP_POLIMERO: 'CAP_POLIMERO',
} as const;

const AGGREGATE_CODES = ['PO_DE_PEDRA', 'PEDRISCO', 'BRITA_3_4'] as const;

type CapCode = (typeof CAP_PURCHASE_CODES)[number];
type CapBusinessClass = (typeof CAP_BUSINESS_CLASSES)[number];

export interface UsinaMonthlyIndicatorInput {
  competence: string;
  productionTon: DecimalInput | null;
  productionByCapClass: Record<CapBusinessClass, DecimalInput> | null;
  materialConsumptionTon: Record<string, DecimalInput> | null;
  forecasts: Record<string, DecimalInput | null | undefined>;
  costs: Partial<Record<UsinaActualCostLine, DecimalInput | null>>;
  resultRate: DecimalInput | null;
  targetRate: DecimalInput | null;
  cumulativeResultRate: DecimalInput | null;
  capPurchases: {
    unitCost: DecimalInput | null;
    byMaterial: Record<
      CapCode,
      { quantityTon: DecimalInput | null; amount: DecimalInput | null }
    >;
  } | null;
}

export interface UsinaMonthlyIndicatorOptions {
  maintenanceCumulativeBase?: {
    maintenanceAmount: DecimalInput;
    productionTon: DecimalInput;
  };
}

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function fixed(value: Prisma.Decimal | null) {
  return value === null ? null : value.toFixed(6);
}

function divide(
  numerator: Prisma.Decimal | null,
  denominator: DecimalInput | null,
) {
  if (numerator === null || denominator === null) return null;
  const divisor = decimal(denominator);
  return divisor.isZero() ? null : numerator.div(divisor);
}

function strictCostSum(
  costs: UsinaMonthlyIndicatorInput['costs'],
  codes: UsinaActualCostLine[],
) {
  let total = new Prisma.Decimal(0);
  for (const code of codes) {
    const value = costs[code];
    if (value === null || value === undefined) return null;
    total = total.plus(decimal(value));
  }
  return total;
}

function strictForecastSum(
  forecasts: UsinaMonthlyIndicatorInput['forecasts'],
  codes: string[],
) {
  let total = new Prisma.Decimal(0);
  for (const code of codes) {
    const value = forecasts[code];
    if (value === null || value === undefined) return null;
    total = total.plus(decimal(value));
  }
  return total;
}

function aggregateForecastPerProductionTon(input: UsinaMonthlyIndicatorInput) {
  const directCodes = [
    'PO_DE_PEDRA_POR_TON_PRODUZIDA',
    'PEDRISCO_POR_TON_PRODUZIDA',
    'BRITA_3_4_POR_TON_PRODUZIDA',
  ];
  const hasAnyDirectForecast = directCodes.some(
    (code) =>
      input.forecasts[code] !== null && input.forecasts[code] !== undefined,
  );
  return hasAnyDirectForecast
    ? strictForecastSum(input.forecasts, directCodes)
    : forecastConsumptionPerProductionTon(input, AGGREGATE_CODES);
}

function forecastConsumptionPerProductionTon(
  input: UsinaMonthlyIndicatorInput,
  codes: readonly string[],
) {
  if (input.materialConsumptionTon === null) return null;
  let total = new Prisma.Decimal(0);
  for (const code of codes) {
    const consumption = decimal(input.materialConsumptionTon[code] ?? 0);
    if (consumption.isZero()) continue;
    const forecast = input.forecasts[code];
    if (forecast === null || forecast === undefined) return null;
    total = total.plus(consumption.mul(decimal(forecast)));
  }
  return divide(total, input.productionTon);
}

function capProductionTon(input: UsinaMonthlyIndicatorInput) {
  if (!input.productionByCapClass) return null;
  return CAP_BUSINESS_CLASSES.reduce(
    (total, code) => total.plus(decimal(input.productionByCapClass![code])),
    new Prisma.Decimal(0),
  );
}

function capForecastPerProductionTon(input: UsinaMonthlyIndicatorInput) {
  if (!input.productionByCapClass) return null;
  let production = new Prisma.Decimal(0);
  let amount = new Prisma.Decimal(0);
  for (const code of CAP_BUSINESS_CLASSES) {
    const classProduction = decimal(input.productionByCapClass[code]);
    if (classProduction.isZero()) continue;
    const forecast = input.forecasts[code];
    if (forecast === null || forecast === undefined) return null;
    production = production.plus(classProduction);
    amount = amount.plus(classProduction.mul(decimal(forecast)));
  }
  return production.isZero() ? null : amount.div(production);
}

function strictCapBusinessSum(
  valueForPhysicalClass: (code: CapCode) => DecimalInput | null | undefined,
) {
  const byBusinessClass = Object.fromEntries(
    CAP_BUSINESS_CLASSES.map((code) => [code, new Prisma.Decimal(0)]),
  ) as Record<CapBusinessClass, Prisma.Decimal>;
  for (const physicalClass of CAP_PURCHASE_CODES) {
    const value = valueForPhysicalClass(physicalClass);
    if (value === null || value === undefined) return null;
    const businessClass = USINA_CAP_PHYSICAL_TO_BUSINESS_CLASS[physicalClass];
    byBusinessClass[businessClass] = byBusinessClass[businessClass].plus(
      decimal(value),
    );
  }
  return CAP_BUSINESS_CLASSES.reduce(
    (total, code) => total.plus(byBusinessClass[code]),
    new Prisma.Decimal(0),
  );
}

function capPurchaseAmount(input: UsinaMonthlyIndicatorInput) {
  if (!input.capPurchases) return null;
  return strictCapBusinessSum(
    (code) => input.capPurchases!.byMaterial[code]?.amount,
  );
}

export function calculateUsinaMonthlyIndicators(
  inputs: UsinaMonthlyIndicatorInput[],
  options: UsinaMonthlyIndicatorOptions = {},
) {
  let cumulativeMaintenance = options.maintenanceCumulativeBase
    ? decimal(options.maintenanceCumulativeBase.maintenanceAmount)
    : new Prisma.Decimal(0);
  let cumulativeProduction = options.maintenanceCumulativeBase
    ? decimal(options.maintenanceCumulativeBase.productionTon)
    : new Prisma.Decimal(0);
  let maintenanceCumulativeComplete = true;

  return inputs.map((input) => {
    const production =
      input.productionTon === null ? null : decimal(input.productionTon);
    const productionWithCap = capProductionTon(input);
    const maintenance = input.costs.MANUTENCAO_USINA;
    if (
      production === null ||
      maintenance === null ||
      maintenance === undefined
    ) {
      maintenanceCumulativeComplete = false;
    } else if (maintenanceCumulativeComplete) {
      cumulativeProduction = cumulativeProduction.plus(production);
      cumulativeMaintenance = cumulativeMaintenance.plus(decimal(maintenance));
    }
    const maintenanceCumulative = maintenanceCumulativeComplete
      ? divide(cumulativeMaintenance, cumulativeProduction)
      : null;

    return {
      competence: input.competence,
      productionTon: fixed(production),
      margin: {
        actualRate:
          input.resultRate === null ? null : fixed(decimal(input.resultRate)),
        forecastRate:
          input.targetRate === null ? null : fixed(decimal(input.targetRate)),
        cumulativeRate:
          input.cumulativeResultRate === null
            ? null
            : fixed(decimal(input.cumulativeResultRate)),
      },
      capPurchasePerTon: {
        actual: fixed(divide(capPurchaseAmount(input), productionWithCap)),
        forecast: fixed(capForecastPerProductionTon(input)),
      },
      capConsumptionPerTon: {
        actual: fixed(
          divide(
            strictCapBusinessSum((code) => input.costs[code]),
            productionWithCap,
          ),
        ),
        forecast: fixed(capForecastPerProductionTon(input)),
      },
      aggregatesPerTon: {
        actual: fixed(
          divide(
            strictCostSum(input.costs, ['BRITADOS', 'FRETE_BRITADOS']),
            input.productionTon,
          ),
        ),
        forecast: fixed(aggregateForecastPerProductionTon(input)),
      },
      thermalDieselCalDopPerTon: {
        actual: fixed(
          divide(
            strictCostSum(input.costs, [
              'OLEO_RESIVALE',
              'DIESEL_USINA',
              'CAL_CH1',
              'DOP',
            ]),
            input.productionTon,
          ),
        ),
        forecast: fixed(
          strictForecastSum(input.forecasts, [
            'OLEO_RESIVALE',
            'DIESEL',
            'CAL_CH1',
            'DOP',
          ]),
        ),
      },
      laborLoadersEnergyPerTon: {
        actual: fixed(
          divide(
            strictCostSum(input.costs, [
              'MAO_DE_OBRA',
              'CARREGADEIRAS',
              'ENERGIA',
            ]),
            input.productionTon,
          ),
        ),
        forecast: fixed(
          strictForecastSum(input.forecasts, [
            'MAO_DE_OBRA',
            'CARREGADEIRA',
            'ENERGIA_ELETRICA',
          ]),
        ),
      },
      maintenancePerTon: {
        actual: fixed(
          divide(
            strictCostSum(input.costs, ['MANUTENCAO_USINA']),
            input.productionTon,
          ),
        ),
        forecast: fixed(strictForecastSum(input.forecasts, ['MANUTENCAO'])),
        cumulative: fixed(maintenanceCumulative),
      },
    };
  });
}
