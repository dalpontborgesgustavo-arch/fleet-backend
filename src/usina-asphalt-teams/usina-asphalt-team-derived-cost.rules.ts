import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  USINA_ASPHALT_FLEET_CATEGORIES,
  USINA_ASPHALT_FLEET_CATEGORY_LABELS,
  UsinaAsphaltFleetCategory,
} from './usina-asphalt-team-fleet.rules';
import {
  USINA_ASPHALT_TEAM_SHARED_COSTS,
  UsinaAsphaltTeamSharedCostClass,
} from './usina-asphalt-team-shared-cost.rules';

export const USINA_ASPHALT_TEAM_DERIVED_COST_METRICS = [
  'TOTAL',
  'UNIT_COST',
] as const;

export type UsinaAsphaltTeamDerivedCostMetric =
  (typeof USINA_ASPHALT_TEAM_DERIVED_COST_METRICS)[number];

export function normalizeDerivedCostMetric(
  value: unknown,
): UsinaAsphaltTeamDerivedCostMetric {
  const metric = String(value || '')
    .trim()
    .toUpperCase();
  if (
    !USINA_ASPHALT_TEAM_DERIVED_COST_METRICS.includes(
      metric as UsinaAsphaltTeamDerivedCostMetric,
    )
  ) {
    throw new BadRequestException('Metrica derivada invalida');
  }
  return metric as UsinaAsphaltTeamDerivedCostMetric;
}

type ProductionTeam = {
  teamId: string;
  businessCode: string | null;
  displayName: string | null;
  responsibleName: string | null;
  totalTon: string | null;
};

type ProductionMonth = {
  competence: string;
  covered: boolean;
  teams: ProductionTeam[];
};

type FleetMonth = {
  competence: string;
  covered: boolean;
  teams: Array<{
    teamId: string;
    categories: Array<{
      category: string;
      label: string;
      amount: string | null;
    }>;
  }>;
};

type SharedCostLine = {
  costClass: string;
  label: string;
  months: Array<{
    competence: string;
    covered: boolean;
    teams: Array<{ teamId: string; amount: string | null }>;
  }>;
};

export type UsinaAsphaltTeamDerivedComponent = {
  code: UsinaAsphaltFleetCategory | UsinaAsphaltTeamSharedCostClass;
  label: string;
  sourceKind: 'FREIGHT' | 'SHARED_COST';
  covered: boolean;
  amount: string | null;
};

const amount = (value: Prisma.Decimal) => value.toFixed(6);

export function reconcileUsinaAsphaltTeamDerivedCosts(input: {
  year: number;
  productionMonths: ProductionMonth[];
  fleetFreightMonths: FleetMonth[];
  sharedCostLines: SharedCostLine[];
}) {
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const competence = `${input.year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const production = input.productionMonths.find(
      (month) => month.competence === competence,
    );
    const freight = input.fleetFreightMonths.find(
      (month) => month.competence === competence,
    );

    const teams = (production?.teams || []).map((productionTeam) => {
      const freightTeam = freight?.teams.find(
        (team) => team.teamId === productionTeam.teamId,
      );
      const freightComponents: UsinaAsphaltTeamDerivedComponent[] =
        USINA_ASPHALT_FLEET_CATEGORIES.map((category) => {
          const row = freightTeam?.categories.find(
            (item) => item.category === category,
          );
          const covered = Boolean(freight?.covered && row?.amount !== null);
          return {
            code: category,
            label: USINA_ASPHALT_FLEET_CATEGORY_LABELS[category],
            sourceKind: 'FREIGHT',
            covered,
            amount: covered ? row?.amount || '0.000000' : null,
          };
        });
      const sharedComponents: UsinaAsphaltTeamDerivedComponent[] =
        USINA_ASPHALT_TEAM_SHARED_COSTS.map((definition) => {
          const line = input.sharedCostLines.find(
            (item) => item.costClass === definition.costClass,
          );
          const month = line?.months.find(
            (item) => item.competence === competence,
          );
          const row = month?.teams.find(
            (item) => item.teamId === productionTeam.teamId,
          );
          const covered = Boolean(month?.covered && row?.amount !== null);
          return {
            code: definition.costClass,
            label: definition.label,
            sourceKind: 'SHARED_COST',
            covered,
            amount: covered ? row?.amount || '0.000000' : null,
          };
        });
      const components = [...freightComponents, ...sharedComponents];
      const costsCovered = components.every(
        (component) => component.covered && component.amount !== null,
      );
      const total = costsCovered
        ? components.reduce(
            (sum, component) => sum.plus(component.amount || 0),
            new Prisma.Decimal(0),
          )
        : null;
      const productionTon = production?.covered
        ? productionTeam.totalTon
        : null;
      const productionValue =
        productionTon === null || productionTon === undefined
          ? null
          : new Prisma.Decimal(productionTon);
      const unitCost =
        total && productionValue?.gt(0)
          ? total.div(productionValue).toFixed(12)
          : null;
      const status = !costsCovered
        ? 'FONTE_FINANCEIRA_NAO_COBERTA'
        : productionTon === null
          ? 'PRODUCAO_NAO_COBERTA'
          : !productionValue?.gt(0)
            ? 'PRODUCAO_ZERO'
            : 'CALCULADO';

      return {
        teamId: productionTeam.teamId,
        businessCode: productionTeam.businessCode,
        displayName: productionTeam.displayName,
        responsibleName: productionTeam.responsibleName,
        components,
        costsCovered,
        productionCovered: Boolean(production?.covered),
        productionTon,
        totalAmount: total ? amount(total) : null,
        unitCost,
        status,
      };
    });

    return {
      competence,
      productionCovered: Boolean(production?.covered),
      fleetFreightCovered: Boolean(freight?.covered),
      sharedCostsCovered: USINA_ASPHALT_TEAM_SHARED_COSTS.every(
        (definition) =>
          input.sharedCostLines
            .find((line) => line.costClass === definition.costClass)
            ?.months.find((month) => month.competence === competence)
            ?.covered === true,
      ),
      teams,
    };
  });

  const teamMonths = months.flatMap((month) => month.teams);
  return {
    year: input.year,
    formulas: {
      total:
        'TOTAL (R$) = Vibroacabadora + Rolo liso + Rolo pneus + Microonibus + Veiculo apoio + Banheiro quimico + Material de expediente',
      unitCost: 'CUSTO UNIT. (R$/T) = TOTAL (R$) / Producao (t)',
    },
    persistence: 'DERIVED_ONLY_NO_NEW_FACTS',
    months,
    integrity: {
      calculatedTeamMonths: teamMonths.filter(
        (team) => team.status === 'CALCULADO',
      ).length,
      incompleteFinancialTeamMonths: teamMonths.filter(
        (team) => team.status === 'FONTE_FINANCEIRA_NAO_COBERTA',
      ).length,
      zeroProductionTeamMonths: teamMonths.filter(
        (team) => team.status === 'PRODUCAO_ZERO',
      ).length,
      productionMissingTeamMonths: teamMonths.filter(
        (team) => team.status === 'PRODUCAO_NAO_COBERTA',
      ).length,
      productionIncludedInTotal: false,
    },
  };
}
