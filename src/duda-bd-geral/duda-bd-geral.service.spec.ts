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
    dudaBdGeralRow: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
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
