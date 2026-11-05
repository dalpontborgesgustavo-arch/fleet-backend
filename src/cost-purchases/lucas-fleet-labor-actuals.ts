import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_ASPHALT_TEAM_CONTEXT } from '../usina-asphalt-teams/usina-asphalt-teams.rules';
import { getLucasFleetRosterMonth } from './lucas-fleet-roster.controller';
import { isSelectableTotvsEmployee, monthlyWorkforceKind, parseMonthlyLaborAssignments } from '../checklist/monthly-workforce.rules';
import { FLEET_LABOR_FORMULA_ID, FLEET_LABOR_QUERY_CODE } from './totvs-fleet-labor-source.service';

type MissingLaborLink = {
  vehicleId: string;
  fleet: string | null;
  vehicleName: string | null;
  source: 'CHECKLIST' | 'LUCAS';
  reason: 'NO_CHECKLIST_HISTORY' | 'CHECKLIST_DISABLED' | 'AMBIGUOUS_CHECKLIST' |
    'LAST_CHECKLIST_STOPPED' | 'OPERATOR_MISSING' | 'EMPLOYEE_NOT_CURRENT_TOTVS' |
    'MONTHLY_TEAM_NOT_CONFIGURED' | 'MONTHLY_TEAM_INVALID';
  responsibleName: string | null;
};

type LaborGroup = {
  vehicleIds: string[];
  keys: Set<string>;
  complete: boolean;
  missingLinks: MissingLaborLink[];
  inheritedVehicles: number;
  inheritedMonths: Set<string>;
};

type ValidationReference = {
  key: string;
  groupKey: string;
  vehicleId: string;
  fleet: string | null;
  vehicleName: string | null;
  source: 'CHECKLIST' | 'LUCAS';
  responsibleName: string | null;
};

function normalized(value: unknown) {
  return (typeof value === 'string' ? value : '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function lucasFleetGroupKey(vehicle: {
  name?: string | null;
  subgroup?: string | null;
  rollerType?: string | null;
}) {
  const subgroup = normalized(vehicle.subgroup);
  if (normalized(vehicle.name) === 'FREZINHA' ||
      subgroup === 'MINI CARREGADEIRAS' || subgroup === 'VASSOURAS') {
    return 'SUBGROUP:VASSOURAS';
  }
  if (!subgroup) return null;
  if (subgroup === 'ROLOS COMPACTADORES') {
    return ['CHAPA', 'PNEU', 'TERRAPLANAGEM'].includes(String(vehicle.rollerType))
      ? `ROLLER:${vehicle.rollerType}`
      : null;
  }
  return `SUBGROUP:${subgroup}`;
}

export async function getLucasFleetGroupLaborActuals(
  prisma: PrismaService,
  competence: string,
) {
  const month = new Date(`${competence}-01T00:00:00.000Z`);
  const roster = await getLucasFleetRosterMonth(prisma, competence);
  const activeRows = roster.rows.filter((row) => row.active);
  const ids = activeRows.map((row) => row.id);
  const [vehicles, checklists, workforceSettings] = await Promise.all([
    prisma.vehicle.findMany({
      where: { id: { in: ids } },
      select: { id: true, checklistEnabled: true,
        monthlyChecklistResponsible: { select: { name: true } } },
    }),
    prisma.checklist.findMany({
      where: { type: 'MONTHLY', year: month.getUTCFullYear(), month: month.getUTCMonth() + 1,
        vehicleId: { in: ids } },
      select: { vehicleId: true, year: true, month: true, vehicleStopped: true, status: true,
        driverEmployeeKey: true },
    }),
    prisma.fleetResultMonthlyWorkforce.findMany({
      where: { competence: month, vehicleId: { in: ids } },
      select: { vehicleId: true, assignments: true },
    }),
  ]);
  const workforceByVehicle = new Map(workforceSettings.map((row) => [row.vehicleId, row]));
  const vehicleById = new Map(vehicles.map((row) => [row.id, row]));
  const checklistByVehicle = new Map<string, typeof checklists>();
  for (const row of checklists) {
    if (!row.vehicleId) continue;
    checklistByVehicle.set(row.vehicleId, [...(checklistByVehicle.get(row.vehicleId) || []), row]);
  }
  const missingCurrentIds = ids.filter((id) => !checklistByVehicle.has(id));
  const historicalChecklists = missingCurrentIds.length
    ? await prisma.checklist.findMany({
      where: {
        type: 'MONTHLY',
        vehicleId: { in: missingCurrentIds },
        OR: [
          { year: { lt: month.getUTCFullYear() } },
          { year: month.getUTCFullYear(), month: { lt: month.getUTCMonth() + 1 } },
        ],
      },
      select: { vehicleId: true, year: true, month: true, vehicleStopped: true, status: true,
        driverEmployeeKey: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })
    : [];
  const previousByVehicle = new Map<string, typeof historicalChecklists>();
  for (const row of historicalChecklists) {
    if (!row.vehicleId) continue;
    const selected = previousByVehicle.get(row.vehicleId);
    if (!selected?.length) {
      previousByVehicle.set(row.vehicleId, [row]);
    } else if (selected[0].year === row.year && selected[0].month === row.month) {
      // An ambiguous latest month must not silently fall back to an older assignment.
      selected.push(row);
    }
  }
  const validationReferences: ValidationReference[] = [];
  const groups = new Map<string, LaborGroup>();
  for (const vehicle of activeRows) {
    const groupKey = lucasFleetGroupKey(vehicle);
    if (!groupKey) continue;
    const group = groups.get(groupKey) || { vehicleIds: [], keys: new Set<string>(),
      complete: true, missingLinks: [], inheritedVehicles: 0, inheritedMonths: new Set<string>() };
    group.vehicleIds.push(vehicle.id);
    const checklistOwner = vehicleById.get(vehicle.id)?.monthlyChecklistResponsible?.name || null;
    const addGap = (source: MissingLaborLink['source'], reason: MissingLaborLink['reason']) => {
      group.complete = false;
      group.missingLinks.push({ vehicleId: vehicle.id, fleet: vehicle.fleet,
        vehicleName: vehicle.name, source, reason,
        responsibleName: source === 'CHECKLIST' ? checklistOwner : 'Lucas (Apresentação Lucas)' });
    };
    let knownStoppedThisMonth = false;
    if (vehicleById.get(vehicle.id)?.checklistEnabled === false) {
      addGap('CHECKLIST', 'CHECKLIST_DISABLED');
    } else {
      const current = checklistByVehicle.get(vehicle.id) || [];
      const inherited = current.length ? [] : previousByVehicle.get(vehicle.id) || [];
      const matches = current.length ? current : inherited;
      if (!matches.length) {
        addGap('CHECKLIST', 'NO_CHECKLIST_HISTORY');
      } else if (matches.length !== 1) {
        addGap('CHECKLIST', 'AMBIGUOUS_CHECKLIST');
      } else if (inherited.length &&
        (matches[0].vehicleStopped || matches[0].status === 'em_manutencao')) {
        // A previous stopped/maintenance inspection is not proof of operation this month.
        addGap('CHECKLIST', 'LAST_CHECKLIST_STOPPED');
      } else if (current.length && (matches[0].vehicleStopped || matches[0].status === 'em_manutencao')) {
        // A current stopped/maintenance inspection explicitly excludes operating staff.
        knownStoppedThisMonth = true;
      } else if (!matches[0].vehicleStopped && matches[0].status !== 'em_manutencao') {
        if (inherited.length) {
          group.inheritedVehicles += 1;
          group.inheritedMonths.add(`${matches[0].year}-${String(matches[0].month).padStart(2, '0')}`);
        }
        const driverKey = matches[0].driverEmployeeKey;
        if (!driverKey) addGap('CHECKLIST', 'OPERATOR_MISSING');
        else {
          group.keys.add(driverKey);
          validationReferences.push({ key: driverKey, groupKey,
            vehicleId: vehicle.id, fleet: vehicle.fleet, vehicleName: vehicle.name,
            source: 'CHECKLIST', responsibleName: checklistOwner });
        }
      }
    }
    if (!knownStoppedThisMonth && monthlyWorkforceKind(vehicle.subgroup) !== 'STANDARD') {
      const setting = workforceByVehicle.get(vehicle.id);
      if (!setting) {
        // An absent setting is unknown. A saved [] explicitly confirms no extra crew.
        addGap('LUCAS', 'MONTHLY_TEAM_NOT_CONFIGURED');
      } else if (!Array.isArray(setting.assignments)) {
        addGap('LUCAS', 'MONTHLY_TEAM_INVALID');
      } else {
        try {
          const assignments = parseMonthlyLaborAssignments(setting.assignments, vehicle.subgroup);
          for (const item of assignments) {
            group.keys.add(item.employeeKey);
            validationReferences.push({ key: item.employeeKey, groupKey,
              vehicleId: vehicle.id, fleet: vehicle.fleet, vehicleName: vehicle.name,
              source: 'LUCAS', responsibleName: 'Lucas (Apresentação Lucas)' });
          }
        } catch {
          addGap('LUCAS', 'MONTHLY_TEAM_INVALID');
        }
      }
    }
    groups.set(groupKey, group);
  }
  const keyGroups = new Map<string, Set<string>>();
  for (const [groupKey, group] of groups) {
    for (const key of group.keys) {
      const groupKeys = keyGroups.get(key) || new Set<string>();
      groupKeys.add(groupKey);
      keyGroups.set(key, groupKeys);
    }
  }
  const keys = [...keyGroups.keys()];
  const approval = await prisma.totvsFleetLaborApproval.findFirst({
    where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
      unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, competence: month },
    orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, rowCount: true, sourceHash: true, totalCost: true,
      syncRun: { select: { status: true, sourceHash: true, ruleVersion: true,
        queryCode: true } } },
  });
  // Never blend an approved dedicated source with provisional IND.BI.0025 rows.
  const [approvalRowsCount, dedicatedCount, dedicatedSum] = approval ? await Promise.all([
    prisma.totvsFleetLaborCost.count({ where: { approvalId: approval.id } }),
    prisma.totvsFleetLaborCost.count({
      where: { approvalId: approval.id, competence: month,
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        isCurrent: true, active: true, queryCode: FLEET_LABOR_QUERY_CODE,
        ruleVersion: FLEET_LABOR_FORMULA_ID, cardinalityOk: true },
    }),
    prisma.totvsFleetLaborCost.aggregate({
      where: { approvalId: approval.id, competence: month,
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        isCurrent: true, active: true, queryCode: FLEET_LABOR_QUERY_CODE,
        ruleVersion: FLEET_LABOR_FORMULA_ID, cardinalityOk: true },
      _sum: { totalGeneralIntegral: true },
    }),
  ]) : [0, 0, null];
  const sourceIntegrityError = Boolean(approval && (approval.rowCount !== dedicatedCount ||
    approvalRowsCount !== dedicatedCount ||
    !dedicatedSum?._sum.totalGeneralIntegral?.equals(approval.totalCost) ||
    approval.syncRun.queryCode !== FLEET_LABOR_QUERY_CODE ||
    approval.syncRun.status !== 'STAGED' ||
    approval.syncRun.ruleVersion !== FLEET_LABOR_FORMULA_ID ||
    approval.sourceHash !== approval.syncRun.sourceHash));
  const dedicated = approval && !sourceIntegrityError && keys.length
    ? await prisma.totvsFleetLaborCost.findMany({
      where: { approvalId: approval.id, competence: month, employeeKey: { in: keys },
        isCurrent: true, active: true, cardinalityOk: true,
        queryCode: FLEET_LABOR_QUERY_CODE,
        ruleVersion: FLEET_LABOR_FORMULA_ID },
      select: { employeeKey: true, totalGeneralIntegral: true },
    }) : [];
  const provisional = !approval && keys.length
    ? await prisma.totvsEmployeeCostAggregate.findMany({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, queryCode: 'IND.BI.0025',
        competence: month, employeeKey: { in: keys }, isCurrent: true, active: true },
      select: { employeeKey: true, totalGeneralLine: true, officialCostEligible: true,
        syncRun: { select: { status: true, rejectedRows: true } } },
    }) : [];
  const keysToValidate = [...new Set(validationReferences.map((reference) => reference.key))];
  const keysRequiringValidation = new Set(keysToValidate);
  const validatedEmployees = keysToValidate.length ? await prisma.totvsEmployeeSnapshot.findMany({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, competence: month,
        employeeKey: { in: keysToValidate }, isCurrent: true, active: true },
      select: { employeeKey: true, employmentStatus: true },
    }) : [];
  const activeValidatedKeys = new Set(validatedEmployees
    .filter((row) => isSelectableTotvsEmployee(row.employmentStatus))
    .map((row) => row.employeeKey));
  for (const reference of validationReferences) {
    if (activeValidatedKeys.has(reference.key)) continue;
    const group = groups.get(reference.groupKey);
    if (!group) continue;
    group.complete = false;
    group.missingLinks.push({ vehicleId: reference.vehicleId, fleet: reference.fleet,
      vehicleName: reference.vehicleName, source: reference.source,
      reason: 'EMPLOYEE_NOT_CURRENT_TOTVS', responsibleName: reference.responsibleName });
  }
  const costs = new Map<string, {
    employeeKey: string; amount: Prisma.Decimal | null; sourceOk: boolean; provisional: boolean;
  }[]>();
  const costRows = approval
    ? dedicated.map((row) => ({ employeeKey: row.employeeKey,
      amount: row.totalGeneralIntegral, sourceOk: true, provisional: false }))
    : provisional.map((row) => ({ employeeKey: row.employeeKey,
      amount: row.totalGeneralLine,
      sourceOk: row.syncRun.status === 'SUCCEEDED' && row.syncRun.rejectedRows === 0,
      provisional: !row.officialCostEligible }));
  for (const row of costRows) {
    costs.set(row.employeeKey, [...(costs.get(row.employeeKey) || []), row]);
  }
  const Decimal = Prisma.Decimal.clone({ precision: 65 });
  const groupLaborActuals = [...groups].map(([groupKey, group]) => {
    // No linked employee is unknown coverage, not a proven monetary zero.
    let complete = group.complete && group.keys.size > 0 && !sourceIntegrityError;
    let amount = new Decimal(0);
    let valuedEmployeeCount = 0;
    let missingCostEmployeeCount = 0;
    let hasProvisionalRows = false;
    for (const key of group.keys) {
      if ((keyGroups.get(key)?.size || 0) > 1) {
        complete = false;
        continue; // An employee shared by groups cannot be allocated by assumption.
      }
      if (keysRequiringValidation.has(key) && !activeValidatedKeys.has(key)) {
        complete = false;
        continue;
      }
      const rows = costs.get(key) || [];
      if (!rows.length || rows.some((row) => row.amount === null || !row.sourceOk)) {
        complete = false;
        missingCostEmployeeCount += 1;
        continue;
      }
      valuedEmployeeCount += 1;
      if (rows.some((row) => row.provisional)) hasProvisionalRows = true;
      for (const row of rows) amount = amount.plus(row.amount!.toString());
    }
    const missingVehicleCount = new Set(group.missingLinks.map((link) => link.vehicleId)).size;
    return {
      groupKey,
      laborActual: valuedEmployeeCount && !sourceIntegrityError ? amount.toFixed(6) : null,
      isPartial: !complete,
      isProvisional: !approval || hasProvisionalRows,
      costSource: sourceIntegrityError ? 'DEDICATED_INTEGRITY_ERROR'
        : approval ? 'OFFICIAL_DEDICATED' : 'PROVISIONAL_SHARED',
      costStatus: sourceIntegrityError ? 'SOURCE_INTEGRITY_ERROR'
        : missingCostEmployeeCount ? 'MISSING_SOURCE'
          : approval ? 'OFFICIAL' : 'PROVISIONAL',
      vehicleCount: group.vehicleIds.length,
      employeeCount: group.keys.size,
      valuedEmployeeCount,
      missingCostEmployeeCount,
      missingLinkVehicleCount: missingVehicleCount,
      missingLinks: group.missingLinks,
      inheritedVehicleCount: group.inheritedVehicles,
      inheritedFromMonths: [...group.inheritedMonths].sort(),
      status: complete ? 'COMPLETE' : 'PENDING_ASSIGNMENT_OR_SOURCE',
    };
  });
  return {
    groupLaborActuals,
    coverage: {
      groups: groupLaborActuals.length,
      completeGroups: groupLaborActuals.filter((row) => row.status === 'COMPLETE').length,
      pendingGroups: groupLaborActuals.filter((row) => row.status !== 'COMPLETE').length,
      conflictingEmployeeKeys: [...keyGroups.values()].filter((value) => value.size > 1).length,
    },
  };
}
