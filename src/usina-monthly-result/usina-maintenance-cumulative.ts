import { Prisma } from '@prisma/client';
import { classifyUsinaVehicleExpense } from '../common/usina-maintenance-classification';

type DecimalInput = Prisma.Decimal | string | number;

interface ProductionFact {
  competence: Date;
  quantityTon: DecimalInput;
}

interface OperationalFact {
  dataset: string;
  competence: Date;
  amount: DecimalInput;
  aethosVehicleId?: number | null;
  accountPlanDescription?: string | null;
}

const EXCEL_HISTORY_START = '2020-08-01';
const JR_CONTINUATION_START = new Date(Date.UTC(2026, 0, 1));

const EXCEL_BASE_THROUGH_2024 = {
  maintenanceAmount: '1976854.2624214895',
  productionTon: '460723.25',
  periodEnd: '2024-12-31',
  competences: 53,
};

/**
 * Fechamento auditado da linha 135 da aba Usina (C:BO) do arquivo esse.xlsx.
 * A fórmula da planilha soma manutenção (linha 25) e produção (linha 9)
 * continuamente de ago/2020 a dez/2025.
 */
export const USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025 = {
  maintenanceAmount: '2837071.8224214895',
  productionTon: '659797.44',
  cumulativePerTon: '4.299913352833696',
  periodStart: EXCEL_HISTORY_START,
  periodEnd: '2025-12-31',
  competences: 65,
  source: 'esse.xlsx | Usina!C135:BO135',
} as const;

export function maintenanceCumulativeQueryStart(year: number) {
  return year > 2026 ? JR_CONTINUATION_START : new Date(Date.UTC(year, 0, 1));
}

export function buildMaintenanceCumulativeBase(
  year: number,
  productionFacts: ProductionFact[],
  operationalFacts: OperationalFact[],
) {
  if (year < 2025) return null;

  if (year === 2025) {
    return {
      ...EXCEL_BASE_THROUGH_2024,
      periodStart: EXCEL_HISTORY_START,
      source: 'esse.xlsx | Usina!C135:BD135',
    };
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const beforeSelectedYear = (competence: Date) =>
    competence >= JR_CONTINUATION_START && competence < yearStart;
  const maintenanceAmount = operationalFacts
    .filter(
      (fact) =>
        fact.dataset === 'VEHICLE_EXPENSES' &&
        beforeSelectedYear(fact.competence) &&
        classifyUsinaVehicleExpense(
          fact.aethosVehicleId,
          fact.accountPlanDescription,
        ) === 'MANUTENCAO_USINA',
    )
    .reduce(
      (total, fact) => total.plus(fact.amount),
      new Prisma.Decimal(
        USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025.maintenanceAmount,
      ),
    );
  const productionTon = productionFacts
    .filter((fact) => beforeSelectedYear(fact.competence))
    .reduce(
      (total, fact) => total.plus(fact.quantityTon),
      new Prisma.Decimal(
        USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025.productionTon,
      ),
    );

  return {
    maintenanceAmount: maintenanceAmount.toString(),
    productionTon: productionTon.toString(),
    periodStart: EXCEL_HISTORY_START,
    periodEnd: `${year - 1}-12-31`,
    competences:
      USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025.competences +
      Math.max(0, year - 2026) * 12,
    source:
      year === 2026
        ? USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025.source
        : `${USINA_MAINTENANCE_EXCEL_BASE_THROUGH_2025.source} + Sistema JR desde jan/2026`,
  };
}
