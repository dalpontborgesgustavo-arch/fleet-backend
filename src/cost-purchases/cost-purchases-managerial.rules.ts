import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

export const COST_PURCHASE_MANAGERIAL_LINES = [
  { code: 'USINA', label: 'Conta Usina', kind: 'MONEY' },
  { code: 'OLEO_RESIVALE', label: 'Conta - Óleo Queima JR', kind: 'MONEY' },
  { code: 'ANTIADERENTE_REMOTIN', label: 'Conta Anti Aderente', kind: 'MONEY' },
  {
    code: 'PRODUTOS_ASFALTICOS',
    label: 'Conta Produtos Asfálticos',
    kind: 'MONEY',
  },
  { code: 'DIESEL', label: 'Conta Diesel', kind: 'MONEY' },
  {
    code: 'DIESEL_LITROS',
    label: 'Quantidade em Litros (Diesel)',
    kind: 'QUANTITY',
  },
  {
    code: 'DIESEL_PRECO_MEDIO',
    label: 'Preço Médio/Mês (Diesel)',
    kind: 'UNIT_PRICE',
  },
  { code: 'GASOLINA', label: 'Conta Gasolina', kind: 'MONEY' },
  {
    code: 'GASOLINA_LITROS',
    label: 'Quantidade em Litros (Gasolina)',
    kind: 'QUANTITY',
  },
  {
    code: 'GASOLINA_PRECO_MEDIO',
    label: 'Preço Médio/Mês (Gasolina)',
    kind: 'UNIT_PRICE',
  },
  { code: 'MANUTENCAO', label: 'Despesa Manutenção Realizado', kind: 'MONEY' },
  { code: 'TOTAL', label: 'Total das Contas', kind: 'MONEY' },
] as const;

export type ManagerialCategory =
  | 'CAL'
  | 'OLEO_RESIVALE'
  | 'ANTIADERENTE_REMOTIN'
  | 'CAP'
  | 'RR'
  | 'SEMI_IMPRIMA'
  | 'DIESEL';

const ASPHALT_CATEGORIES = new Set<ManagerialCategory>([
  'CAP',
  'RR',
  'SEMI_IMPRIMA',
]);
const INELIGIBLE_ASPHALT_ORDER_STATUSES = new Set(['I', 'C']);

export function managerialEntryIsEligible(input: {
  category: ManagerialCategory;
  sourceOrderStatus: string | null;
}) {
  return !(
    ASPHALT_CATEGORIES.has(input.category) &&
    input.sourceOrderStatus !== null &&
    INELIGIBLE_ASPHALT_ORDER_STATUSES.has(input.sourceOrderStatus)
  );
}

export type ManagerialMonthInput = {
  entryCovered: boolean;
  entryValues: Partial<Record<ManagerialCategory, Prisma.Decimal>>;
  entryQuantities: Partial<Record<ManagerialCategory, Prisma.Decimal>>;
  dopCovered: boolean;
  dop: Prisma.Decimal;
  gasolineCovered: boolean;
  gasoline: Prisma.Decimal;
  gasolineLiters: Prisma.Decimal;
  maintenanceCovered: boolean;
  maintenance: Prisma.Decimal;
};

const ALL_ENTRY_CATEGORIES: ManagerialCategory[] = [
  'CAL',
  'OLEO_RESIVALE',
  'ANTIADERENTE_REMOTIN',
  'CAP',
  'RR',
  'SEMI_IMPRIMA',
  'DIESEL',
];

export function managerialEntryCategories(code: string): ManagerialCategory[] {
  switch (code) {
    case 'USINA':
      return ['CAL'];
    case 'OLEO_RESIVALE':
      return ['OLEO_RESIVALE'];
    case 'ANTIADERENTE_REMOTIN':
      return ['ANTIADERENTE_REMOTIN'];
    case 'PRODUTOS_ASFALTICOS':
      return ['CAP', 'RR', 'SEMI_IMPRIMA'];
    case 'DIESEL':
    case 'DIESEL_LITROS':
    case 'DIESEL_PRECO_MEDIO':
      return ['DIESEL'];
    case 'TOTAL':
      return ALL_ENTRY_CATEGORIES;
    default:
      return [];
  }
}

export function managerialMemoryFormula(code: string) {
  switch (code) {
    case 'USINA':
      return 'CAL + DOP sem documentos duplicados';
    case 'PRODUTOS_ASFALTICOS':
      return 'CAP + RR + SEMI_IMPRIMA; exclui ordens finalizadas ou canceladas';
    case 'DIESEL_PRECO_MEDIO':
      return 'valor de diesel / litros de diesel';
    case 'GASOLINA_PRECO_MEDIO':
      return 'valor de gasolina / litros de gasolina';
    case 'MANUTENCAO':
      return 'despesaTotalElegivel - abastecimentoTotalElegivel';
    case 'TOTAL':
      return 'soma das sete linhas monetárias';
    default:
      return null;
  }
}

function fixed(value: Prisma.Decimal | null, scale = 2) {
  return value === null ? null : value.toFixed(scale);
}

function entry(input: ManagerialMonthInput, category: ManagerialCategory) {
  return input.entryCovered ? input.entryValues[category] || ZERO : null;
}

function quantity(input: ManagerialMonthInput, category: ManagerialCategory) {
  return input.entryCovered ? input.entryQuantities[category] || ZERO : null;
}

function sumNullable(values: Array<Prisma.Decimal | null>) {
  if (values.some((value) => value === null)) return null;
  return values.reduce<Prisma.Decimal>(
    (sum, value) => sum.plus(value || ZERO),
    ZERO,
  );
}

function ratio(value: Prisma.Decimal | null, divisor: Prisma.Decimal | null) {
  if (value === null || divisor === null || divisor.eq(0)) return null;
  return value.div(divisor);
}

export function calculateManagerialMonth(input: ManagerialMonthInput) {
  const cal = entry(input, 'CAL');
  const oil = entry(input, 'OLEO_RESIVALE');
  const anti = entry(input, 'ANTIADERENTE_REMOTIN');
  const cap = entry(input, 'CAP');
  const rr = entry(input, 'RR');
  const semi = entry(input, 'SEMI_IMPRIMA');
  const diesel = entry(input, 'DIESEL');
  const dieselLiters = quantity(input, 'DIESEL');
  const dop = input.dopCovered ? input.dop : null;
  const gasoline = input.gasolineCovered ? input.gasoline : null;
  const gasolineLiters = input.gasolineCovered ? input.gasolineLiters : null;
  const maintenance = input.maintenanceCovered ? input.maintenance : null;
  const usina = sumNullable([cal, dop]);
  const asphalt = sumNullable([cap, rr, semi]);
  const total = sumNullable([
    usina,
    oil,
    anti,
    asphalt,
    diesel,
    gasoline,
    maintenance,
  ]);
  const values: Record<string, string | null> = {
    USINA: fixed(usina),
    OLEO_RESIVALE: fixed(oil),
    ANTIADERENTE_REMOTIN: fixed(anti),
    PRODUTOS_ASFALTICOS: fixed(asphalt),
    DIESEL: fixed(diesel),
    DIESEL_LITROS: fixed(dieselLiters, 3),
    DIESEL_PRECO_MEDIO: fixed(ratio(diesel, dieselLiters), 6),
    GASOLINA: fixed(gasoline),
    GASOLINA_LITROS: fixed(gasolineLiters, 3),
    GASOLINA_PRECO_MEDIO: fixed(ratio(gasoline, gasolineLiters), 6),
    MANUTENCAO: fixed(maintenance),
    TOTAL: fixed(total),
  };
  return { values };
}

export function maintenanceIdentity(input: {
  grossExpense: Prisma.Decimal;
  fuelTotal: Prisma.Decimal;
  gasoline: Prisma.Decimal;
  maintenance: Prisma.Decimal;
}) {
  const otherFuel = input.fuelTotal.minus(input.gasoline);
  const reconstructed = input.maintenance.plus(input.gasoline).plus(otherFuel);
  return {
    grossExpense: fixed(input.grossExpense),
    gasoline: fixed(input.gasoline),
    otherFuel: fixed(otherFuel),
    laborIncludedInBase: '0.00',
    maintenance: fixed(input.maintenance),
    reconstructedGrossExpense: fixed(reconstructed),
    difference: fixed(input.grossExpense.minus(reconstructed)),
  };
}
