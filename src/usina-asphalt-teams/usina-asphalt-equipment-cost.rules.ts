import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const ASPHALT_EQUIPMENT_COST_CATEGORIES = [
  { category: 'VIBROACABADORA', label: 'Vibroacabadora' },
  { category: 'ROLO_LISO', label: 'Rolo liso' },
  { category: 'ROLO_PNEUS', label: 'Rolo pneu' },
] as const;

export const ASPHALT_EQUIPMENT_COST_METRICS = [
  'PRODUCTIVE_HOURS',
  'UNPRODUCTIVE_HOURS',
  'PRODUCTIVE_AMOUNT',
  'UNPRODUCTIVE_AMOUNT',
] as const;

export type AsphaltEquipmentCostMetric =
  (typeof ASPHALT_EQUIPMENT_COST_METRICS)[number];

type EquipmentGroup = {
  competence: string | null;
  status: string;
  category: string;
  hourType: string;
  teamId: string | null;
  teamCode: string | null;
  teamName: string | null;
  facts: number;
  hours: string;
};

type RateMonth = {
  competence: string;
  categories: Array<{
    category: string;
    productiveRate: string | null;
    unproductiveRate: string | null;
  }>;
};

function monthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

function calculatedAmount(rate: string | null, hours: string | null) {
  if (rate === null || hours === null) return null;
  return new Prisma.Decimal(rate).mul(hours).toFixed(6);
}

export function normalizeEquipmentCostMetric(
  value: unknown,
): AsphaltEquipmentCostMetric {
  const metric = String(value || '').trim().toUpperCase();
  if (
    !ASPHALT_EQUIPMENT_COST_METRICS.includes(
      metric as AsphaltEquipmentCostMetric,
    )
  ) {
    throw new BadRequestException('Metrica de equipamento invalida');
  }
  return metric as AsphaltEquipmentCostMetric;
}

export function reconcileUsinaAsphaltEquipmentCosts(input: {
  year: number;
  groups: EquipmentGroup[];
  rateMonths: RateMonth[];
}) {
  const negativeAllocated = input.groups.filter(
    (group) =>
      group.status === 'ALOCADO' &&
      new Prisma.Decimal(group.hours || 0).isNegative(),
  );
  const allocated = input.groups.filter(
    (group) =>
      group.status === 'ALOCADO' &&
      !new Prisma.Decimal(group.hours || 0).isNegative() &&
      group.teamId &&
      group.competence?.startsWith(`${input.year}-`) &&
      ASPHALT_EQUIPMENT_COST_CATEGORIES.some(
        (definition) => definition.category === group.category,
      ) &&
      ['PRODUTIVA', 'IMPRODUTIVA'].includes(group.hourType),
  );

  const aggregates = new Map<
    string,
    {
      competence: string;
      teamId: string;
      businessCode: string | null;
      displayName: string | null;
      category: string;
      hourType: string;
      facts: number;
      hours: Prisma.Decimal;
    }
  >();

  for (const group of allocated) {
    const key = [
      group.competence,
      group.teamId,
      group.category,
      group.hourType,
    ].join('|');
    const current = aggregates.get(key) || {
      competence: group.competence!,
      teamId: group.teamId!,
      businessCode: group.teamCode,
      displayName: group.teamName,
      category: group.category,
      hourType: group.hourType,
      facts: 0,
      hours: new Prisma.Decimal(0),
    };
    current.facts += Number(group.facts || 0);
    current.hours = current.hours.plus(group.hours || 0);
    aggregates.set(key, current);
  }

  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const competence = monthKey(input.year, monthIndex);
    const rateMonth = input.rateMonths.find(
      (month) => month.competence === competence,
    );
    const monthAggregates = [...aggregates.values()].filter(
      (entry) => entry.competence === competence,
    );
    const teamIds = [...new Set(monthAggregates.map((entry) => entry.teamId))];

    return {
      competence,
      teams: teamIds.map((teamId) => {
        const teamRows = monthAggregates.filter(
          (entry) => entry.teamId === teamId,
        );
        const profile = teamRows[0];
        return {
          teamId,
          businessCode: profile?.businessCode || null,
          displayName: profile?.displayName || null,
          categories: ASPHALT_EQUIPMENT_COST_CATEGORIES.map((definition) => {
            const productive = teamRows.find(
              (entry) =>
                entry.category === definition.category &&
                entry.hourType === 'PRODUTIVA',
            );
            const unproductive = teamRows.find(
              (entry) =>
                entry.category === definition.category &&
                entry.hourType === 'IMPRODUTIVA',
            );
            const rate = rateMonth?.categories.find(
              (entry) => entry.category === definition.category,
            );
            const productiveHours = productive
              ? productive.hours.toFixed(6)
              : null;
            const unproductiveHours = unproductive
              ? unproductive.hours.toFixed(6)
              : null;
            const productiveRate = rate?.productiveRate ?? null;
            const unproductiveRate = rate?.unproductiveRate ?? null;

            return {
              category: definition.category,
              label: definition.label,
              productiveFacts: productive?.facts ?? null,
              unproductiveFacts: unproductive?.facts ?? null,
              productiveHours,
              unproductiveHours,
              productiveRate,
              unproductiveRate,
              productiveAmount: calculatedAmount(
                productiveRate,
                productiveHours,
              ),
              unproductiveAmount: calculatedAmount(
                unproductiveRate,
                unproductiveHours,
              ),
            };
          }),
        };
      }),
    };
  });

  return {
    year: input.year,
    formulas: {
      productiveHours:
        'soma de quantityHours dos fatos ALOCADO com hourType PRODUTIVA',
      unproductiveHours:
        'soma de quantityHours dos fatos ALOCADO com hourType IMPRODUTIVA',
      productiveAmount:
        'tarifa produtiva mensal JR_MANUAL da categoria x horas produtivas',
      unproductiveAmount:
        'tarifa improdutiva mensal JR_MANUAL da categoria x horas improdutivas',
    },
    source: {
      dataset: 'ASPHALT_EQUIPMENT_HOURS',
      rateSource: 'JR_MANUAL',
      assignmentRule:
        'ID_VEICULO + sourceDate dentro da vigencia + categoria identica',
    },
    persistence: 'DERIVED_ONLY_NO_NEW_FACTS' as const,
    participatesInFirstConsolidated: false as const,
    months,
    integrity: {
      allocatedFacts: allocated.reduce(
        (sum, group) => sum + Number(group.facts || 0),
        0,
      ),
      allocatedHours: allocated
        .reduce(
          (sum, group) => sum.plus(group.hours || 0),
          new Prisma.Decimal(0),
        )
        .toFixed(6),
      negativePendingFacts: negativeAllocated.reduce(
        (sum, group) => sum + Number(group.facts || 0),
        0,
      ),
      negativePendingHours: negativeAllocated
        .reduce(
          (sum, group) => sum.plus(group.hours || 0),
          new Prisma.Decimal(0),
        )
        .toFixed(6),
    },
  };
}
