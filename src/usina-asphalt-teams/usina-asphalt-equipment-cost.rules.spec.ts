import {
  normalizeEquipmentCostMetric,
  reconcileUsinaAsphaltEquipmentCosts,
} from './usina-asphalt-equipment-cost.rules';

describe('reconcileUsinaAsphaltEquipmentCosts', () => {
  it('usa somente fatos alocados e multiplica horas pela tarifa mensal', () => {
    const result = reconcileUsinaAsphaltEquipmentCosts({
      year: 2026,
      groups: [
        {
          competence: '2026-08-01',
          status: 'ALOCADO',
          category: 'VIBROACABADORA',
          hourType: 'PRODUTIVA',
          teamId: 'team-01',
          teamCode: '01',
          teamName: 'Silvano',
          facts: 4,
          hours: '63.000000',
        },
        {
          competence: '2026-08-01',
          status: 'ALOCADO',
          category: 'VIBROACABADORA',
          hourType: 'IMPRODUTIVA',
          teamId: 'team-01',
          teamCode: '01',
          teamName: 'Silvano',
          facts: 4,
          hours: '48.000000',
        },
        {
          competence: '2026-08-01',
          status: 'FROTA_SEM_CADASTRO_MENSAL',
          category: 'VIBROACABADORA',
          hourType: 'PRODUTIVA',
          teamId: null,
          teamCode: null,
          teamName: null,
          facts: 100,
          hours: '1000.000000',
        },
      ],
      rateMonths: [
        {
          competence: '2026-08-01',
          categories: [
            {
              category: 'VIBROACABADORA',
              productiveRate: '10.000000',
              unproductiveRate: '5.000000',
            },
          ],
        },
      ],
    });

    const category = result.months[7].teams[0].categories[0];
    expect(category).toEqual(
      expect.objectContaining({
        productiveFacts: 4,
        unproductiveFacts: 4,
        productiveHours: '63.000000',
        unproductiveHours: '48.000000',
        productiveAmount: '630.000000',
        unproductiveAmount: '240.000000',
      }),
    );
    expect(result.integrity).toEqual({
      allocatedFacts: 8,
      allocatedHours: '111.000000',
      negativePendingFacts: 0,
      negativePendingHours: '0.000000',
    });
  });

  it('mantem horas negativas como pendencia e fora dos calculos', () => {
    const result = reconcileUsinaAsphaltEquipmentCosts({
      year: 2026,
      groups: [
        {
          competence: '2026-08-01',
          status: 'ALOCADO',
          category: 'VIBROACABADORA',
          hourType: 'PRODUTIVA',
          teamId: 'team-01',
          teamCode: '01',
          teamName: 'Silvano',
          facts: 1,
          hours: '-2.500000',
        },
      ],
      rateMonths: [
        {
          competence: '2026-08-01',
          categories: [
            {
              category: 'VIBROACABADORA',
              productiveRate: '10.000000',
              unproductiveRate: '5.000000',
            },
          ],
        },
      ],
    });

    expect(result.months[7].teams).toEqual([]);
    expect(result.integrity).toEqual({
      allocatedFacts: 0,
      allocatedHours: '0.000000',
      negativePendingFacts: 1,
      negativePendingHours: '-2.500000',
    });
  });

  it('preserva zero factual e deixa valor null quando não há tarifa', () => {
    const result = reconcileUsinaAsphaltEquipmentCosts({
      year: 2026,
      groups: [
        {
          competence: '2026-01-01',
          status: 'ALOCADO',
          category: 'ROLO_LISO',
          hourType: 'PRODUTIVA',
          teamId: 'team-01',
          teamCode: '01',
          teamName: 'Silvano',
          facts: 1,
          hours: '0.000000',
        },
      ],
      rateMonths: [],
    });

    const category = result.months[0].teams[0].categories[1];
    expect(category.productiveHours).toBe('0.000000');
    expect(category.productiveAmount).toBeNull();
    expect(category.unproductiveHours).toBeNull();
  });

  it('valida a métrica da memória', () => {
    expect(normalizeEquipmentCostMetric('productive_amount')).toBe(
      'PRODUCTIVE_AMOUNT',
    );
    expect(() => normalizeEquipmentCostMetric('outra')).toThrow();
  });
});
