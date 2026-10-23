import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CostPurchasesSyncService } from './cost-purchases-sync.service';

function fact(sourceRecordId: string, aethosItemId = 3024) {
  return {
    sourceRecordId,
    sourceHeaderId: sourceRecordId.split('|')[1],
    sourceItemId: '2',
    documentDate: new Date('2026-09-02T00:00:00.000Z'),
    documentNumber: '4894',
    sourceStatus: 'F',
    sourceOrderId: null,
    sourceOrderItemId: null,
    sourceOrderStatus: null,
    aethosItemId,
    unit: 'TN',
    quantity: new Prisma.Decimal('13.5'),
    totalValue: new Prisma.Decimal('55215'),
    updatedAt: new Date('2026-10-22T22:00:00.000Z'),
    contentHash: 'a'.repeat(64),
  };
}

function inventory(rows: ReturnType<typeof fact>[]) {
  return rows.map(({ sourceRecordId, updatedAt, contentHash }) => ({
    sourceRecordId,
    updatedAt,
    contentHash,
  }));
}

function setup(responses: unknown[][]) {
  const findMany = jest.fn();
  for (const response of responses) findMany.mockResolvedValueOnce(response);
  const transaction = jest.fn(
    (
      work: (tx: unknown) => unknown,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ) => {
      expect(options.isolationLevel).toBe(
        Prisma.TransactionIsolationLevel.RepeatableRead,
      );
      return work({ costPurchaseManagerialEntryFact: { findMany } });
    },
  );
  const service = new CostPurchasesSyncService({
    $transaction: transaction,
  } as any);
  return { service, findMany, transaction };
}

describe('inventario de notas de oleo conhecidas pelo JR', () => {
  const rows = [
    fact('NFENTRADA|115098|ITEM|2'),
    fact('NFENTRADA|115856|ITEM|2'),
    fact('NFENTRADA|115900|ITEM|2'),
  ];

  it('retorna pagina, versao e cursor opaco do mesmo snapshot', async () => {
    const { service, findMany } = setup([inventory(rows), rows]);
    const result = await service.knownManagerialOilEntries(undefined, '2');

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'JR_CONSTRUCOES',
          unitId: 'AETHOS_ID_EMPRESA_1',
          aethosItemId: 3024,
          active: true,
        }),
        take: 3,
      }),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      sourceCompanyId: '1',
      sourceRecordId: 'NFENTRADA|115098|ITEM|2',
      documentDate: '2026-09-02',
      quantity: '13.5',
      totalValue: '55215',
      status: 'F',
      active: true,
      contentHash: 'a'.repeat(64),
      rowVersion: `2026-10-22T22:00:00.000Z/${'a'.repeat(64)}`,
    });
    expect(result.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contentHashAlgorithm).toBe('sha256-canonical-normalized-v1');
    expect(result.totalRows).toBe(3);
    expect(result.hasMore).toBe(true);
    const cursor = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(cursor).toMatchObject({
      after: 'NFENTRADA|115856|ITEM|2',
      snapshotId: result.snapshotId,
      generatedAt: result.generatedAt,
      limit: 2,
    });
  });

  it('encerra na ultima pagina sem mudar o snapshot', async () => {
    const { service, findMany } = setup([
      inventory(rows),
      rows,
      inventory(rows),
      [rows[2]],
    ]);
    const first = await service.knownManagerialOilEntries(undefined, '2');
    const last = await service.knownManagerialOilEntries(
      first.nextCursor!,
      '2',
    );

    expect(findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          sourceRecordId: { gt: 'NFENTRADA|115856|ITEM|2' },
        }),
        take: 3,
      }),
    );
    expect(last.rows).toHaveLength(1);
    expect(last.snapshotId).toBe(first.snapshotId);
    expect(last.generatedAt).toBe(first.generatedAt);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });

  it('bloqueia paginacao se o inventario mudar', async () => {
    const changed = { ...rows[0], contentHash: 'b'.repeat(64) };
    const { service, findMany } = setup([
      inventory(rows),
      rows,
      inventory([changed, rows[1], rows[2]]),
    ]);
    const first = await service.knownManagerialOilEntries(undefined, '2');

    await expect(
      service.knownManagerialOilEntries(first.nextCursor!, '2'),
    ).rejects.toThrow(ConflictException);
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['cursor invalido', '../115098', undefined],
    ['limite zero', undefined, '0'],
    ['limite excessivo', undefined, '501'],
    ['limite nao numerico', undefined, '2e2'],
  ])('rejeita %s sem consultar o banco', async (_label, cursor, pageSize) => {
    const { service, transaction } = setup([]);
    await expect(
      service.knownManagerialOilEntries(cursor, pageSize),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('inventario de todos os itens gerenciais conhecidos pelo JR', () => {
  const rows = [
    fact('NFENTRADA|115098|ITEM|2', 3024),
    fact('NFENTRADA|115856|ITEM|2', 1813),
    fact('NFENTRADA|115900|ITEM|2', 4816),
  ];

  it('pagina categorias diferentes sem limitar ao oleo', async () => {
    const { service, findMany } = setup([
      inventory(rows),
      rows,
      inventory(rows),
      [rows[2]],
    ]);
    const first = await service.knownManagerialEntries(undefined, '2');
    const last = await service.knownManagerialEntries(first.nextCursor!, '2');

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.not.objectContaining({ aethosItemId: 3024 }),
      }),
    );
    expect(first.scope).toEqual({
      sourceCompanyIds: ['1'],
      aethosItemIds: null,
    });
    expect(first.category).toBe('ALL');
    expect(first.rows.map((row) => row.aethosItemId)).toEqual([3024, 1813]);
    expect(last.rows.map((row) => row.aethosItemId)).toEqual([4816]);
    expect(last.snapshotId).toBe(first.snapshotId);
    expect(first.totalRows).toBe(3);
    expect(last.hasMore).toBe(false);
  });

  it('nao aceita cursor do escopo de oleo no escopo geral', async () => {
    const { service } = setup([inventory(rows), rows, inventory(rows)]);
    const oil = await service.knownManagerialOilEntries(undefined, '2');

    await expect(
      service.knownManagerialEntries(oil.nextCursor!, '2'),
    ).rejects.toThrow(ConflictException);
  });
});
