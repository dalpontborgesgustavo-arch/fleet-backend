import { Prisma } from '@prisma/client';
import { classifyUsinaVehicleExpense } from '../common/usina-maintenance-classification';

type Dataset =
  | 'VEHICLE_EXPENSES'
  | 'PAYABLE_EXPENSES'
  | 'LABOR_COSTS'
  | 'INTERNAL_CONSUMPTION_EXPENSES'
  | 'MATERIAL_PURCHASE_EXPENSES'
  | 'FLEET_MAINTENANCE_LABOR_ALLOCATIONS';
type CostClass =
  | 'DIESEL_USINA'
  | 'MANUTENCAO_USINA'
  | 'VEHICLE_EXPENSE'
  | 'OLEO_RESIVALE'
  | 'CAL_CH1'
  | 'DOP'
  | 'MATERIAL_EXPEDIENTE'
  | 'ENERGIA'
  | 'MAO_DE_OBRA';
export interface OperationalFactInput {
  dataset: Dataset;
  competence: Date;
  costClass: CostClass;
  amount: Prisma.Decimal | string | number;
  aethosVehicleId?: number | null;
  accountPlanDescription?: string | null;
}
export interface OperationalCoverageInput {
  dataset: Dataset;
  generatedAt: Date;
  scopeDateFrom: Date;
  scopeDateTo: Date;
}
export interface EquipmentConfigInput {
  competence: string;
  loaders: number[];
  supportVehicle: number | null;
}
export interface FleetMaintenanceLaborAllocationInput {
  competence: Date;
  aethosVehicleId: number;
  targetCostClass: 'CARREGADEIRAS' | 'VEICULO_USINA';
  vehicleExpenseAmount: Prisma.Decimal | string | number;
  allocatedLaborAmount: Prisma.Decimal | string | number;
}

const SAO_PAULO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function civilDate(value: Date) {
  const p = Object.fromEntries(
    SAO_PAULO.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
function covered(
  competence: string,
  dataset: Dataset,
  coverage: OperationalCoverageInput[],
) {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);
  return coverage.some((run) => {
    const generated = civilDate(run.generatedAt);
    const through = generated < monthEnd ? generated : monthEnd;
    return (
      generated >= competence &&
      run.dataset === dataset &&
      run.scopeDateFrom.toISOString().slice(0, 10) <= competence &&
      run.scopeDateTo.toISOString().slice(0, 10) >= through
    );
  });
}
const fixed = (value: Prisma.Decimal) => value.toFixed(6);
export function calculateUsinaOperationalCostMonths(
  year: number,
  facts: OperationalFactInput[],
  coverage: OperationalCoverageInput[],
  configs: EquipmentConfigInput[],
  fleetLaborAllocations: FleetMaintenanceLaborAllocationInput[] = [],
  fleetLaborDatasetActivated = false,
) {
  const configByMonth = new Map(
    configs.map((config) => [config.competence, config]),
  );
  return Array.from({ length: 12 }, (_, index) => {
    const competence = new Date(Date.UTC(year, index, 1))
      .toISOString()
      .slice(0, 10);
    const vehicleCovered = covered(competence, 'VEHICLE_EXPENSES', coverage);
    const payableCovered = covered(competence, 'PAYABLE_EXPENSES', coverage);
    const laborCovered = covered(competence, 'LABOR_COSTS', coverage);
    const internalConsumptionCovered = covered(
      competence,
      'INTERNAL_CONSUMPTION_EXPENSES',
      coverage,
    );
    const materialPurchaseCovered = covered(
      competence,
      'MATERIAL_PURCHASE_EXPENSES',
      coverage,
    );
    const fleetLaborCovered = covered(
      competence,
      'FLEET_MAINTENANCE_LABOR_ALLOCATIONS',
      coverage,
    );
    const monthFacts = facts
      .filter(
        (fact) =>
          fact.competence.toISOString().slice(0, 7) === competence.slice(0, 7),
      )
      .map((fact) => ({
        ...fact,
        costClass:
          fact.dataset === 'VEHICLE_EXPENSES'
            ? classifyUsinaVehicleExpense(
                fact.aethosVehicleId,
                fact.accountPlanDescription,
              )
            : fact.costClass,
      }));
    const sumClass = (costClass: CostClass) =>
      monthFacts
        .filter((fact) => fact.costClass === costClass)
        .reduce((sum, fact) => sum.plus(fact.amount), new Prisma.Decimal(0));
    const sumDatasetClass = (dataset: Dataset, costClass: CostClass) =>
      monthFacts
        .filter(
          (fact) => fact.dataset === dataset && fact.costClass === costClass,
        )
        .reduce((sum, fact) => sum.plus(fact.amount), new Prisma.Decimal(0));
    const config = configByMonth.get(competence);
    const vehicleFacts = monthFacts.filter(
      (fact) =>
        fact.dataset === 'VEHICLE_EXPENSES' &&
        fact.costClass === 'VEHICLE_EXPENSE',
    );
    const sumVehicles = (ids: number[]) =>
      vehicleFacts
        .filter(
          (fact) =>
            fact.aethosVehicleId != null && ids.includes(fact.aethosVehicleId),
        )
        .reduce((sum, fact) => sum.plus(fact.amount), new Prisma.Decimal(0));
    const monthAllocations = fleetLaborAllocations.filter(
      (allocation) =>
        allocation.competence.toISOString().slice(0, 7) ===
        competence.slice(0, 7),
    );
    const allocationsFor = (
      ids: number[],
      targetCostClass: 'CARREGADEIRAS' | 'VEICULO_USINA',
    ) =>
      monthAllocations.filter(
        (allocation) =>
          allocation.targetCostClass === targetCostClass &&
          ids.includes(allocation.aethosVehicleId),
      );
    const sumAllocations = (
      ids: number[],
      targetCostClass: 'CARREGADEIRAS' | 'VEICULO_USINA',
    ) =>
      allocationsFor(ids, targetCostClass).reduce(
        (sum, allocation) => sum.plus(allocation.allocatedLaborAmount),
        new Prisma.Decimal(0),
      );
    const allocationComplete = (
      ids: number[],
      targetCostClass: 'CARREGADEIRAS' | 'VEICULO_USINA',
    ) =>
      !fleetLaborDatasetActivated ||
      (fleetLaborCovered &&
        ids.length > 0 &&
        ids.every((id) =>
          monthAllocations.some((allocation) => {
            if (
              allocation.aethosVehicleId !== id ||
              allocation.targetCostClass !== targetCostClass
            )
              return false;
            return new Prisma.Decimal(allocation.vehicleExpenseAmount)
              .minus(sumVehicles([id]))
              .abs()
              .lte('0.01');
          }),
        ));
    const loaderIds = config?.loaders ?? [];
    const supportIds = config?.supportVehicle ? [config.supportVehicle] : [];
    const loaderVehicleExpense = sumVehicles(loaderIds);
    const supportVehicleExpense = sumVehicles(supportIds);
    const loaderAllocatedLabor = sumAllocations(loaderIds, 'CARREGADEIRAS');
    const supportAllocatedLabor = sumAllocations(
      supportIds,
      'VEICULO_USINA',
    );
    const loaderAllocationComplete = allocationComplete(
      loaderIds,
      'CARREGADEIRAS',
    );
    const supportAllocationComplete = allocationComplete(
      supportIds,
      'VEICULO_USINA',
    );
    const loadersTotal = loaderVehicleExpense.plus(
      fleetLaborDatasetActivated ? loaderAllocatedLabor : 0,
    );
    const supportTotal = supportVehicleExpense.plus(
      fleetLaborDatasetActivated ? supportAllocatedLabor : 0,
    );
    return {
      competence,
      coverage: {
        vehicle: vehicleCovered,
        payable: payableCovered,
        labor: laborCovered,
        internalConsumption: internalConsumptionCovered,
        materialPurchase: materialPurchaseCovered,
        fleetMaintenanceLabor: fleetLaborCovered,
      },
      fleetMaintenanceLabor: {
        activated: fleetLaborDatasetActivated,
        covered: fleetLaborCovered,
        sourceSentence: 'IND.BI.0035',
        byCostClass: {
          CARREGADEIRAS: {
            vehicleExpenseAmount: vehicleCovered
              ? fixed(loaderVehicleExpense)
              : null,
            allocatedLaborAmount:
              fleetLaborDatasetActivated && loaderAllocationComplete
                ? fixed(loaderAllocatedLabor)
                : fleetLaborDatasetActivated
                  ? null
                  : '0.000000',
            totalAmount:
              vehicleCovered && config && loaderAllocationComplete
                ? fixed(loadersTotal)
                : null,
            configuredVehicleIds: loaderIds,
            allocationComplete: loaderAllocationComplete,
            sourceExpenseMatches: loaderAllocationComplete,
          },
          VEICULO_USINA: {
            vehicleExpenseAmount: vehicleCovered
              ? fixed(supportVehicleExpense)
              : null,
            allocatedLaborAmount:
              fleetLaborDatasetActivated && supportAllocationComplete
                ? fixed(supportAllocatedLabor)
                : fleetLaborDatasetActivated
                  ? null
                  : '0.000000',
            totalAmount:
              vehicleCovered && config?.supportVehicle && supportAllocationComplete
                ? fixed(supportTotal)
                : null,
            configuredVehicleIds: supportIds,
            allocationComplete: supportAllocationComplete,
            sourceExpenseMatches: supportAllocationComplete,
          },
        },
      },
      costs: {
        DIESEL_USINA: vehicleCovered ? fixed(sumClass('DIESEL_USINA')) : null,
        MANUTENCAO_USINA: vehicleCovered
          ? fixed(sumClass('MANUTENCAO_USINA'))
          : null,
        CARREGADEIRAS:
          vehicleCovered && config && loaderAllocationComplete
            ? fixed(loadersTotal)
            : null,
        VEICULO_USINA:
          vehicleCovered && config?.supportVehicle && supportAllocationComplete
            ? fixed(supportTotal)
            : null,
        OLEO_RESIVALE: payableCovered ? fixed(sumClass('OLEO_RESIVALE')) : null,
        CAL_CH1: materialPurchaseCovered
          ? fixed(sumDatasetClass('MATERIAL_PURCHASE_EXPENSES', 'CAL_CH1'))
          : null,
        DOP: payableCovered ? fixed(sumClass('DOP')) : null,
        MATERIAL_EXPEDIENTE: internalConsumptionCovered
          ? fixed(
              monthFacts
                .filter(
                  (fact) =>
                    fact.dataset === 'INTERNAL_CONSUMPTION_EXPENSES' &&
                    fact.costClass === 'MATERIAL_EXPEDIENTE',
                )
                .reduce(
                  (sum, fact) => sum.plus(fact.amount),
                  new Prisma.Decimal(0),
                ),
            )
          : null,
        ENERGIA: payableCovered ? fixed(sumClass('ENERGIA')) : null,
        MAO_DE_OBRA: laborCovered ? fixed(sumClass('MAO_DE_OBRA')) : null,
      },
    };
  });
}
