import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DUDA_BD_GERAL_COLUMNS } from './duda-bd-geral.columns';
import { DudaBdGeralService } from './duda-bd-geral.service';

describe('DudaBdGeralService', () => {
  const batch = {
    id: 'batch-1',
    status: 'STAGED',
    sourceLabel: 'Principal',
    physicalRowCount: 1528,
  };
  const prisma = {
    aethosObra: { findMany: jest.fn() },
    constructionControlState: { findUnique: jest.fn() },
    dudaBdGeralImport: { findUnique: jest.fn(), findMany: jest.fn() },
    dudaBdGeralViewPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    dudaBdGeralManualEntry: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    dudaBdGeralManualEntryRevision: { create: jest.fn(), findMany: jest.fn() },
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
    prisma.aethosObra.findMany.mockResolvedValue([]);
    prisma.constructionControlState.findUnique.mockResolvedValue(null);
    prisma.dudaBdGeralImport.findUnique.mockResolvedValue(batch);
    prisma.dudaBdGeralRow.count.mockReturnValue(Promise.resolve(1));
    prisma.dudaBdGeralRow.findMany.mockReturnValue(
      Promise.resolve([{ excelRow: 8 }]),
    );
    prisma.$transaction.mockImplementation(
      (
        query:
          | ((client: typeof prisma) => Promise<unknown>)
          | Promise<unknown>[],
      ) => (typeof query === 'function' ? query(prisma) : Promise.all(query)),
    );
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'row-8',
          excelRow: 8,
          cells: {},
          version: 0,
          manualState: 'source',
        },
      ]);
  });

  it('suggests only active Aethos works and clearly separates JR control fields', async () => {
    prisma.aethosObra.findMany.mockResolvedValue([
      {
        code: '523',
        name: 'Obra oficial no Aethos',
        clientName: 'Cliente oficial',
        syncedAt: new Date('2026-10-21T00:00:00Z'),
      },
    ]);
    prisma.constructionControlState.findUnique.mockResolvedValue({
      data: {
        works: [{ codigoObra: '523', engenheiro: 'Maria', contrato: '58/2026' }],
      },
    });
    await expect(service.searchWorkSuggestions('523')).resolves.toMatchObject([
      {
        code: '523',
        suggestions: {
          C: 'Maria', D: '58/2026', E: 'Cliente oficial',
          G: 'Obra oficial no Aethos',
        },
        sources: {
          C: 'JR_CONTROLE_OBRAS', D: 'JR_CONTROLE_OBRAS',
          E: 'AETHOS_OBRAS', G: 'AETHOS_OBRAS',
        },
      },
    ]);
    expect(prisma.aethosObra.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
    );
  });

  it('does not infer engineer or contract from duplicated control work codes', async () => {
    prisma.aethosObra.findMany.mockResolvedValue([
      { code: '523', name: 'Obra 523', clientName: 'Cliente', syncedAt: new Date() },
    ]);
    prisma.constructionControlState.findUnique.mockResolvedValue({
      data: { works: [
        { codigoObra: '523', engenheiro: 'A', contrato: '1' },
        { codigoObra: '523', engenheiro: 'B', contrato: '2' },
      ] },
    });
    await expect(service.searchWorkSuggestions('523')).resolves.toMatchObject([
      { suggestions: { C: null, D: null, E: 'Cliente', G: 'Obra 523' } },
    ]);
  });

  it.each(['', ' ', 'a', 'x'.repeat(81)])(
    'rejects invalid work lookups (%s)',
    async (query) => {
      await expect(service.searchWorkSuggestions(query)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.aethosObra.findMany).not.toHaveBeenCalled();
    },
  );

  it('paginates the physical worksheet including hidden rows', async () => {
    const result = await service.listRows('batch-1', {
      page: '2',
      pageSize: '20',
      serviceMonth: '2026-10',
      q: 'obra',
    });
    expect(result).toMatchObject({ page: 2, pageSize: 20, total: 1 });
    expect(result.rows).toMatchObject([{ id: 'row-8', excelRow: 8 }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
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
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
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
    prisma.dudaBdGeralManualEntry.findFirst.mockResolvedValue(null);
    await expect(service.getRow('batch-1', 'row-2')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dudaBdGeralRow.findFirst).toHaveBeenCalledWith({
      where: { id: 'row-2', importId: 'batch-1' },
      include: { manualEntry: true },
    });
  });

  const manualValues = () =>
    Object.fromEntries(
      DUDA_BD_GERAL_COLUMNS.map((key) => [
        key,
        key === 'A' ? 'ITEM 1' : key === 'B' ? '2026-10' : '',
      ]),
    );

  it('creates a provisional manual record with an audit revision', async () => {
    const values = manualValues();
    prisma.dudaBdGeralManualEntry.create.mockResolvedValue({
      id: 'manual-1',
      cells: { A: { raw: 'ITEM 1' } },
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await service.createManualEntry(
      'batch-1',
      'admin-1',
      values,
    );
    expect(result).toMatchObject({
      id: 'manual-1',
      manualState: 'new',
      version: 1,
    });
    const calls: unknown =
      prisma.dudaBdGeralManualEntryRevision.create.mock.calls;
    const auditCall = (
      calls as Array<
        Array<{
          data: {
            entryId: string;
            action: string;
            changedByUserId: string;
            afterCells: unknown;
          };
        }>
      >
    )[0][0];
    expect(auditCall.data).toMatchObject({
      entryId: 'manual-1',
      action: 'CREATE_MANUAL',
      changedByUserId: 'admin-1',
      afterCells: values,
    });
  });

  it('rejects formulas and a missing identity in new manual records', async () => {
    const values = manualValues();
    values.A = '=NOW()';
    await expect(
      service.createManualEntry('batch-1', 'admin-1', values),
    ).rejects.toThrow(BadRequestException);
    values.A = '';
    await expect(
      service.createManualEntry('batch-1', 'admin-1', values),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dudaBdGeralManualEntry.create).not.toHaveBeenCalled();
  });

  it('rejects stale source edits before writing an overlay', async () => {
    prisma.dudaBdGeralRow.findFirst.mockResolvedValue({
      id: 'row-8',
      classification: 'detail_candidate',
      cells: { A: { raw: 'ITEM 1' }, B: { raw: '2026-10' } },
    });
    prisma.dudaBdGeralManualEntry.findUnique.mockResolvedValue({
      id: 'overlay-1',
      version: 2,
      cells: {},
    });
    await expect(
      service.updateRow('batch-1', 'row-8', 'admin-1', manualValues(), 1),
    ).rejects.toThrow(ConflictException);
    expect(prisma.dudaBdGeralManualEntry.updateMany).not.toHaveBeenCalled();
  });
});
