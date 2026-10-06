import { Prisma } from '@prisma/client';

type ProductionMonth = {
  competence: string;
  covered: boolean;
  teams: Array<{
    teamId: string;
    businessCode: string | null;
    displayName: string | null;
    responsibleName: string | null;
    totalTon: string | null;
  }>;
};

type EquipmentMonth = {
  competence: string;
  teams: Array<{
    teamId: string;
    categories: Array<{
      category: string;
      label: string;
      productiveAmount: string | null;
      unproductiveAmount: string | null;
    }>;
  }>;
};

type LaborMonth = {
  competence: string;
  teams: Array<{
    teamId: string;
    amount: string | null;
    status: string;
  }>;
};

export function reconcileUsinaAsphaltEquipmentDerivedCosts(input: {
  year: number;
  productionMonths: ProductionMonth[];
  equipmentMonths: EquipmentMonth[];
  laborMonths: LaborMonth[];
}) {
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const competence = `${input.year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const production = input.productionMonths.find((row) => row.competence === competence);
    const equipment = input.equipmentMonths.find((row) => row.competence === competence);
    const labor = input.laborMonths.find((row) => row.competence === competence);

    const teams = (production?.teams || []).map((productionTeam) => {
      const equipmentTeam = equipment?.teams.find((row) => row.teamId === productionTeam.teamId);
      const laborTeam = labor?.teams.find((row) => row.teamId === productionTeam.teamId);
      const components = (equipmentTeam?.categories || []).flatMap((category) => [
        {
          code: `${category.category}_PRODUCTIVE_AMOUNT`,
          label: `${category.label} produtivo S/OPERADOR`,
          sourceKind: 'EQUIPMENT_AMOUNT' as const,
          covered: category.productiveAmount !== null,
          amount: category.productiveAmount,
        },
        {
          code: `${category.category}_UNPRODUCTIVE_AMOUNT`,
          label: `${category.label} improdutivo S/OPERADOR`,
          sourceKind: 'EQUIPMENT_AMOUNT' as const,
          covered: category.unproductiveAmount !== null,
          amount: category.unproductiveAmount,
        },
      ]);
      const expectedCategories = ['VIBROACABADORA', 'ROLO_LISO', 'ROLO_PNEUS'];
      const normalizedComponents = expectedCategories.flatMap((category) => {
        const productive = components.find((row) => row.code === `${category}_PRODUCTIVE_AMOUNT`);
        const unproductive = components.find((row) => row.code === `${category}_UNPRODUCTIVE_AMOUNT`);
        const label = category === 'VIBROACABADORA' ? 'Vibroacabadora' : category === 'ROLO_LISO' ? 'Rolo liso' : 'Rolo pneu';
        return [
          productive || { code: `${category}_PRODUCTIVE_AMOUNT`, label: `${label} produtivo S/OPERADOR`, sourceKind: 'EQUIPMENT_AMOUNT' as const, covered: false, amount: null },
          unproductive || { code: `${category}_UNPRODUCTIVE_AMOUNT`, label: `${label} improdutivo S/OPERADOR`, sourceKind: 'EQUIPMENT_AMOUNT' as const, covered: false, amount: null },
        ];
      });
      const laborComponent = {
        code: 'LABOR_AMOUNT',
        label: 'Mao de obra (Vibro. + Rolo liso + Rolo pneu)',
        sourceKind: 'LABOR' as const,
        covered: laborTeam?.amount !== null && laborTeam?.amount !== undefined,
        amount: laborTeam?.amount ?? null,
      };
      const allComponents = [...normalizedComponents, laborComponent];
      const costsCovered = allComponents.every((component) => component.covered && component.amount !== null);
      const total = costsCovered
        ? allComponents.reduce((sum, component) => sum.plus(component.amount || 0), new Prisma.Decimal(0))
        : null;
      const productionTon = production?.covered ? productionTeam.totalTon : null;
      const productionValue = productionTon === null || productionTon === undefined ? null : new Prisma.Decimal(productionTon);
      const unitCost = total && productionValue?.gt(0) ? total.div(productionValue).toFixed(12) : null;
      const status = !costsCovered
        ? 'PARCELA_MONETARIA_NAO_COBERTA'
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
        components: allComponents,
        costsCovered,
        productionCovered: Boolean(production?.covered),
        productionTon,
        totalAmount: total ? total.toFixed(6) : null,
        unitCost,
        status,
      };
    });
    return { competence, productionCovered: Boolean(production?.covered), teams };
  });

  const teamMonths = months.flatMap((month) => month.teams);
  return {
    year: input.year,
    formulas: {
      total: 'TOTAL (R$) = seis valores produtivos/improdutivos S/OPERADOR + Mao de obra',
      unitCost: 'CUSTO UNIT. (R$/T) = TOTAL (R$) / Producao (t)',
    },
    persistence: 'DERIVED_ONLY_NO_NEW_FACTS' as const,
    participatesInFirstConsolidated: false as const,
    months,
    integrity: {
      calculatedTeamMonths: teamMonths.filter((team) => team.status === 'CALCULADO').length,
      incompleteFinancialTeamMonths: teamMonths.filter((team) => team.status === 'PARCELA_MONETARIA_NAO_COBERTA').length,
      zeroProductionTeamMonths: teamMonths.filter((team) => team.status === 'PRODUCAO_ZERO').length,
      productionIncludedInTotal: false as const,
      hourlyRatesIncludedInTotal: false as const,
      hoursIncludedInTotal: false as const,
      firstBlockIncludedInTotal: false as const,
    },
  };
}
