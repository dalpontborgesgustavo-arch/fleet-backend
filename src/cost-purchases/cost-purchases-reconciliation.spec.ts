import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CostPurchasesSyncService } from './cost-purchases-sync.service';

describe('inventário gerencial para reconciliação Aethos', () => {
  it('exporta fatos ativos e inativos e todos os mapas em um snapshot com hash', async () => {
    const day = new Date('2026-08-01T00:00:00.000Z');
    const changedAt = new Date('2026-10-08T21:00:00.000Z');
    const rows = [
      {
        companyId: 'JR_CONSTRUCOES',
        unitId: 'AETHOS_ID_EMPRESA_1',
        source: 'AETHOS',
        sourceRecordId: 'NFENTRADA|2|ITEM|1',
        sourceHeaderId: '2',
        sourceItemId: '1',
        documentDate: day,
        competence: day,
        documentNumber: '20',
        aethosItemId: 1813,
        sourceStatus: 'C',
        sourceOrderId: '10',
        sourceOrderItemId: '1',
        sourceOrderStatus: 'I',
        active: false,
        deactivatedAt: changedAt,
        deactivationReason: 'SOURCE_CANCELLED',
        lastSeenRunId: 'run-1',
        lastSeenRun: { generatedAt: changedAt },
        unit: 'TN',
        quantity: new Prisma.Decimal('2.500'),
        totalValue: new Prisma.Decimal('100.00'),
        contentHash: 'hash-2',
        syncedAt: changedAt,
        updatedAt: changedAt,
      },
      {
        companyId: 'JR_CONSTRUCOES',
        unitId: 'AETHOS_ID_EMPRESA_1',
        source: 'AETHOS',
        sourceRecordId: 'NFENTRADA|3|ITEM|1',
        sourceHeaderId: '3',
        sourceItemId: '1',
        documentDate: day,
        competence: day,
        documentNumber: '30',
        aethosItemId: 1813,
        sourceStatus: 'F',
        sourceOrderId: '11',
        sourceOrderItemId: '1',
        sourceOrderStatus: 'I',
        active: true,
        deactivatedAt: null,
        deactivationReason: null,
        lastSeenRunId: 'run-1',
        lastSeenRun: { generatedAt: changedAt },
        unit: 'TN',
        quantity: new Prisma.Decimal('3'),
        totalValue: new Prisma.Decimal('150.00'),
        contentHash: 'hash-3',
        syncedAt: changedAt,
        updatedAt: changedAt,
      },
    ];
    const mapping = {
      id: 'map-1',
      aethosItemId: 1813,
      category: 'CAP',
      validFrom: day,
      validTo: null,
      active: true,
      deletedAt: null,
      updatedAt: changedAt,
    };
    const findFacts = jest.fn().mockResolvedValue(rows);
    const findMappings = jest.fn().mockResolvedValue([mapping]);
    const countChangedMappings = jest.fn().mockResolvedValue(0);
    const transaction = jest.fn(
      (
        work: (tx: unknown) => unknown,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) => {
        expect(options.isolationLevel).toBe(
          Prisma.TransactionIsolationLevel.RepeatableRead,
        );
        return Promise.resolve(
          work({
            costPurchaseManagerialEntryFact: { findMany: findFacts },
            costPurchaseManagerialItemMapping: { findMany: findMappings },
            costPurchaseManagerialItemMappingAudit: {
              count: countChangedMappings,
            },
          }),
        );
      },
    );
    const service = new CostPurchasesSyncService({
      $transaction: transaction,
    } as unknown as PrismaService);

    const result = await service.managerialEntryReconciliation();

    expect(findFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dataset: 'cost-purchases-managerial-entry-items',
          companyId: 'JR_CONSTRUCOES',
          unitId: 'AETHOS_ID_EMPRESA_1',
        },
      }),
    );
    expect(result).toMatchObject({
      mappingCount: 1,
      mappings: [
        { mappingId: 'map-1', category: 'CAP', validFrom: '2026-08-01' },
      ],
      inventory: {
        totalRows: 2,
        totalPages: 1,
        pages: [
          {
            rowCount: 2,
            rows: [
              {
                sourceStatus: 'C',
                active: false,
                unitOfMeasure: 'TN',
                quantity: '2.5',
                totalValue: '100',
              },
              { sourceStatus: 'F', orderStatus: 'I', active: true },
            ],
          },
        ],
      },
    });
    expect(result.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.mappingRevision).toMatch(/^[0-9a-f]{64}$/);
  });
});

