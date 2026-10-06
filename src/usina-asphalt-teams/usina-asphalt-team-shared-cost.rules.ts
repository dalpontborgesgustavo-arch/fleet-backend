import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dateKey } from './usina-asphalt-teams.rules';

export const USINA_ASPHALT_TEAM_SHARED_COSTS = [
  {
    costClass: 'BANHEIRO_QUIMICO_EQUIPE_ASFALTO',
    label: 'Banheiro químico',
    dataset: 'PAYABLE_EXPENSES',
    accountPlanId: 839,
  },
  {
    costClass: 'MATERIAL_EXPEDIENTE',
    label: 'Material de expediente',
    dataset: 'INTERNAL_CONSUMPTION_EXPENSES',
    accountPlanId: 1236,
  },
] as const;

export type UsinaAsphaltTeamSharedCostClass =
  (typeof USINA_ASPHALT_TEAM_SHARED_COSTS)[number]['costClass'];

export function normalizeSharedCostClass(
  value: unknown,
): UsinaAsphaltTeamSharedCostClass {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  const definition = USINA_ASPHALT_TEAM_SHARED_COSTS.find(
    (item) => item.costClass === normalized,
  );
  if (!definition) {
    throw new BadRequestException('Rubrica compartilhada invalida');
  }
  return definition.costClass;
}

type SharedCostFact = {
  sourceRecordId: string;
  dataset: string;
  costClass: string;
  competence: Date | string;
  amount: Prisma.Decimal | string | number;
  active?: boolean;
};

type ProductionTeamRow = {
  teamId: string;
  businessCode: string | null;
  displayName: string | null;
  responsibleName: string | null;
  totalTon: string | null;
};

type ProductionMonthRow = {
  competence: string;
  covered: boolean;
  teams: ProductionTeamRow[];
};

const amount = (value: Prisma.Decimal) => value.toFixed(6);

export function reconcileUsinaAsphaltTeamSharedCosts(input: {
  year: number;
  facts: SharedCostFact[];
  productionMonths: ProductionMonthRow[];
  coveredCompetencesByClass: Partial<
    Record<UsinaAsphaltTeamSharedCostClass, Iterable<string>>
  >;
}) {
  const coveredByClass = new Map<
    UsinaAsphaltTeamSharedCostClass,
    Set<string>
  >(
    USINA_ASPHALT_TEAM_SHARED_COSTS.map((definition) => [
      definition.costClass,
      new Set(input.coveredCompetencesByClass[definition.costClass] || []),
    ]),
  );
  const duplicateFactKeys: string[] = [];
  const factsByKey = new Map<string, SharedCostFact>();
  for (const fact of input.facts) {
    if (fact.active === false) continue;
    if (
      !USINA_ASPHALT_TEAM_SHARED_COSTS.some(
        (definition) => definition.costClass === fact.costClass,
      )
    ) {
      continue;
    }
    const key = `${fact.dataset}|${fact.sourceRecordId}`;
    if (factsByKey.has(key)) {
      duplicateFactKeys.push(key);
      continue;
    }
    factsByKey.set(key, fact);
  }

  const lines = USINA_ASPHALT_TEAM_SHARED_COSTS.map((definition) => {
    const classCoverage = coveredByClass.get(definition.costClass)!;
    const months = Array.from({ length: 12 }, (_, monthIndex) => {
      const competence = `${input.year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
      const production = input.productionMonths.find(
        (month) => month.competence === competence,
      );
      const sourceCovered = classCoverage.has(competence);
      const productionCovered = Boolean(production?.covered);
      const covered = sourceCovered && productionCovered;
      const sourceFacts = [...factsByKey.values()].filter(
        (fact) =>
          fact.costClass === definition.costClass &&
          dateKey(fact.competence) === competence,
      );
      const sourceTotal = sourceFacts.reduce(
        (sum, fact) => sum.plus(fact.amount),
        new Prisma.Decimal(0),
      );
      const productiveTeams = (production?.teams || []).filter(
        (team) =>
          team.totalTon !== null && new Prisma.Decimal(team.totalTon).gt(0),
      );
      const divisor = productiveTeams.length;
      const quotient =
        covered && divisor > 0
          ? new Prisma.Decimal(sourceTotal.div(divisor).toFixed(12))
          : new Prisma.Decimal(0);
      const allocatedTotal = quotient.mul(divisor);
      const nonAllocated =
        covered && divisor === 0 ? sourceTotal : new Prisma.Decimal(0);
      const roundingResidual = covered
        ? sourceTotal.minus(allocatedTotal).minus(nonAllocated)
        : new Prisma.Decimal(0);
      const teamRows = (production?.teams || []).map((team) => ({
        teamId: team.teamId,
        businessCode: team.businessCode,
        displayName: team.displayName,
        responsibleName: team.responsibleName,
        productionTon: productionCovered ? team.totalTon : null,
        productive: covered
          ? productiveTeams.some((item) => item.teamId === team.teamId)
          : null,
        amount: covered
          ? amount(
              productiveTeams.some((item) => item.teamId === team.teamId)
                ? quotient
                : new Prisma.Decimal(0),
            )
          : null,
      }));
      const closureDelta = covered
        ? sourceTotal
            .minus(allocatedTotal)
            .minus(nonAllocated)
            .minus(roundingResidual)
        : null;

      return {
        competence,
        covered,
        sourceCovered,
        productionCovered,
        sourceTotal: covered ? amount(sourceTotal) : null,
        sourceDocuments: covered ? sourceFacts.length : null,
        productiveTeamCount: covered ? divisor : null,
        quotient: covered && divisor > 0 ? quotient.toFixed(12) : null,
        allocatedTotal: covered ? amount(allocatedTotal) : null,
        nonAllocated: covered ? amount(nonAllocated) : null,
        roundingResidual: covered ? roundingResidual.toFixed(12) : null,
        teams: teamRows,
        status: !sourceCovered
          ? 'FONTE_NAO_COBERTA'
          : !productionCovered
            ? 'PRODUCAO_NAO_COBERTA'
            : divisor === 0 && sourceTotal.gt(0)
              ? 'SEM_EQUIPE_PRODUTIVA'
              : 'RATEADO',
        closure: {
          formula:
            'soma_equipes + nao_alocado + residuo_arredondamento = total_fonte',
          deltaAmount: closureDelta ? closureDelta.toFixed(12) : null,
          closed: closureDelta ? closureDelta.eq(0) : null,
        },
      };
    });
    return { ...definition, months };
  });

  const allMonths = lines.flatMap((line) => line.months);
  return {
    year: input.year,
    allocationRule:
      'total mensal da rubrica dividido igualmente pelas equipes dinamicas com Producao (t) consolidada maior que zero',
    lines,
    integrity: {
      duplicateFactKeys: [...new Set(duplicateFactKeys)].sort(),
      duplicateFactCount: new Set(duplicateFactKeys).size,
      coveredMonths: allMonths.filter((month) => month.covered).length,
      expectedMonths: USINA_ASPHALT_TEAM_SHARED_COSTS.length * 12,
      everyCoveredMonthClosed: allMonths
        .filter((month) => month.covered)
        .every((month) => month.closure.closed === true),
      unallocatedMonths: allMonths.filter(
        (month) => month.status === 'SEM_EQUIPE_PRODUTIVA',
      ).length,
    },
  };
}
