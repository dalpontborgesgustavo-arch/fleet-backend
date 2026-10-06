import { Prisma } from '@prisma/client';
import { TaxForecastsService } from './tax-forecasts.service';

describe('TaxForecastsService', () => {
  it('allows accounting to list only the requested year', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TaxForecastsService({
      taxForecast: { findMany },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any);

    const result = await service.findAll({ year: '2026' }, 'contabilidade');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { year: 2026 },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        year: 2026,
        entries: [],
        summary: {
          forecastAmount: 0,
          actualAmount: 0,
        },
      }),
    );
  });

  it('rejects roles outside accounting, administrator and CEO', async () => {
    const service = new TaxForecastsService({} as any);

    await expect(
      service.findAll({ year: '2026' }, 'financeiro'),
    ).rejects.toThrow('Sem permissão');
  });

  it('upserts zero values for the four supported taxes', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'tax-forecast-1' });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      taxForecast: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
      },
      taxForecastAudit: { create: auditCreate },
    };
    const transaction = jest
      .fn()
      .mockImplementation((callback) => callback(tx));
    const service = new TaxForecastsService({
      $transaction: transaction,
    } as any);

    const result = await service.upsertMany(
      {
        entries: ['PIS', 'COFINS', 'IRPJ', 'CSLL'].map((taxType) => ({
          company: 'JR_CONSTRUCOES',
          taxType,
          year: 2026,
          month: 7,
          forecastAmount: 0,
          actualAmount: 0,
        })),
      },
      'contabilidade',
      'accounting-user-1',
    );

    expect(result).toEqual({ ok: true, upserted: 4 });
    expect(upsert).toHaveBeenCalledTimes(4);
    expect(auditCreate).toHaveBeenCalledTimes(4);
  });

  it('records the before and after values when the manual actual changes', async () => {
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const previous = {
      id: 'tax-forecast-1',
      forecastAmount: new Prisma.Decimal('1000.00'),
      actualAmount: new Prisma.Decimal('725.50'),
    };
    const tx = {
      taxForecast: {
        findUnique: jest.fn().mockResolvedValue(previous),
        upsert: jest.fn().mockResolvedValue({
          ...previous,
          actualAmount: new Prisma.Decimal('800.00'),
        }),
      },
      taxForecastAudit: { create: auditCreate },
    };
    const service = new TaxForecastsService({
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    } as any);

    await service.upsertMany(
      {
        entries: [
          {
            company: 'JR_CONSTRUCOES',
            taxType: 'IRPJ',
            year: 2026,
            month: 9,
            forecastAmount: 1000,
            actualAmount: 800,
          },
        ],
      },
      'contabilidade',
      'accounting-user-1',
    );

    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE',
        source: 'MANUAL',
        changedById: 'accounting-user-1',
        previousData: {
          forecastAmount: 1000,
          actualAmountManual: 725.5,
        },
        nextData: {
          forecastAmount: 1000,
          actualAmountManual: 800,
        },
      }),
    });
  });

  it('does not create a duplicate audit when values remain unchanged', async () => {
    const auditCreate = jest.fn();
    const record = {
      id: 'tax-forecast-1',
      forecastAmount: new Prisma.Decimal('1000.00'),
      actualAmount: new Prisma.Decimal('725.50'),
    };
    const tx = {
      taxForecast: {
        findUnique: jest.fn().mockResolvedValue(record),
        upsert: jest.fn().mockResolvedValue(record),
      },
      taxForecastAudit: { create: auditCreate },
    };
    const service = new TaxForecastsService({
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    } as any);

    await service.upsertMany(
      {
        entries: [
          {
            company: 'JR_CONSTRUCOES',
            taxType: 'IRPJ',
            year: 2026,
            month: 9,
            forecastAmount: 1000,
            actualAmount: 725.5,
          },
        ],
      },
      'contabilidade',
      'accounting-user-1',
    );

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('uses the manual actual while Aethos is zero', async () => {
    const service = new TaxForecastsService({
      taxForecast: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tax-forecast-1',
            company: 'JR_CONSTRUCOES',
            taxType: 'IRPJ',
            year: 2026,
            month: 9,
            forecastAmount: new Prisma.Decimal('1000.00'),
            actualAmount: new Prisma.Decimal('725.50'),
            updatedById: 'accounting-user-1',
            updatedBy: { id: 'accounting-user-1', name: 'Contabilidade' },
            createdAt: new Date('2026-09-01T12:00:00.000Z'),
            updatedAt: new Date('2026-09-02T12:00:00.000Z'),
          },
        ]),
      },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([
          {
            codigoEmpresa: '1',
            codigoPlanoConta: '145',
            competencia: '2026-09',
            _sum: { valorCusto: 0 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any);

    const result = await service.findAll(
      { year: '2026', company: 'JR_CONSTRUCOES', taxType: 'IRPJ' },
      'contabilidade',
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        actualAmount: 725.5,
        actualAmountAethos: 0,
        actualAmountManual: 725.5,
        actualSource: 'MANUAL',
        actualOverrodeManual: false,
      }),
    ]);
  });

  it('keeps the manual fallback but prioritizes a nonzero Aethos actual', async () => {
    const service = new TaxForecastsService({
      taxForecast: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tax-forecast-1',
            company: 'JR_CONSTRUCOES',
            taxType: 'IRPJ',
            year: 2026,
            month: 9,
            forecastAmount: new Prisma.Decimal('1000.00'),
            actualAmount: new Prisma.Decimal('725.50'),
            updatedById: 'accounting-user-1',
            updatedBy: { id: 'accounting-user-1', name: 'Contabilidade' },
            createdAt: new Date('2026-09-01T12:00:00.000Z'),
            updatedAt: new Date('2026-09-02T12:00:00.000Z'),
          },
        ]),
      },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([
          {
            codigoEmpresa: '1',
            codigoPlanoConta: '145',
            competencia: '2026-09',
            _sum: { valorCusto: 930.25 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          syncedAt: new Date('2026-09-03T12:00:00.000Z'),
        }),
      },
    } as any);

    const result = await service.findAll(
      { year: '2026', company: 'JR_CONSTRUCOES', taxType: 'IRPJ' },
      'contabilidade',
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        actualAmount: 930.25,
        actualAmountAethos: 930.25,
        actualAmountManual: 725.5,
        actualSource: 'AETHOS_PLANO_CONTA',
        actualOverrodeManual: true,
      }),
    ]);
  });

  it('fills actual tax values from the mapped Aethos plan accounts', async () => {
    const service = new TaxForecastsService({
      taxForecast: { findMany: jest.fn().mockResolvedValue([]) },
      aethosPlanoContaCost: {
        groupBy: jest.fn().mockResolvedValue([
          {
            codigoEmpresa: '1',
            codigoPlanoConta: '153',
            competencia: '2026-07',
            _sum: { valorCusto: 89547.43 },
          },
          {
            codigoEmpresa: '1',
            codigoPlanoConta: '1132',
            competencia: '2026-07',
            _sum: { valorCusto: 107.5 },
          },
          {
            codigoEmpresa: '4',
            codigoPlanoConta: '1074',
            competencia: '2026-07',
            _sum: { valorCusto: 6297.88 },
          },
          {
            codigoEmpresa: '1',
            codigoPlanoConta: '145',
            competencia: '2026-07',
            _sum: { valorCusto: 35000 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          syncedAt: new Date('2026-07-28T18:00:00.000Z'),
        }),
      },
    } as any);

    const result = await service.findAll({ year: '2026' }, 'contabilidade');

    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          company: 'JR_CONSTRUCOES',
          taxType: 'PIS',
          month: 6,
          actualAmount: 89547.43,
          actualPlanCodes: ['153'],
          actualAethosCompetences: ['2026-07'],
          fiscalCompetenceOffsetMonths: 1,
        }),
        expect.objectContaining({
          company: 'JR_GESTAO',
          taxType: 'PIS',
          month: 6,
          actualAmount: 107.5,
          actualPlanCodes: ['1132'],
          actualAethosCompetences: ['2026-07'],
          fiscalCompetenceOffsetMonths: 1,
        }),
        expect.objectContaining({
          company: 'PEDRAFORTE',
          taxType: 'PIS',
          month: 6,
          actualAmount: 6297.88,
          actualPlanCodes: ['1074'],
          actualAethosCompetences: ['2026-07'],
          fiscalCompetenceOffsetMonths: 1,
        }),
        expect.objectContaining({
          company: 'JR_CONSTRUCOES',
          taxType: 'IRPJ',
          month: 7,
          actualAmount: 35000,
          actualPlanCodes: ['145'],
          actualAethosCompetences: ['2026-07'],
          fiscalCompetenceOffsetMonths: 0,
        }),
      ]),
    );
    expect(result.actualBasis).toBe('COMPETENCIA_FISCAL_DERIVADA_VALOR_CUSTO');
  });

  it('uses January from the following year as December fiscal competence', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        codigoEmpresa: '1',
        codigoPlanoConta: '153',
        competencia: '2026-01',
        _sum: { valorCusto: 111 },
      },
      {
        codigoEmpresa: '1',
        codigoPlanoConta: '153',
        competencia: '2027-01',
        _sum: { valorCusto: 222 },
      },
    ]);
    const service = new TaxForecastsService({
      taxForecast: { findMany: jest.fn().mockResolvedValue([]) },
      aethosPlanoContaCost: {
        groupBy,
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any);

    const result = await service.findAll(
      { year: '2026', company: 'JR_CONSTRUCOES', taxType: 'PIS' },
      'contabilidade',
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        company: 'JR_CONSTRUCOES',
        taxType: 'PIS',
        year: 2026,
        month: 12,
        actualAmount: 222,
        actualAethosCompetences: ['2027-01'],
      }),
    ]);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          competencia: {
            in: expect.arrayContaining(['2026-01', '2027-01']),
          },
        }),
      }),
    );
  });
});
