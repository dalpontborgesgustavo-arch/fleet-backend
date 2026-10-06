import { BudgetAnalysisService } from './budget-analysis.service';

describe('BudgetAnalysisService invoice issue basis', () => {
  it('includes Aethos plan accounts that are not present in the budget', async () => {
    const budgetLineFindMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'line-10',
          idSubgrupo: '10',
          descricao: 'Materiais orcados',
          responsible: 'Compras',
          annualCost: 12000,
          monthlyCost: 1000,
          monthlyBudgets: [],
        },
      ])
      .mockResolvedValueOnce([]);
    const prisma = {
      budgetVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-2026',
          year: 2026,
          name: 'Orcamento 2026',
          baseRevenue: 21000000,
          importedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
      budgetLine: { findMany: budgetLineFindMany },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([
          {
            codigoPlanoConta: '10',
            nomePlanoConta: 'Materiais',
            _sum: { valorCusto: 250 },
          },
          {
            codigoPlanoConta: '99',
            nomePlanoConta: 'Despesa sem orcamento',
            _sum: { valorCusto: 400 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          syncedAt: new Date('2026-07-15T12:00:00.000Z'),
        }),
        count: jest.fn().mockResolvedValue(2),
      },
      aethosSubgroupActual: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new BudgetAnalysisService(prisma as never);

    const result = await service.getOverview(
      { year: 2026, month: 7, dateBasis: 'lancamento' },
      'admin',
    );

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idSubgrupo: '10',
          company: 'JR_CONSTRUCOES',
          isBudgeted: true,
          originalMonthlyCost: 1000,
          monthlyCost: 1000,
          realized: 250,
        }),
        expect.objectContaining({
          id: 'aethos:99',
          idSubgrupo: '99',
          descricao: 'Despesa sem orcamento',
          company: 'JR_CONSTRUCOES',
          isBudgeted: false,
          originalMonthlyCost: 0,
          responsible: 'Sem Responsável',
          monthlyCost: 0,
          realized: 400,
          variance: -400,
          status: 'OVER',
        }),
      ]),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        realized: 650,
        lines: 2,
        budgetedLines: 1,
        unbudgetedLines: 1,
      }),
    );
    expect(result.responsibles).toContain('Sem Responsável');
  });

  it('filters multiple companies from the plan description without case sensitivity', async () => {
    const budgetLineFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const prisma = {
      budgetVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-2026',
          year: 2026,
          name: 'Orcamento 2026',
          baseRevenue: 21000000,
          importedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
      budgetLine: { findMany: budgetLineFindMany },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([
          {
            codigoPlanoConta: '1',
            nomePlanoConta: 'Obra PEDRAFORTE Norte',
            _sum: { valorCusto: 100 },
          },
          {
            codigoPlanoConta: '2',
            nomePlanoConta: 'PRUMARE Condominio',
            _sum: { valorCusto: 200 },
          },
          {
            codigoPlanoConta: '3',
            nomePlanoConta: 'Custo administrativo',
            _sum: { valorCusto: 300 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(3),
      },
      aethosSubgroupActual: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new BudgetAnalysisService(prisma as never);

    const result = await service.getOverview(
      {
        year: 2026,
        month: 7,
        companies: 'PRUMARE,PEDRAFORTE',
      },
      'admin',
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idSubgrupo: '1',
          company: 'PEDRAFORTE',
          companyLabel: 'Pedraforte',
        }),
        expect.objectContaining({
          idSubgrupo: '2',
          company: 'PRUMARE',
          companyLabel: 'Prumare',
        }),
      ]),
    );
    expect(result.summary.realized).toBe(300);
    expect(result.filters.companies).toEqual(['PRUMARE', 'PEDRAFORTE']);
  });

  it('creates a zero-value budget line when assigning an existing responsible to an Aethos-only plan', async () => {
    const upsert = jest.fn().mockResolvedValue({
      id: 'line-99',
      idSubgrupo: '99',
      descricao: 'Despesa sem orcamento',
      responsible: 'Compras',
    });
    const prisma = {
      budgetVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'version-2026' }),
      },
      budgetLine: { upsert },
    };
    const service = new BudgetAnalysisService(prisma as never);

    const result = await service.updateResponsible(
      {
        year: 2026,
        lineId: 'aethos:99',
        idSubgrupo: '99',
        descricao: 'Despesa sem orcamento',
        responsible: 'Compras',
      },
      'admin',
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          idSubgrupo: '99',
          responsible: 'Compras',
          referenceYear: 2026,
        }),
      }),
    );
    expect(result.responsible).toBe('Compras');
  });

  it('uses invoice issue date only for linked invoices and launch date otherwise', async () => {
    const findPlanAccountRows = jest.fn().mockResolvedValue([]);
    const prisma = {
      aethosPlanoContaCost: { findMany: findPlanAccountRows },
      aethosSubgroupActual: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new BudgetAnalysisService(prisma as never);

    await service.getActuals(
      {
        year: 2026,
        month: 7,
        idSubgrupo: '10',
        dateBasis: 'emissao_nf',
      },
      'admin',
    );

    const range = {
      gte: new Date('2026-07-01T00:00:00.000Z'),
      lt: new Date('2026-08-01T00:00:00.000Z'),
    };
    expect(findPlanAccountRows).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          codigoPlanoConta: '10',
          OR: [
            { temNotaFiscal: true, dataEmissaoNotaFiscal: range },
            { temNotaFiscal: false, dataLancamento: range },
          ],
          AND: [
            {
              OR: [{ status: null }, { status: { not: 'APR' } }],
            },
          ],
        }),
      }),
    );
  });

  it('excludes Aethos forecast entries by default and allows selecting only forecasts', async () => {
    const findPlanAccountRows = jest.fn().mockResolvedValue([]);
    const prisma = {
      aethosPlanoContaCost: { findMany: findPlanAccountRows },
      aethosSubgroupActual: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new BudgetAnalysisService(prisma as never);

    const defaultResult = await service.getActuals(
      {
        year: 2026,
        month: 7,
        idSubgrupo: '38',
        dateBasis: 'lancamento',
      },
      'admin',
    );
    const forecastResult = await service.getActuals(
      {
        year: 2026,
        month: 7,
        idSubgrupo: '38',
        dateBasis: 'lancamento',
        forecastFilter: 'only_forecast',
      },
      'admin',
    );

    expect(findPlanAccountRows.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        active: true,
        competencia: '2026-07',
        AND: [
          {
            OR: [{ status: null }, { status: { not: 'APR' } }],
          },
        ],
      }),
    );
    expect(findPlanAccountRows.mock.calls[1][0].where).toEqual(
      expect.objectContaining({
        active: true,
        competencia: '2026-07',
        status: 'APR',
      }),
    );
    expect(defaultResult.forecastFilter).toBe('without_forecast');
    expect(forecastResult.forecastFilter).toBe('only_forecast');
  });

  it('saves each monthly budget with an independent year and month key', async () => {
    const upsert = jest.fn().mockImplementation(({ where, create }) =>
      Promise.resolve({
        id: `${where.lineId_year_month.lineId}-${where.lineId_year_month.month}`,
        ...create,
        updatedAt: new Date('2026-07-14T12:00:00.000Z'),
      }),
    );
    const prisma = {
      budgetVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'version-2026' }),
      },
      budgetLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'line-10',
          idSubgrupo: '10',
          descricao: 'Materiais',
        }),
      },
      budgetMonthlyLine: { upsert },
    };
    const service = new BudgetAnalysisService(prisma as never);

    await service.updateMonthlyBudget(
      'line-10',
      { year: 2026, month: 7, amount: 1500 },
      'admin',
      'user-1',
    );
    await service.updateMonthlyBudget(
      'line-10',
      { year: 2026, month: 8, amount: 2200 },
      'admin',
      'user-1',
    );

    expect(upsert.mock.calls[0][0].where.lineId_year_month).toEqual({
      lineId: 'line-10',
      year: 2026,
      month: 7,
    });
    expect(upsert.mock.calls[1][0].where.lineId_year_month).toEqual({
      lineId: 'line-10',
      year: 2026,
      month: 8,
    });
  });
});
