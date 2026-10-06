import { Prisma } from '@prisma/client';

const ELIGIBLE_CATEGORIES = new Set([
  'VIBROACABADORA',
  'ROLO_LISO',
  'ROLO_PNEUS',
]);

type TeamProfile = {
  teamId: string;
  businessCode?: string | null;
  displayName?: string | null;
  validFrom: Date;
  validTo?: Date | null;
};

type FleetAssignment = {
  teamId: string;
  competence: Date;
  category: string;
  validFrom: Date;
  validTo: Date;
  deletedAt?: Date | null;
  operatorAssignments?: Array<{
    employeeKey: string;
    employeeDisplayName: string;
    validFrom: Date;
    validTo: Date;
    deletedAt?: Date | null;
  }>;
};

type CostAggregate = {
  employeeKey: string;
  competence: Date;
  period: number;
  totalGeneralLine: Prisma.Decimal | string | number | null;
  sourceRows: number;
  isCurrent: boolean;
  active: boolean;
};

function competenceKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function overlapsMonth(from: Date, to: Date | null | undefined, monthStart: Date, monthEnd: Date) {
  return from <= monthEnd && (!to || to >= monthStart);
}

function maskedEmployeeKey(value: string) {
  const suffix = value.split('-').slice(1).join('-') || value;
  return `***${suffix.slice(-4)}`;
}

export function reconcileUsinaAsphaltTeamLaborCosts(input: {
  year: number;
  profiles: TeamProfile[];
  assignments: FleetAssignment[];
  costAggregates: CostAggregate[];
}) {
  const currentCosts = input.costAggregates.filter(
    (row) =>
      row.isCurrent &&
      row.active &&
      [20, 30, 40].includes(row.period) &&
      dateKey(row.competence).startsWith(`${input.year}-`),
  );

  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const monthStart = new Date(Date.UTC(input.year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(input.year, monthIndex + 1, 0));
    const competence = competenceKey(input.year, monthIndex);
    const profiles = input.profiles.filter((profile) =>
      overlapsMonth(profile.validFrom, profile.validTo, monthStart, monthEnd),
    );
    const profileByTeam = new Map(profiles.map((profile) => [profile.teamId, profile]));
    const employeeTeams = new Map<string, Set<string>>();
    const displayNames = new Map<string, string>();

    for (const assignment of input.assignments) {
      if (
        assignment.deletedAt ||
        dateKey(assignment.competence) !== competence ||
        !ELIGIBLE_CATEGORIES.has(assignment.category) ||
        !profileByTeam.has(assignment.teamId)
      ) {
        continue;
      }
      for (const operator of assignment.operatorAssignments || []) {
        if (
          operator.deletedAt ||
          !overlapsMonth(operator.validFrom, operator.validTo, monthStart, monthEnd)
        ) {
          continue;
        }
        const teams = employeeTeams.get(operator.employeeKey) || new Set<string>();
        teams.add(assignment.teamId);
        employeeTeams.set(operator.employeeKey, teams);
        displayNames.set(operator.employeeKey, operator.employeeDisplayName);
      }
    }

    const conflicts = new Set(
      [...employeeTeams.entries()]
        .filter(([, teamIds]) => teamIds.size > 1)
        .map(([employeeKey]) => employeeKey),
    );
    const monthCosts = currentCosts.filter(
      (row) => dateKey(row.competence) === competence,
    );
    const costsByEmployee = new Map<string, CostAggregate[]>();
    for (const row of monthCosts) {
      const rows = costsByEmployee.get(row.employeeKey) || [];
      rows.push(row);
      costsByEmployee.set(row.employeeKey, rows);
    }

    const teams = profiles.map((profile) => {
      const linked = [...employeeTeams.entries()]
        .filter(([, teamIds]) => teamIds.has(profile.teamId))
        .map(([employeeKey]) => employeeKey);
      const conflicted = linked.filter((employeeKey) => conflicts.has(employeeKey));
      const eligible = linked.filter((employeeKey) => !conflicts.has(employeeKey));
      const employees = eligible.map((employeeKey) => {
        const rows = costsByEmployee.get(employeeKey) || [];
        const valuedRows = rows.filter((row) => row.totalGeneralLine !== null);
        const amount = valuedRows.length
          ? valuedRows
              .reduce(
                (sum, row) => sum.plus(row.totalGeneralLine!),
                new Prisma.Decimal(0),
              )
              .toFixed(6)
          : null;
        return {
          employeeKeyMasked: maskedEmployeeKey(employeeKey),
          displayName: displayNames.get(employeeKey) || null,
          periods: [...new Set(rows.map((row) => row.period))].sort(),
          sourceRows: rows.reduce((sum, row) => sum + Number(row.sourceRows || 0), 0),
          amount,
        };
      });
      const missingCostEmployees = employees.filter((employee) => employee.amount === null);
      const amount =
        eligible.length > 0 && missingCostEmployees.length === 0
          ? employees
              .reduce(
                (sum, employee) => sum.plus(employee.amount!),
                new Prisma.Decimal(0),
              )
              .toFixed(6)
          : null;
      const status = conflicted.length
        ? 'CONFLITO_OPERADOR_MULTIPLAS_EQUIPES'
        : !eligible.length
          ? 'SEM_OPERADOR_VINCULADO'
          : missingCostEmployees.length
            ? 'CUSTO_TOTVS_AUSENTE'
            : 'CALCULADO';

      return {
        teamId: profile.teamId,
        businessCode: profile.businessCode || null,
        displayName: profile.displayName || null,
        amount,
        status,
        linkedEmployeeCount: linked.length,
        deduplicatedEmployeeCount: eligible.length,
        conflictEmployeeCount: conflicted.length,
        conflictEmployees: conflicted.map(maskedEmployeeKey),
        employees,
      };
    });

    return { competence, teams };
  });

  return {
    year: input.year,
    formula:
      'soma de TOTAL GERAL LINHA dos periodos 20, 30 e 40 por funcionario/competencia; cada funcionario e somado uma unica vez por equipe',
    source: {
      queryCode: 'IND.BI.0025',
      field: 'TOTAL GERAL LINHA',
      periods: [20, 30, 40],
      assignmentRule:
        'vinculo JR por vigencia nas categorias VIBROACABADORA, ROLO_LISO e ROLO_PNEUS',
      pfrateiofixoApplied: false,
    },
    persistence: 'DERIVED_ONLY_NO_NEW_FACTS' as const,
    participatesInFirstConsolidated: false as const,
    months,
    integrity: {
      crossTeamConflictMonths: months.reduce(
        (sum, month) =>
          sum + month.teams.filter((team) => team.conflictEmployeeCount > 0).length,
        0,
      ),
      calculatedTeamMonths: months.reduce(
        (sum, month) => sum + month.teams.filter((team) => team.status === 'CALCULADO').length,
        0,
      ),
    },
  };
}
