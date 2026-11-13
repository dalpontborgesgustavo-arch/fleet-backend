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

  it('uses the JR manual actual even when Aethos has a different amount', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        codigoEmpresa: '1',
        codigoPlanoConta: '145',
        competencia: '2026-09',
        _sum: { valorCusto: 930.25 },
      },
    ]);
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
        groupBy,
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
        actualAmount: 725.5,
        actualAmountAethos: 0,
        actualAmountManual: 725.5,
        actualSource: 'MANUAL',
        actualOverrodeManual: false,
      }),
    ]);
    expect(groupBy).not.toHaveBeenCalled();
    expect(result.summary.actualAmount).toBe(725.5);
  });

  it('does not add Aethos-only rows to the manual tax forecast', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        {
          codigoEmpresa: '1',
          codigoPlanoConta: '153',
          competencia: '2026-07',
          _sum: { valorCusto: 89547.43 },
        },
      ]);
    const service = new TaxForecastsService({
      taxForecast: { findMany: jest.fn().mockResolvedValue([]) },
      aethosPlanoContaCost: { groupBy },
    } as any);

    const result = await service.findAll({ year: '2026' }, 'contabilidade');

    expect(result.entries).toEqual([]);
    expect(result.actualBasis).toBe('MANUAL_USUARIO');
    expect(result.actualMappings).toEqual([]);
    expect(result.summary.actualAmount).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('keeps Pedraforte October manual zero when Aethos has a cost', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        {
          codigoEmpresa: '4',
          codigoPlanoConta: '1077',
          competencia: '2026-10',
          _sum: { valorCusto: 42739.85 },
        },
      ]);
    const service = new TaxForecastsService({
      taxForecast: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pedra-csll-oct',
            company: 'PEDRAFORTE',
            taxType: 'CSLL',
            year: 2026,
            month: 10,
            forecastAmount: new Prisma.Decimal('50000.00'),
            actualAmount: new Prisma.Decimal('0.00'),
            updatedById: null,
            updatedBy: null,
            createdAt: new Date('2026-10-01T12:00:00.000Z'),
            updatedAt: new Date('2026-10-01T12:00:00.000Z'),
          },
        ]),
      },
      aethosPlanoContaCost: { groupBy },
    } as any);

    const result = await service.findAll(
      { year: '2026', company: 'PEDRAFORTE', taxType: 'CSLL' },
      'contabilidade',
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        company: 'PEDRAFORTE',
        taxType: 'CSLL',
        month: 10,
        forecastAmount: 50000,
        actualAmount: 0,
        actualAmountManual: 0,
        actualAmountAethos: 0,
        actualSource: 'MANUAL',
      }),
    ]);
    expect(result.summary.actualAmount).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('returns January and October manual amounts for JR and Pedraforte without Aethos substitution', async () => {
    const date = new Date('2026-11-01T12:00:00.000Z');
    const record = (
      id: string,
      company: string,
      month: number,
      actualAmount: string,
    ) => ({
      id,
      company,
      taxType: 'PIS',
      year: 2026,
      month,
      forecastAmount: new Prisma.Decimal('500.00'),
      actualAmount: new Prisma.Decimal(actualAmount),
      updatedById: 'accounting-user-1',
      updatedBy: { id: 'accounting-user-1', name: 'Contabilidade' },
      createdAt: date,
      updatedAt: date,
    });
    const groupBy = jest.fn(() => {
      throw new Error('Aethos must not be queried');
    });
    const service = new TaxForecastsService({
      taxForecast: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            record('jr-jan', 'JR_CONSTRUCOES', 1, '100.00'),
            record('pedra-jan', 'PEDRAFORTE', 1, '300.00'),
            record('jr-oct', 'JR_CONSTRUCOES', 10, '200.00'),
            record('pedra-oct', 'PEDRAFORTE', 10, '400.00'),
          ]),
      },
      aethosPlanoContaCost: { groupBy },
    } as any);

    const result = await service.findAll({ year: '2026' }, 'contabilidade');

    expect(
      result.entries.map(({ company, month, actualAmount, actualSource }) => ({
        company,
        month,
        actualAmount,
        actualSource,
      })),
    ).toEqual([
      {
        company: 'JR_CONSTRUCOES',
        month: 1,
        actualAmount: 100,
        actualSource: 'MANUAL',
      },
      {
        company: 'PEDRAFORTE',
        month: 1,
        actualAmount: 300,
        actualSource: 'MANUAL',
      },
      {
        company: 'JR_CONSTRUCOES',
        month: 10,
        actualAmount: 200,
        actualSource: 'MANUAL',
      },
      {
        company: 'PEDRAFORTE',
        month: 10,
        actualAmount: 400,
        actualSource: 'MANUAL',
      },
    ]);
    expect(result.summary.actualAmount).toBe(1000);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
