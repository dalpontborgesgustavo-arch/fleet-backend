import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DudaBdGeralService } from './duda-bd-geral.service';

describe('DudaBdGeralService', () => {
  const batch = {
    id: 'batch-1',
    status: 'STAGED',
    sourceLabel: 'Principal',
    physicalRowCount: 1528,
  };
  const prisma = {
    dudaBdGeralImport: { findUnique: jest.fn(), findMany: jest.fn() },
    dudaBdGeralViewPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    dudaBdGeralRow: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const service = new DudaBdGeralService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.dudaBdGeralImport.findUnique.mockResolvedValue(batch);
    prisma.dudaBdGeralRow.count.mockReturnValue(Promise.resolve(1));
    prisma.dudaBdGeralRow.findMany.mockReturnValue(
      Promise.resolve([{ excelRow: 8 }]),
    );
    prisma.$transaction.mockImplementation(async (queries) =>
      Promise.all(queries),
    );
  });

  it('paginates the physical worksheet including hidden rows', async () => {
    const result = await service.listRows('batch-1', {
      page: '2',
      pageSize: '20',
      serviceMonth: '2026-10',
      q: 'obra',
    });
    expect(result).toMatchObject({ page: 2, pageSize: 20, total: 1 });
    const calls: unknown = prisma.dudaBdGeralRow.findMany.mock.calls;
    const query = (calls as unknown[][])[0]?.[0];
    expect(query).toMatchObject({
      skip: 20,
      take: 20,
      where: { importId: 'batch-1' },
    });
    expect((query as { where: object }).where).not.toHaveProperty(
      'hiddenByFilter',
    );
  });

  it.each([{ page: '0' }, { pageSize: '101' }, { serviceMonth: '2026-13' }])(
    'rejects invalid filters',
    async (filters) => {
      await expect(service.listRows('batch-1', filters)).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it.each([
    '{',
    '[]',
    '{"H":"123"}',
    '{"A":123}',
    '{"A":"' + 'x'.repeat(121) + '"}',
  ])('rejects unsafe column filters (%s)', async (columnFilters) => {
    await expect(
      service.listRows('batch-1', { columnFilters }),
    ).rejects.toThrow(BadRequestException);
  });

  it('filters a source column before paginating and returns its cells', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ id: 'row-8' }]);
    prisma.dudaBdGeralRow.findMany.mockResolvedValueOnce([
      { id: 'row-8', excelRow: 8, cells: { U: { raw: 100 } } },
    ]);
    const result = await service.listRows('batch-1', {
      page: '1',
      columnFilters: '{"U":"100"}',
    });
    expect(result).toMatchObject({
      total: 1,
      rows: [{ id: 'row-8', cells: { U: { raw: 100 } } }],
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('stores visible-column choices per authenticated user', async () => {
    prisma.dudaBdGeralViewPreference.upsert.mockResolvedValue({
      hiddenColumns: ['AA', 'AC'],
    });
    await expect(
      service.putViewPreferences('user-1', ['AA', 'AC']),
    ).resolves.toEqual({ hiddenColumns: ['AA', 'AC'] });
    expect(prisma.dudaBdGeralViewPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    await expect(service.putViewPreferences('user-1', ['H'])).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.putViewPreferences('user-1', ['A', 'A']),
    ).rejects.toThrow(BadRequestException);
    prisma.dudaBdGeralViewPreference.findUnique.mockResolvedValue(null);
    await expect(service.getViewPreferences('user-1')).resolves.toEqual({
      hiddenColumns: [],
    });
  });

  it('does not return a row from another import', async () => {
    prisma.dudaBdGeralRow.findFirst.mockResolvedValue(null);
    await expect(service.getRow('batch-1', 'row-2')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dudaBdGeralRow.findFirst).toHaveBeenCalledWith({
      where: { id: 'row-2', importId: 'batch-1' },
    });
  });
});
