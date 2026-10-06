import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_ASPHALT_TEAM_CONTEXT } from '../usina-asphalt-teams/usina-asphalt-teams.rules';
import { getLucasFleetRosterMonth } from './lucas-fleet-roster.controller';
import { monthlyWorkforceKind } from '../checklist/monthly-workforce.rules';

type LaborAssignment = { role?: unknown; employeeKey?: unknown };

function normalized(value: unknown) {
  return String(value || '')
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
  const [vehicles, checklists] = await Promise.all([
    prisma.vehicle.findMany({
      where: { id: { in: ids } },
      select: { id: true, checklistEnabled: true },
    }),
    prisma.checklist.findMany({
      where: { type: 'MONTHLY', year: month.getUTCFullYear(), month: month.getUTCMonth() + 1,
        vehicleId: { in: ids } },
      select: { vehicleId: true, vehicleStopped: true, status: true,
        driverEmployeeKey: true, laborAssignments: true },
    }),
  ]);
  const vehicleById = new Map(vehicles.map((row) => [row.id, row]));
  const checklistByVehicle = new Map<string, typeof checklists>();
  for (const row of checklists) {
    if (!row.vehicleId) continue;
    checklistByVehicle.set(row.vehicleId, [...(checklistByVehicle.get(row.vehicleId) || []), row]);
  }
  const groups = new Map<string, { vehicleIds: string[]; keys: Set<string>; complete: boolean }>();
  for (const vehicle of activeRows) {
    const groupKey = lucasFleetGroupKey(vehicle);
    if (!groupKey) continue;
    const group = groups.get(groupKey) || { vehicleIds: [], keys: new Set<string>(), complete: true };
    group.vehicleIds.push(vehicle.id);
    if (vehicleById.get(vehicle.id)?.checklistEnabled !== false) {
      const matches = checklistByVehicle.get(vehicle.id) || [];
      if (matches.length !== 1) {
        group.complete = false;
      } else if (!matches[0].vehicleStopped && matches[0].status !== 'em_manutencao') {
        const driverKey = matches[0].driverEmployeeKey;
        if (!driverKey) group.complete = false;
        else group.keys.add(driverKey);
        const extras = matches[0].laborAssignments;
        if (monthlyWorkforceKind(vehicle.subgroup) !== 'STANDARD' && !Array.isArray(extras)) {
          // Old free-text checklists never confirmed whether the special crew was complete.
          group.complete = false;
        }
        if (extras !== null && extras !== undefined && !Array.isArray(extras)) {
          group.complete = false;
        } else if (Array.isArray(extras)) {
          for (const item of extras as LaborAssignment[]) {
            if (!item || typeof item.employeeKey !== 'string' || !item.employeeKey.trim()) {
              group.complete = false;
            } else {
              group.keys.add(item.employeeKey.trim());
            }
          }
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
  const aggregates = keys.length ? await prisma.totvsEmployeeCostAggregate.findMany({
    where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
      unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, queryCode: 'IND.BI.0025',
      competence: month, employeeKey: { in: keys }, isCurrent: true, active: true },
    select: { employeeKey: true, totalGeneralLine: true, syncRun: { select: { status: true, rejectedRows: true } } },
  }) : [];
  const costs = new Map<string, typeof aggregates>();
  for (const row of aggregates) {
    costs.set(row.employeeKey, [...(costs.get(row.employeeKey) || []), row]);
  }
  const Decimal = Prisma.Decimal.clone({ precision: 65 });
  const groupLaborActuals = [...groups].map(([groupKey, group]) => {
    // No linked employee is unknown coverage, not a proven monetary zero.
    let complete = group.complete && group.keys.size > 0;
    let amount = new Decimal(0);
    for (const key of group.keys) {
      if ((keyGroups.get(key)?.size || 0) > 1) complete = false;
      const rows = costs.get(key) || [];
      if (!rows.length || rows.some((row) => row.totalGeneralLine === null ||
        row.syncRun.status !== 'SUCCEEDED' || row.syncRun.rejectedRows !== 0)) {
        complete = false;
        continue;
      }
      for (const row of rows) amount = amount.plus(row.totalGeneralLine!.toString());
    }
    return {
      groupKey,
      laborActual: complete ? amount.toFixed(6) : null,
      vehicleCount: group.vehicleIds.length,
      employeeCount: group.keys.size,
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
