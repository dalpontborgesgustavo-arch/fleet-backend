import { Prisma } from '@prisma/client';

export const COST_PURCHASE_EXPENSE_DATASET = 'COST_PURCHASE_VEHICLE_EXPENSES';
export const COST_PURCHASE_FUEL_DATASET = 'COST_PURCHASE_VEHICLE_FUEL';
export const COST_PURCHASE_MANAGERIAL_ENTRY_DATASET =
  'cost-purchases-managerial-entry-items';
export const COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET =
  'COST_PURCHASE_INTERNAL_CONSUMPTION';
export const COST_PURCHASE_PREVENTIVE_ORDER_DATASET =
  'COST_PURCHASE_PREVENTIVE_ORDERS';
export const COST_PURCHASE_ALLOWED_ROLES = new Set(['compras', 'admin']);

export type CostPurchasePolicy = {
  vehicleShare: Prisma.Decimal;
  truckShare: Prisma.Decimal;
  machineShare: Prisma.Decimal;
  maintenanceVehicleFixed: Prisma.Decimal;
  comboioPlateFixed: Prisma.Decimal;
  vehicleKeywords: string[];
  truckKeywords: string[];
};

export type CostPurchaseException = {
  identifierType: string;
  identifierValue: string;
  displayFleet: string | null;
  displayModel: string | null;
  displayType: string | null;
  includeInReport: boolean;
  includeInAllocation: boolean;
  rateGroup: string | null;
};

export type CostPurchaseVehicle = {
  id: string;
  aethosVehicleId: string | null;
  fleet: string | null;
  plate: string;
  model: string | null;
  type: string;
  vehicleType: string;
  tipoFrota: string;
  group: string | null;
  subgroup: string | null;
  company: string | null;
  filial: string;
  responsibleName: string | null;
  currentResponsibleName: string | null;
  active: boolean;
  keepMonthlyCostReport: boolean;
  veiculoManutencao: boolean;
  createdAt: Date;
  inactiveAt: Date | null;
};

export type CostPurchaseVehicleAggregate = {
  expenseTotal: Prisma.Decimal;
  fuelTotal: Prisma.Decimal;
  liters: Prisma.Decimal;
  initialKms: Prisma.Decimal[];
  currentKms: Prisma.Decimal[];
  hourMeterRateSum: Prisma.Decimal;
  hourMeterReadingCount: number;
  hourMeterHours: Prisma.Decimal;
  hourMeterLiters: Prisma.Decimal;
  desiredAverages: Prisma.Decimal[];
};

export type CostPurchaseCalculatedRow = {
  vehicleId: string;
  aethosVehicleId: number;
  competence: string;
  type: string;
  vehicleType: string;
  fleet: string;
  plate: string;
  model: string;
  responsible: string;
  group: string | null;
  subgroup: string | null;
  company: string | null;
  filial: string;
  isRented: boolean;
  maintenanceSupport: boolean;
  rateGroup: string | null;
  participatesInAllocation: boolean;
  expenseGeneral: Prisma.Decimal;
  expenseTotal: Prisma.Decimal;
  fuelTotal: Prisma.Decimal;
  maintenance: Prisma.Decimal;
  liters: Prisma.Decimal;
  km: Prisma.Decimal;
  averageKmPerLiter: Prisma.Decimal;
  averageLitersPerHour: Prisma.Decimal;
  hourMeterRateSum: Prisma.Decimal;
  hourMeterReadingCount: number;
  hourMeterHours: Prisma.Decimal;
  hourMeterLiters: Prisma.Decimal;
  desiredAverage: Prisma.Decimal;
  expensePerKm: Prisma.Decimal;
  allocatedAmount: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

function allocateRoundedAmount(
  total: Prisma.Decimal,
  recipients: Array<{ key: string; weight: Prisma.Decimal }>,
) {
  const result = new Map<string, Prisma.Decimal>();
  for (const recipient of recipients) result.set(recipient.key, ZERO);
  if (!recipients.length) return result;
  const totalWeight = recipients.reduce(
    (sum, recipient) => sum.plus(recipient.weight),
    ZERO,
  );
  if (totalWeight.eq(0)) return result;

  const targetCents = total
    .mul(HUNDRED)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const ranked = recipients.map((recipient) => {
    const exactCents = targetCents.mul(recipient.weight).div(totalWeight);
    const baseCents = exactCents.floor();
    return {
      ...recipient,
      baseCents,
      remainder: exactCents.minus(baseCents),
    };
  });
  const baseTotal = ranked.reduce(
    (sum, recipient) => sum.plus(recipient.baseCents),
    ZERO,
  );
  const remaining = targetCents.minus(baseTotal).toNumber();
  ranked.sort((left, right) => {
    const remainderComparison = right.remainder.comparedTo(left.remainder);
    if (remainderComparison) return remainderComparison;
    return left.key.localeCompare(right.key, 'pt-BR');
  });
  for (let index = 0; index < ranked.length; index += 1) {
    const cents = ranked[index].baseCents.plus(index < remaining ? 1 : 0);
    result.set(ranked[index].key, cents.div(HUNDRED));
  }
  return result;
}

export function canAccessCostPurchases(role?: string | null) {
  return COST_PURCHASE_ALLOWED_ROLES.has(String(role || '').toLowerCase());
}

export function normalizeIdentifier(value: unknown) {
  const input =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
      ? String(value)
      : '';
  return input
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+(?=\d)/, '');
}

export function monthKey(value: Date) {
  return value.getUTCFullYear() * 100 + value.getUTCMonth() + 1;
}

export function participatesInCompetence(
  vehicle: CostPurchaseVehicle,
  competence: Date,
) {
  const competenceKey = monthKey(competence);
  if (vehicle.inactiveAt && monthKey(vehicle.inactiveAt) < competenceKey) {
    return false;
  }
  return true;
}

export function findVehicleException(
  vehicle: CostPurchaseVehicle,
  exceptions: CostPurchaseException[],
) {
  const plate = normalizeIdentifier(vehicle.plate);
  const fleet = normalizeIdentifier(vehicle.fleet);
  return (
    exceptions.find(
      (entry) =>
        entry.identifierType === 'PLATE' &&
        normalizeIdentifier(entry.identifierValue) === plate,
    ) ||
    exceptions.find(
      (entry) =>
        entry.identifierType === 'FLEET' &&
        normalizeIdentifier(entry.identifierValue) === fleet,
    ) ||
    null
  );
}

function textForClassification(vehicle: CostPurchaseVehicle) {
  return normalizeIdentifier(
    [
      vehicle.type,
      vehicle.vehicleType,
      vehicle.tipoFrota,
      vehicle.group,
      vehicle.subgroup,
      vehicle.model,
    ].join(' '),
  );
}

export function reportEligibility(
  vehicle: CostPurchaseVehicle,
  exception: CostPurchaseException | null,
) {
  if (exception) return exception.includeInReport;
  if (!vehicle.keepMonthlyCostReport) return false;
  const plate = normalizeIdentifier(vehicle.plate);
  const fleetKind = normalizeIdentifier(vehicle.tipoFrota);
  if (plate.startsWith('COM') && plate !== 'COM0002') return false;
  if (fleetKind === 'T' || fleetKind.includes('TERCEIR')) return false;
  return true;
}

export function isRentedVehicle(vehicle: CostPurchaseVehicle) {
  const classification = textForClassification(vehicle);
  return (
    classification.includes('TERCEIR') ||
    classification.includes('ALUG') ||
    normalizeIdentifier(vehicle.tipoFrota) === 'T'
  );
}

export function resolveDisplayType(
  vehicle: CostPurchaseVehicle,
  exception: CostPurchaseException | null,
) {
  if (exception?.displayType) return exception.displayType;
  const candidates = [vehicle.type, vehicle.vehicleType, vehicle.tipoFrota];
  const found = candidates.find((value) => {
    const normalized = normalizeIdentifier(value);
    return (
      normalized &&
      !['NAOCLASSIFICADO', 'SEMCLASSIFICACAO'].includes(normalized)
    );
  });
  return found?.trim() || 'Não Classificado';
}

export function resolveRateGroup(
  vehicle: CostPurchaseVehicle,
  displayType: string,
  exception: CostPurchaseException | null,
  policy: CostPurchasePolicy,
) {
  if (exception?.rateGroup) return exception.rateGroup;
  if (exception && !exception.includeInAllocation) return null;
  const classification = textForClassification(vehicle);
  const accountGroup = normalizeIdentifier(vehicle.group);
  if (
    normalizeIdentifier(displayType) === 'USINAS' ||
    classification.includes('USINA')
  )
    return null;
  if (normalizeIdentifier(displayType) === 'NAOCLASSIFICADO') return null;
  // O grupo/subgrupo gerencial cadastrado no JR e a fonte oficial para
  // separar veiculos, caminhoes e maquinas. O tipo tecnico recebido do Aethos
  // pode ser "truck" inclusive para equipamentos pesados, por isso so deve
  // ser usado como fallback quando o grupo contabil nao estiver definido.
  if (accountGroup.includes('DESPESASMAQUINAS')) return 'MAQUINAS';
  if (accountGroup.includes('DESPESASCAMINHOES')) return 'CAMINHOES';
  if (accountGroup.includes('DESPESASVEICULOS')) return 'VEICULOS';
  if (
    policy.vehicleKeywords.some((keyword) =>
      classification.includes(normalizeIdentifier(keyword)),
    )
  ) {
    return 'VEICULOS';
  }
  if (
    policy.truckKeywords.some((keyword) =>
      classification.includes(normalizeIdentifier(keyword)),
    )
  ) {
    return 'CAMINHOES';
  }
  return 'MAQUINAS';
}

function maxPositive(values: Prisma.Decimal[]) {
  const valid = values.filter((value) => value.gt(0));
  return valid.reduce(
    (result, value) => (value.gt(result) ? value : result),
    ZERO,
  );
}

function minPositive(values: Prisma.Decimal[]) {
  const valid = values.filter((value) => value.gt(0));
  if (!valid.length) return ZERO;
  return valid.reduce((result, value) => (value.lt(result) ? value : result));
}

export function calculateCostPurchaseRows(input: {
  competence: Date;
  vehicles: CostPurchaseVehicle[];
  aggregates: Map<number, CostPurchaseVehicleAggregate>;
  exceptions: CostPurchaseException[];
  policy: CostPurchasePolicy;
  eligibleLaborPoolAmount: Prisma.Decimal;
  includeRented?: boolean;
}) {
  const baseRows: CostPurchaseCalculatedRow[] = [];
  for (const vehicle of input.vehicles) {
    const aethosVehicleId = Number(vehicle.aethosVehicleId);
    const aggregate = input.aggregates.get(aethosVehicleId);
    if (!aggregate || !Number.isSafeInteger(aethosVehicleId)) continue;
    if (!participatesInCompetence(vehicle, input.competence)) continue;
    const exception = findVehicleException(vehicle, input.exceptions);
    const rented = isRentedVehicle(vehicle);
    if (
      !reportEligibility(vehicle, exception) &&
      !(input.includeRented && rented)
    ) {
      continue;
    }
    const displayType = resolveDisplayType(vehicle, exception);
    const rateGroup = rented
      ? null
      : resolveRateGroup(vehicle, displayType, exception, input.policy);
    const maxKm = maxPositive(aggregate.currentKms);
    const minKm = minPositive(aggregate.initialKms);
    const km =
      maxKm.gt(0) && minKm.gt(0) && maxKm.gt(minKm) ? maxKm.minus(minKm) : ZERO;
    const desiredAverage = maxPositive(aggregate.desiredAverages);
    const averageKmPerLiter =
      km.gt(0) && aggregate.liters.gt(0) ? km.div(aggregate.liters) : ZERO;
    const averageLitersPerHour =
      aggregate.hourMeterReadingCount > 0
        ? aggregate.hourMeterRateSum.div(aggregate.hourMeterReadingCount)
        : ZERO;
    const expensePerKm = km.gt(0) ? aggregate.expenseTotal.div(km) : ZERO;
    baseRows.push({
      vehicleId: vehicle.id,
      aethosVehicleId,
      competence: input.competence.toISOString().slice(0, 10),
      type: displayType,
      vehicleType: vehicle.vehicleType || 'Não informado',
      fleet: exception?.displayFleet || vehicle.fleet || 'Sem frota',
      plate: vehicle.plate || 'Sem placa',
      model: exception?.displayModel || vehicle.model || 'Não informado',
      responsible:
        vehicle.currentResponsibleName ||
        vehicle.responsibleName ||
        'Não informado',
      group: vehicle.group,
      subgroup: vehicle.subgroup,
      company: vehicle.company,
      filial: vehicle.filial,
      isRented: rented,
      maintenanceSupport: vehicle.veiculoManutencao,
      rateGroup,
      participatesInAllocation:
        Boolean(rateGroup) && (exception?.includeInAllocation ?? true),
      expenseGeneral: aggregate.expenseTotal,
      expenseTotal: aggregate.expenseTotal,
      fuelTotal: aggregate.fuelTotal,
      maintenance: aggregate.expenseTotal.minus(aggregate.fuelTotal),
      liters: aggregate.liters,
      km,
      averageKmPerLiter,
      averageLitersPerHour,
      hourMeterRateSum: aggregate.hourMeterRateSum,
      hourMeterReadingCount: aggregate.hourMeterReadingCount,
      hourMeterHours: aggregate.hourMeterHours,
      hourMeterLiters: aggregate.hourMeterLiters,
      desiredAverage,
      expensePerKm,
      allocatedAmount: ZERO,
    });
  }

  const maintenanceVehicles = baseRows.filter((row) => {
    const vehicle = input.vehicles.find((entry) => entry.id === row.vehicleId);
    return vehicle?.veiculoManutencao;
  });
  const comboioVehicles = baseRows.filter((row) =>
    normalizeIdentifier(
      [row.type, row.vehicleType, row.model].join(' '),
    ).includes('COMBOIO'),
  );
  const maintenanceExpense = maintenanceVehicles.reduce(
    (sum, row) => sum.plus(row.expenseTotal),
    ZERO,
  );
  const comboioExpense = comboioVehicles.reduce(
    (sum, row) => sum.plus(row.expenseTotal),
    ZERO,
  );
  const comboioPlates = new Set(
    comboioVehicles
      .map((row) => normalizeIdentifier(row.plate))
      .filter(Boolean),
  ).size;
  const totalAllocationPool = maintenanceExpense
    .plus(input.policy.maintenanceVehicleFixed.mul(maintenanceVehicles.length))
    .plus(comboioExpense)
    .plus(input.policy.comboioPlateFixed.mul(comboioPlates))
    .plus(input.eligibleLaborPoolAmount);

  const groupShares: Record<string, Prisma.Decimal> = {
    VEICULOS: input.policy.vehicleShare,
    CAMINHOES: input.policy.truckShare,
    MAQUINAS: input.policy.machineShare,
  };
  const groupBases = new Map<string, Prisma.Decimal>();
  for (const row of baseRows) {
    if (!row.participatesInAllocation || !row.rateGroup) continue;
    groupBases.set(
      row.rateGroup,
      (groupBases.get(row.rateGroup) || ZERO).plus(row.expenseTotal),
    );
  }
  const groupTargets = allocateRoundedAmount(
    totalAllocationPool,
    Object.entries(groupShares).map(([key, weight]) => ({ key, weight })),
  );
  const reconciliationIssues: Array<{
    code: 'POSITIVE_SHARE_WITHOUT_BASE';
    rateGroup: string;
    share: Prisma.Decimal;
    targetAmount: Prisma.Decimal;
  }> = [];
  for (const [rateGroup, share] of Object.entries(groupShares)) {
    const base = groupBases.get(rateGroup) || ZERO;
    const targetAmount = groupTargets.get(rateGroup) || ZERO;
    if (share.gt(0) && !base.gt(0)) {
      reconciliationIssues.push({
        code: 'POSITIVE_SHARE_WITHOUT_BASE',
        rateGroup,
        share,
        targetAmount,
      });
      continue;
    }
    const groupRows = baseRows.filter(
      (row) => row.participatesInAllocation && row.rateGroup === rateGroup,
    );
    const allocated = allocateRoundedAmount(
      targetAmount,
      groupRows.map((row) => ({
        key: String(row.aethosVehicleId).padStart(20, '0'),
        weight: row.expenseTotal,
      })),
    );
    for (const row of groupRows) {
      row.allocatedAmount =
        allocated.get(String(row.aethosVehicleId).padStart(20, '0')) || ZERO;
      row.expenseGeneral = row.expenseTotal.plus(row.allocatedAmount);
    }
  }
  const allocatedAmountTotal = baseRows.reduce(
    (sum, row) => sum.plus(row.allocatedAmount),
    ZERO,
  );

  return {
    rows: baseRows,
    memory: {
      maintenanceVehicles: maintenanceVehicles.length,
      maintenanceExpense,
      maintenanceFixed: input.policy.maintenanceVehicleFixed.mul(
        maintenanceVehicles.length,
      ),
      comboioVehicles: comboioVehicles.length,
      comboioPlates,
      comboioExpense,
      comboioFixed: input.policy.comboioPlateFixed.mul(comboioPlates),
      eligibleLaborPoolAmount: input.eligibleLaborPoolAmount,
      totalAllocationPool,
      groupBases,
      groupShares,
      groupTargets,
      allocatedAmountTotal,
      allocationDifference: totalAllocationPool
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .minus(allocatedAmountTotal),
      reconciliationIssues,
    },
  };
}

export function decimalString(value: Prisma.Decimal, scale = 2) {
  return value.toFixed(scale);
}
