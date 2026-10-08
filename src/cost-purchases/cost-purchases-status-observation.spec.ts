import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashCanonicalValue } from '../aethos-integration/usina-production-sync.rules';
import { normalizeCostPurchaseRows } from './cost-purchases-sync.rules';
import { CostPurchasesSyncService } from './cost-purchases-sync.service';
import { parseAsphaltStatusObservations } from './cost-purchases-status-observation.rules';

const dataset = 'cost-purchases-managerial-entry-items';
const day = new Date('2026-08-03T00:00:00.000Z');
const updatedAt = new Date('2026-10-08T21:00:00.000Z');

function fixture() {
  const raw = {
    sourceRecordId: 'NFENTRADA|330|ITEM|1',
    sourceHeaderId: '330',
    sourceItemId: '1',
    documentDate: '2026-08-03',
    companyId: 'JR_CONSTRUCOES',
    documentNumber: '1800',
    aethosItemId: 1813,
    unit: 'TN',
    quantity: '2.5',
    totalValue: '162372.65',
    status: 'F',
    active: true,
    orderId: null,
    orderItemId: null,
    orderStatus: null,
    unrelated: 'preservar',
  };
  const normalized = normalizeCostPurchaseRows(dataset, [raw], {
    company: 'JR_CONSTRUCOES',
    unit: 'AETHOS_ID_EMPRESA_1',
    dateFrom: day,
    dateTo: day,
    aethosVehicleIds: [],
  });
  if (!normalized.accepted.length) throw new Error('fixture invalida');
  const fact = {
    id: 'fact-1',
    companyId: 'JR_CONSTRUCOES',
    unitId: 'AETHOS_ID_EMPRESA_1',
    dataset,
    source: 'AETHOS',
    sourceRecordId: raw.sourceRecordId,
    sourceHeaderId: raw.sourceHeaderId,
    sourceItemId: raw.sourceItemId,
    documentDate: day,
    competence: new Date('2026-08-01T00:00:00.000Z'),
    documentNumber: raw.documentNumber,
    aethosItemId: raw.aethosItemId,
    unit: raw.unit,
    quantity: new Prisma.Decimal(raw.quantity),
    totalValue: new Prisma.Decimal(raw.totalValue),
    sourceStatus: 'F',
    sourceOrderId: null,
    sourceOrderItemId: null,
    sourceOrderStatus: null,
    active: true,
    deactivatedAt: null,
    deactivationReason: null,
    raw,
    contentHash: normalized.accepted[0].contentHash,
    updatedAt,
    syncedAt: updatedAt,
    lastSeenRunId: 'old-run',
    lastSeenRun: { generatedAt: updatedAt },
  };
  const mapping = {
    id: 'map-1',
    aethosItemId: 1813,
    category: 'CAP',
    validFrom: day,
    validTo: null,
    active: true,
    deletedAt: null,
    updatedAt,
  };
  const tx = {
    costPurchaseManagerialEntryFact: {
      findMany: jest.fn().mockResolvedValue([fact]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...fact, sourceStatus: 'C', active: false }),
    },
    costPurchaseManagerialEntryFactAudit: { create: jest.fn() },
    costPurchaseManagerialItemMapping: {
      findMany: jest.fn().mockResolvedValue([mapping]),
    },
    costPurchaseManagerialItemMappingAudit: {
      count: jest.fn().mockResolvedValue(0),
    },
    usinaSyncRun: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'status-run' }),
      update: jest.fn(),
    },
    usinaSyncBatch: { findUnique: jest.fn(), create: jest.fn() },
  };
  const transaction = jest.fn(
    (work: (client: typeof tx) => unknown, options: any) => {
      expect([
        Prisma.TransactionIsolationLevel.RepeatableRead,
        Prisma.TransactionIsolationLevel.Serializable,
      ]).toContain(options.isolationLevel);
      return Promise.resolve(work(tx));
    },
  );
  const service = new CostPurchasesSyncService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { fact, tx, transaction, service };
}

async function observation(fixtureValue: ReturnType<typeof fixture>) {
  const feed = await fixtureValue.service.managerialEntryReconciliation();
  const item = feed.inventory.pages[0].rows[0];
  const snapshotAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: 'status-20261008-001',
    snapshotId: feed.snapshotId,
    mappingRevision: feed.mappingRevision,
    snapshotAt,
    generatedAt: new Date(Date.now() + 1000).toISOString(),
    rows: [
      {
        sourceRecordId: item.sourceRecordId,
        sourceHeaderId: item.sourceHeaderId,
        sourceItemId: item.sourceItemId,
        aethosItemId: Number(item.aethosItemId),
        mappingId: item.mappingId,
        expectedContentHash: item.contentHash,
        expectedUpdatedAt: item.updatedAt,
        expectedRowVersion: item.rowVersion,
        sourceStatus: 'C',
        active: false,
        orderId: '10',
        orderItemId: '1',
        orderStatus: 'I',
      },
    ],
  };
}

describe('observacao parcial asfalticos com CAS', () => {
  it('altera apenas status e OC, preservando os campos financeiros e o raw original', async () => {
    const value = fixture();
    const input = await observation(value);
    const result = await value.service.observeManagerialAsphaltStatuses(input);
    expect(result).toMatchObject({
      received: 1,
      changed: 1,
      deactivated: 1,
      status: 'COMPLETED',
    });
    const update =
      value.tx.costPurchaseManagerialEntryFact.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({
      id: 'fact-1',
      contentHash: value.fact.contentHash,
      updatedAt,
    });
    expect(update.data).toMatchObject({
      sourceStatus: 'C',
      active: false,
      sourceOrderStatus: 'I',
      raw: {
        unit: 'TN',
        quantity: '2.5',
        totalValue: '162372.65',
        unrelated: 'preservar',
      },
    });
    expect(update.data).not.toHaveProperty('totalValue');
    expect(update.data).not.toHaveProperty('quantity');
    expect(update.data).not.toHaveProperty('unit');
    expect(
      value.tx.costPurchaseManagerialEntryFactAudit.create,
    ).toHaveBeenCalledTimes(1);
    expect(value.tx.usinaSyncBatch.create).toHaveBeenCalledTimes(1);
    expect(value.tx.usinaSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ syncMode: 'incremental' }),
      }),
    );
  });

  it('rejeita CAS divergente antes de criar run ou alterar fatos', async () => {
    const value = fixture();
    const input = await observation(value);
    input.rows[0].expectedContentHash = 'a'.repeat(64);
    input.rows[0].expectedRowVersion = `${input.rows[0].expectedUpdatedAt}/${'a'.repeat(64)}`;
    await expect(
      value.service.observeManagerialAsphaltStatuses(input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(value.tx.usinaSyncRun.create).not.toHaveBeenCalled();
    expect(
      value.tx.costPurchaseManagerialEntryFact.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('rejeita corrida de escrita no CAS dentro da transacao', async () => {
    const value = fixture();
    const input = await observation(value);
    value.tx.costPurchaseManagerialEntryFact.updateMany.mockResolvedValue({
      count: 0,
    });
    await expect(
      value.service.observeManagerialAsphaltStatuses(input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(value.tx.usinaSyncBatch.create).not.toHaveBeenCalled();
  });

  it('devolve recibo em replay identico sem reescrever fatos', async () => {
    const value = fixture();
    const input = await observation(value);
    value.tx.usinaSyncRun.findUnique.mockResolvedValue({
      id: 'status-run',
      status: 'COMPLETED',
    });
    value.tx.usinaSyncBatch.findUnique.mockResolvedValue({
      payloadHash: hashCanonicalValue(input),
      response: { ok: true, runId: input.runId, status: 'COMPLETED' },
    });
    const result = await value.service.observeManagerialAsphaltStatuses(input);
    expect(result).toMatchObject({ ok: true, replayed: true });
    expect(
      value.tx.costPurchaseManagerialEntryFact.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('permite consultar recibo por runId sem repetir POST', async () => {
    const service = new CostPurchasesSyncService({
      usinaSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'status-run',
          status: 'COMPLETED',
          generatedAt: updatedAt,
        }),
      },
      usinaSyncBatch: {
        findUnique: jest.fn().mockResolvedValue({
          payloadHash: 'a'.repeat(64),
          response: { ok: true, received: 1 },
        }),
      },
    } as unknown as PrismaService);
    await expect(
      service.managerialAsphaltStatusObservationRun('status-20261008-001'),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      payloadHash: 'a'.repeat(64),
      receipt: { ok: true, received: 1 },
    });
  });

  it('rejeita observacao anterior e mesmo instante com conteudo diferente', async () => {
    const value = fixture();
    const input = await observation(value);
    value.fact.lastSeenRun.generatedAt = new Date(
      new Date(input.generatedAt).getTime() + 1000,
    );
    await expect(
      value.service.observeManagerialAsphaltStatuses(input),
    ).rejects.toBeInstanceOf(ConflictException);
    value.fact.lastSeenRun.generatedAt = new Date(input.generatedAt);
    await expect(
      value.service.observeManagerialAsphaltStatuses(input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(value.tx.usinaSyncRun.create).not.toHaveBeenCalled();
  });

  it('rejeita contrato OC incompleto e NF cancelada ativa', async () => {
    const value = fixture();
    const input = await observation(value);
    const missingOc = {
      ...input,
      rows: [{ ...input.rows[0], orderItemId: null }],
    };
    expect(() => parseAsphaltStatusObservations(missingOc)).toThrow();
    const activeCancelled = {
      ...input,
      rows: [{ ...input.rows[0], active: true }],
    };
    expect(() => parseAsphaltStatusObservations(activeCancelled)).toThrow();
  });
});

