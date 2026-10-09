import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BudgetAnalysisService } from './budget-analysis.service';

describe('SSMA security budget', () => {
  const makePrisma = () => ({
    budgetVersion: {
      findFirst: jest.fn().mockResolvedValue({ id: 'budget-2026' }),
    },
    budgetLine: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        if (where.idSubgrupo.in.includes('1116')) {
          return [
            {
              idSubgrupo: '1116',
              monthlyCost: 900,
              monthlyBudgets: [{ amount: 1000 }],
            },
          ];
        }
        return [
          {
            idSubgrupo: '1445',
            monthlyCost: 39000,
            monthlyBudgets: [{ amount: 35000 }],
          },
        ];
      }),
    },
    aethosPlanoContaCost: {
      groupBy: jest.fn().mockImplementation(({ where }) =>
        where.AND[1].OR
          ? [
              { codigoPlanoConta: '1116', _sum: { valorCusto: 5600 } },
              { codigoPlanoConta: '1445', _sum: { valorCusto: 1500 } },
            ]
          : [{ codigoPlanoConta: '1445', _sum: { valorCusto: 50000 } }],
      ),
      findFirst: jest.fn().mockResolvedValue({
        syncedAt: new Date('2026-10-09T12:00:00Z'),
      }),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { valorCusto: 300 },
      }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'cost-1',
          idLancamento: 'aethos-1',
          nomeEmpresa: 'JR Construcoes',
          dataBaseLancamento: new Date('2026-09-15T00:00:00Z'),
          dataLancamento: new Date('2026-09-16T00:00:00Z'),
          numeroNotaFiscal: '123',
          dataEmissaoNotaFiscal: new Date('2026-09-10T00:00:00Z'),
          observacaoLancamento: 'Exame ocupacional',
          observacaoNotaFiscal: null,
          valorCusto: 150,
          raw: {
            nomeObra: 'Usina',
            nomeCentroCusto: 'SSMA',
            confidentialExtra: 'never-return',
          },
        },
      ]),
    },
  });

  it('denies SSMA access to the unrestricted overview and unrelated roles to the SSMA view', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);

    await expect(service.getOverview({}, 'ssma')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getSsmaOverview({}, 'gestor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.budgetVersion.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a third company rather than silently broadening the query', async () => {
    const service = new BudgetAnalysisService(makePrisma() as never);
    await expect(
      service.getSsmaOverview({ company: 'PRUMARE' }, 'ssma'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns fixed JR budgets and only JR actuals, without revenue or scenarios', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);
    const result = await service.getSsmaOverview(
      { company: 'JR_CONSTRUCOES', year: 2026, month: 9 },
      'ssma',
    );

    expect(prisma.aethosPlanoContaCost.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ competencia: '2026-09' }),
            expect.objectContaining({
              codigoEmpresa: '1',
              codigoPlanoConta: expect.objectContaining({
                in: expect.arrayContaining(['1445', '393', '1545']),
              }),
            }),
          ]),
        }),
      }),
    );
    expect(result.summary).toEqual({
      budget: 35000,
      realized: 50000,
      variance: -15000,
      percentUsed: 142.9,
    });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '1445',
          category: 'SAFETY',
          hasBudget: true,
          budget: 35000,
          realized: 50000,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(/revenue|scenario|faturamento/i);
  });

  it('does not assign a shared JR budget to Pedraforte EPI actuals', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);
    const result = await service.getSsmaOverview(
      { company: 'PEDRAFORTE', year: 2026, month: 9 },
      'ssma',
    );

    expect(prisma.budgetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idSubgrupo: {
            in: expect.arrayContaining(['1116', '1467', '1126', '822']),
          },
        }),
      }),
    );
    expect(prisma.aethosPlanoContaCost.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  codigoEmpresa: { in: ['1', '4'] },
                  codigoPlanoConta: expect.objectContaining({
                    in: expect.arrayContaining(['1116', '1126', '822']),
                  }),
                }),
                expect.objectContaining({
                  codigoEmpresa: '4',
                  codigoPlanoConta: { in: ['1445', '851', '186'] },
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '1445',
          hasBudget: false,
          budget: 0,
          realized: 1500,
        }),
      ]),
    );
    expect(result.summary).toEqual({
      budget: 1000,
      realized: 7100,
      variance: -6100,
      percentUsed: 710,
    });
  });

  it('includes approved guarding and environmental plans without other companies', async () => {
    const prisma = makePrisma();
    prisma.budgetLine.findMany.mockResolvedValue([
      { idSubgrupo: '1126', monthlyCost: 4000, monthlyBudgets: [] },
      { idSubgrupo: '822', monthlyCost: 1100, monthlyBudgets: [] },
    ]);
    prisma.aethosPlanoContaCost.groupBy.mockResolvedValue([
      { codigoPlanoConta: '1126', _sum: { valorCusto: 9000 } },
      { codigoPlanoConta: '822', _sum: { valorCusto: 500 } },
    ]);
    const service = new BudgetAnalysisService(prisma as never);

    const result = await service.getSsmaOverview(
      { company: 'PEDRAFORTE', year: 2026, month: 9 },
      'ssma',
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        code: '1126',
        category: 'GUARDING',
        budget: 4000,
        realized: 9000,
      }),
      expect.objectContaining({
        code: '822',
        category: 'ENVIRONMENT',
        budget: 1100,
        realized: 500,
      }),
    ]);
    expect(result.rows.some((row) => row.code === '826')).toBe(false);
  });

  it('returns only paginated JR expense details under the same scope as the overview', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);

    const result = await service.getSsmaActuals(
      { company: 'JR_CONSTRUCOES', year: 2026, month: 9, code: '393', page: 1 },
      'ssma',
    );

    const expectedWhere = {
      AND: [
        expect.objectContaining({
          active: true,
          competencia: '2026-09',
          AND: [{ OR: [{ status: null }, { status: { not: 'APR' } }] }],
        }),
        expect.objectContaining({
          codigoEmpresa: '1',
          codigoPlanoConta: expect.objectContaining({ in: expect.arrayContaining(['393']) }),
        }),
        { codigoPlanoConta: '393' },
      ],
    };
    expect(prisma.aethosPlanoContaCost.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.aethosPlanoContaCost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 0, take: 50 }),
    );
    expect(result.total).toBe(300);
    expect(result.count).toBe(2);
    expect(result.rows).toEqual([
      expect.objectContaining({
        idLancamento: 'aethos-1',
        dataReferencia: '2026-09-15T00:00:00.000Z',
        observacaoLancamento: 'Exame ocupacional',
        obra: 'Usina',
        centroCusto: 'SSMA',
        valor: 150,
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/confidentialExtra|revenue|scenario|faturamento/i);
  });

  it('keeps Pedraforte dedicated and shared-account scoping in the detail query', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);

    await service.getSsmaActuals(
      { company: 'PEDRAFORTE', year: 2026, month: 9, code: '1126', page: 2 },
      'admin',
    );
    expect(prisma.aethosPlanoContaCost.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip: 50,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  codigoEmpresa: { in: ['1', '4'] },
                  codigoPlanoConta: expect.objectContaining({ in: expect.arrayContaining(['1126']) }),
                }),
                expect.objectContaining({
                  codigoEmpresa: '4',
                  codigoPlanoConta: { in: ['1445', '851', '186'] },
                }),
              ]),
            }),
            { codigoPlanoConta: '1126' },
          ]),
        }),
      }),
    );

    await service.getSsmaActuals(
      { company: 'PEDRAFORTE', year: 2026, month: 9, code: '1445' },
      'ssma',
    );
    expect(prisma.aethosPlanoContaCost.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.arrayContaining([{ codigoPlanoConta: '1445' }]) }),
      }),
    );
  });

  it('denies unapproved roles, companies, account codes and pages before any database read', async () => {
    const prisma = makePrisma();
    const service = new BudgetAnalysisService(prisma as never);

    await expect(service.getSsmaActuals({ code: '393' }, 'gestor')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getSsmaActuals({ company: 'PRUMARE', code: '393' }, 'ssma')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getSsmaActuals({ code: '9999' }, 'ssma')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getSsmaActuals({ company: 'PEDRAFORTE', code: '393' }, 'ssma')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getSsmaActuals({ code: '393', page: -1 }, 'ssma')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aethosPlanoContaCost.findMany).not.toHaveBeenCalled();
  });
});
