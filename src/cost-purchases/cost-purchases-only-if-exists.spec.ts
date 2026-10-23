import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CostPurchasesSyncService } from './cost-purchases-sync.service';

jest.mock('../aethos-integration/usina-sync-run-policy', () => ({
  expireStaleUsinaSyncRuns: jest.fn().mockResolvedValue(undefined),
}));

function cancelEnvelope() {
  return {
    dataset: 'cost-purchases-managerial-entry-items',
    syncMode: 'incremental',
    syncRunId: 'only-if-exists-test',
    generatedAt: '2026-10-23T01:00:00.000Z',
    scope: {
      company: 'JR_CONSTRUCOES',
      unit: 'AETHOS_ID_EMPRESA_1',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    },
    batchNumber: 1,
    isLastBatch: true,
    rows: [
      {
        sourceRecordId: 'NFENTRADA|115098|ITEM|2',
        sourceHeaderId: '115098',
        sourceItemId: '2',
        documentDate: '2026-09-02',
        documentNumber: '4894',
        companyId: 'JR_CONSTRUCOES',
        status: 'C',
        active: false,
        onlyIfExists: true,
        expectedContentHash: 'a'.repeat(64),
        expectedUpdatedAt: '2026-10-22T22:00:00.000Z',
        orderId: null,
        orderItemId: null,
        orderStatus: null,
        aethosItemId: 3024,
        unit: 'TN',
        quantity: '13.5',
        totalValue: '55215',
      },
    ],
  };
}

function existingFact() {
  return {
    id: 'fact-1',
    sourceRecordId: 'NFENTRADA|115098|ITEM|2',
    sourceHeaderId: '115098',
    sourceItemId: '2',
    documentDate: new Date('2026-09-02T00:00:00.000Z'),
    competence: new Date('2026-09-01T00:00:00.000Z'),
    documentNumber: '4894',
    aethosItemId: 3024,
    unit: 'TN',
    quantity: new Prisma.Decimal('13.5'),
    totalValue: new Prisma.Decimal('55215'),
    sourceStatus: 'F',
    active: true,
    sourceOrderId: null,
    sourceOrderItemId: null,
    sourceOrderStatus: null,
    contentHash: 'a'.repeat(64),
    updatedAt: new Date('2026-10-22T22:00:00.000Z'),
    deactivatedAt: null,
    raw: { status: 'F', legacyField: 'preserve' },
    lastSeenRunId: null,
  };
}

function setupExisting(current = existingFact(), updateCount = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
  const auditCreate = jest.fn().mockResolvedValue({});
  const tx = {
    usinaSyncRun: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    usinaSyncBatch: { create: jest.fn().mockResolvedValue({}) },
    costPurchaseManagerialEntryFact: {
      findUnique: jest.fn().mockResolvedValue(current),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...current,
        sourceStatus: 'C',
        active: false,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany,
      create: jest.fn(),
    },
    costPurchaseManagerialEntryFactAudit: { create: auditCreate },
  };
  const service = new CostPurchasesSyncService({
    $transaction: (work: (client: unknown) => unknown) => work(tx),
  } as any);
  return { service, updateMany, auditCreate, tx };
}

describe('cancelamento gerencial somente se ja existir', () => {
  it('rejeita a chave ausente antes de criar qualquer fato', async () => {
    const createFact = jest.fn();
    const findFact = jest.fn().mockResolvedValue(null);
    const transaction = jest.fn((work: (tx: unknown) => unknown) =>
      work({
        usinaSyncRun: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'run-new' }),
        },
        costPurchaseManagerialEntryFact: {
          findUnique: findFact,
          create: createFact,
        },
        costPurchaseManagerialEntryFactAudit: { create: jest.fn() },
      }),
    );
    const service = new CostPurchasesSyncService({
      $transaction: transaction,
    } as any);
    await expect(
      service.syncManagerialEntries(cancelEnvelope()),
    ).rejects.toThrow(ConflictException);
    expect(findFact).toHaveBeenCalledTimes(1);
    expect(createFact).not.toHaveBeenCalled();
  });

  it('inativa somente status com CAS e preserva campos financeiros', async () => {
    const { service, updateMany, auditCreate, tx } = setupExisting();

    const receipt = await service.syncManagerialEntries(cancelEnvelope());

    expect(receipt).toMatchObject({
      accepted: 1,
      upserted: 1,
      deactivated: 1,
      runStatus: 'COMPLETED',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fact-1',
          updatedAt: new Date('2026-10-22T22:00:00.000Z'),
          contentHash: 'a'.repeat(64),
        },
        data: expect.objectContaining({
          sourceStatus: 'C',
          active: false,
          deactivationReason: 'SOURCE_CANCELLED',
        }),
      }),
    );
    const data = updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('totalValue');
    expect(data).not.toHaveProperty('quantity');
    expect(data).not.toHaveProperty('documentDate');
    expect(data.raw).toMatchObject({ legacyField: 'preserve', status: 'C' });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operation: 'DEACTIVATE' }),
      }),
    );
    expect(tx.costPurchaseManagerialEntryFact.create).not.toHaveBeenCalled();
  });

  it('rejeita preimagem alterada sem tentar atualizar', async () => {
    const current = { ...existingFact(), contentHash: 'b'.repeat(64) };
    const { service, updateMany } = setupExisting(current);

    await expect(
      service.syncManagerialEntries(cancelEnvelope()),
    ).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejeita corrida detectada no update atomico', async () => {
    const { service, updateMany, auditCreate } = setupExisting(
      existingFact(),
      0,
    );

    await expect(
      service.syncManagerialEntries(cancelEnvelope()),
    ).rejects.toThrow(ConflictException);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('nao permite cancelamento protegido em carga full', async () => {
    const { service, updateMany } = setupExisting();

    await expect(
      service.syncManagerialEntries({ ...cancelEnvelope(), syncMode: 'full' }),
    ).rejects.toThrow('onlyIfExists exige syncMode incremental');
    expect(updateMany).not.toHaveBeenCalled();
  });
});
