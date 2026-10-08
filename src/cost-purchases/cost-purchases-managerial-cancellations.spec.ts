import { COST_PURCHASE_MANAGERIAL_ENTRY_DATASET } from './cost-purchases.rules';
import {
  normalizeCostPurchaseEnvelope,
  normalizeCostPurchaseRows,
} from './cost-purchases-sync.rules';
import { managerialEntryIsEligible } from './cost-purchases-managerial.rules';

const baseEnvelope = {
  dataset: COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
  syncMode: 'incremental',
  syncRunId: 'managerial-cancellations-test',
  generatedAt: '2026-10-08T18:00:00.000Z',
  scope: {
    company: 'JR_CONSTRUCOES',
    unit: 'AETHOS_ID_EMPRESA_1',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
  },
  batchNumber: 1,
  isLastBatch: true,
  rows: [],
};

const baseRow = {
  sourceRecordId: 'NFENTRADA|114627|ITEM|1',
  sourceHeaderId: '114627',
  sourceItemId: '1',
  documentDate: '2026-08-17',
  documentNumber: '801',
  companyId: 'JR_CONSTRUCOES',
  status: 'F',
  aethosItemId: 1813,
  quantity: '10',
  totalValue: '165615.45',
  active: true,
};

function normalize(row: Record<string, unknown>) {
  const envelope = normalizeCostPurchaseEnvelope(
    baseEnvelope,
    COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
  );
  return normalizeCostPurchaseRows(
    COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
    [row],
    envelope.scope,
  );
}

describe('cancelamentos do gerencial de compras', () => {
  it('aceita a mesma chave como cancelada sem alterar seu valor', () => {
    const faturada = normalize(baseRow);
    const cancelada = normalize({ ...baseRow, status: 'C', active: false });
    expect(faturada.rejected).toEqual([]);
    expect(cancelada.rejected).toEqual([]);
    expect(cancelada.accepted[0]).toMatchObject({
      sourceRecordId: baseRow.sourceRecordId,
      sourceStatus: 'C',
      active: false,
    });
    expect(cancelada.accepted[0].totalValue).toEqual(
      faturada.accepted[0].totalValue,
    );
    expect(cancelada.accepted[0].contentHash).not.toBe(
      faturada.accepted[0].contentHash,
    );
  });

  it.each([
    [{ ...baseRow, status: 'C', active: true }, 'active diverge'],
    [{ ...baseRow, status: 'F', active: false }, 'active diverge'],
    [{ ...baseRow, status: 'C', active: undefined }, 'active=false'],
    [{ ...baseRow, status: 'C', active: 'invalid' }, 'booleano'],
    [{ ...baseRow, status: 'X', active: false }, 'status deve ser F ou C'],
  ])('rejeita status e atividade incoerentes %#', (row, message) => {
    expect(normalize(row).rejected[0].reason).toContain(message);
  });

  it('interpreta false textual como falso, sem coerção truthy', () => {
    const result = normalize({ ...baseRow, status: 'C', active: 'false' });
    expect(result.rejected).toEqual([]);
    expect(result.accepted[0].active).toBe(false);
  });

  it('preserva o vínculo oficial e o status da ordem na nota ativa', () => {
    const result = normalize({
      ...baseRow,
      orderId: 72938,
      orderItemId: 101,
      orderStatus: 'i',
    });
    expect(result.rejected).toEqual([]);
    expect(result.accepted[0]).toMatchObject({
      active: true,
      sourceOrderId: '72938',
      sourceOrderItemId: '101',
      sourceOrderStatus: 'I',
    });
    expect(result.accepted[0].contentHash).not.toBe(
      normalize(baseRow).accepted[0].contentHash,
    );
  });

  it('não aceita status da ordem sem ambos os IDs oficiais', () => {
    const result = normalize({
      ...baseRow,
      orderId: '72938',
      orderStatus: 'I',
    });
    expect(result.rejected[0].reason).toContain('ID_ORDEMCOMPRAITEM');
  });

  it.each(['CAP', 'RR', 'SEMI_IMPRIMA'] as const)(
    'exclui ordens finalizadas e canceladas somente da categoria asfaltica %s',
    (category) => {
      expect(
        managerialEntryIsEligible({ category, sourceOrderStatus: 'I' }),
      ).toBe(false);
      expect(
        managerialEntryIsEligible({ category, sourceOrderStatus: 'C' }),
      ).toBe(false);
      expect(
        managerialEntryIsEligible({ category, sourceOrderStatus: 'F' }),
      ).toBe(true);
      expect(
        managerialEntryIsEligible({ category, sourceOrderStatus: 'P' }),
      ).toBe(true);
      expect(
        managerialEntryIsEligible({ category, sourceOrderStatus: null }),
      ).toBe(true);
    },
  );

  it('não exclui ordens finalizadas ou canceladas de outras contas', () => {
    expect(
      managerialEntryIsEligible({
        category: 'DIESEL',
        sourceOrderStatus: 'I',
      }),
    ).toBe(true);
    expect(
      managerialEntryIsEligible({
        category: 'DIESEL',
        sourceOrderStatus: 'C',
      }),
    ).toBe(true);
  });
});
