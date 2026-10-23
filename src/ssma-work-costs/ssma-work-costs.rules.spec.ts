import { normalizeSsmaWorkSnapshot } from './ssma-work-costs.rules';

const base = () => ({
  runId: 'ssma-work-20261019-001',
  generatedAt: '2026-10-19T15:00:00Z',
  fullSnapshot: true,
  productCodes: ['13189', '14515', '17410', '15016', '17411', '07085'],
  budgets: [
    {
      sourceId: 'budget-1',
      workCode: '459',
      workName: 'Obra 459',
      companyCode: '1',
      productCode: '14515',
      productDescription: 'Placa de obra',
      unit: 'UN',
      parentSourceId: null,
      stageId: null,
      quantity: '130',
      unitCost: '867.643077',
      amount: '112793.60',
      status: 'E',
      isOriginal: true,
    },
    {
      sourceId: 'budget-2',
      workCode: '458',
      workName: 'Obra 458',
      companyCode: '1',
      productCode: '07085',
      productDescription: 'Placa de sinalizacao',
      unit: 'UN',
      parentSourceId: null,
      stageId: null,
      quantity: null,
      unitCost: null,
      amount: null,
      status: 'A',
      isOriginal: false,
    },
  ],
  actuals: [
    {
      sourceKey: '1|90765|NFE|1',
      workCode: '459',
      workName: 'Obra 459',
      companyCode: '1',
      productCode: '14515',
      productDescription: 'Placa de obra',
      entryDate: '2026-05-20',
      status: 'F',
      unit: 'UN',
      quantity: '30',
      unitCost: '902.4',
      amount: '27072.00',
      accountCode: '811',
      documentType: 'NFE',
      documentId: '90765',
      documentItemId: '1',
      stageId: null,
    },
    {
      sourceKey: '2|90765|NFE|2',
      workCode: '458',
      workName: 'Obra 458',
      companyCode: '1',
      productCode: '07085',
      productDescription: 'Placa de sinalizacao',
      entryDate: '2026-05-21',
      status: 'C',
      unit: 'UN',
      quantity: '1',
      unitCost: '100',
      amount: '100.00',
      accountCode: '749',
      documentType: 'NFE',
      documentId: '90765',
      documentItemId: '2',
      stageId: null,
    },
  ],
});

const expanded = () => {
  const input = base();
  input.productCodes.push('1736', '7764', '9953', '17946');
  for (const row of input.budgets) {
    Object.assign(row, {
      isReused: false,
      reusedSourceId: null,
      eligibleBudgetReference: row.isOriginal,
      referenceExclusionReason: row.isOriginal ? null : 'NOT_ORIGINAL',
      rawAmount: row.amount,
      amountRounding: 'DECIMAL_2_AWAY_FROM_ZERO_PER_ROW',
      roundingDelta: row.amount === null ? null : '0',
    });
  }
  return input;
};

describe('SSMA work-cost snapshot rules', () => {
  it('normalizes leading zeros and keeps null distinct from zero', () => {
    const result = normalizeSsmaWorkSnapshot(base());
    expect(result.productCodes).toContain('7085');
    expect(result.budgets[1].productCode).toBe('7085');
    expect(result.budgets[1].amount).toBeNull();
    expect(result.budgets[0].amount).toBe('112793.60');
    expect(result.actuals[1].status).toBe('C');
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves open appropriations for audit without treating them as finalized', () => {
    const input = expanded();
    input.actuals[1].productCode = '1736';
    input.actuals[1].status = 'A';
    expect(normalizeSsmaWorkSnapshot(input).actuals[1]).toMatchObject({
      productCode: '1736',
      status: 'A',
      amount: '100.00',
    });
  });

  it('accepts only the complete expanded bathroom and signage scope', () => {
    const input = expanded();
    input.budgets[0].productCode = '1736';
    input.actuals[0].productCode = '1736';
    const result = normalizeSsmaWorkSnapshot(input);
    expect(result.productCodes).toEqual([
      '13189',
      '14515',
      '15016',
      '1736',
      '17410',
      '17411',
      '17946',
      '7085',
      '7764',
      '9953',
    ]);

    input.productCodes.pop();
    expect(() => normalizeSsmaWorkSnapshot(input)).toThrow(
      'escopo de produtos',
    );

    const undeclared = base();
    undeclared.actuals[0].productCode = '1736';
    expect(() => normalizeSsmaWorkSnapshot(undeclared)).toThrow(
      'fora do escopo declarado',
    );
  });

  it('audits reused budgets and verifies exact per-line rounding', () => {
    const input = expanded();
    Object.assign(input.budgets[0], {
      isReused: true,
      eligibleBudgetReference: false,
      referenceExclusionReason: 'REUSED',
      rawAmount: '112793.596',
      roundingDelta: '0.004',
    });
    expect(normalizeSsmaWorkSnapshot(input).budgets[0]).toMatchObject({
      isReused: true,
      eligibleBudgetReference: false,
      referenceExclusionReason: 'REUSED',
      rawAmount: '112793.596',
      roundingDelta: '0.004',
    });
    Object.assign(input.budgets[0], { roundingDelta: '0' });
    expect(() => normalizeSsmaWorkSnapshot(input)).toThrow(
      'memoria de arredondamento inconsistente',
    );
  });

  it('keeps an unverified work name absent instead of inventing it', () => {
    const input = base();
    input.budgets[0].workName = null as unknown as string;
    input.actuals[0].workName = null as unknown as string;
    const result = normalizeSsmaWorkSnapshot(input);
    expect(result.budgets[0].workName).toBeNull();
    expect(result.actuals[0].workName).toBeNull();
  });

  it('rejects excluded products, incomplete scope and partial photographs', () => {
    const excluded = base();
    excluded.budgets[0].productCode = '14519';
    expect(() => normalizeSsmaWorkSnapshot(excluded)).toThrow('fora do escopo');
    excluded.budgets[0].productCode = '06250';
    expect(() => normalizeSsmaWorkSnapshot(excluded)).toThrow('fora do escopo');
    const incomplete = base();
    incomplete.productCodes.pop();
    expect(() => normalizeSsmaWorkSnapshot(incomplete)).toThrow(
      'escopo de produtos',
    );
    const partial = base();
    partial.fullSnapshot = false;
    expect(() => normalizeSsmaWorkSnapshot(partial)).toThrow(
      'fotografia completa',
    );
  });

  it('rejects duplicate source identity and finalized actual without amount', () => {
    const duplicate = base();
    duplicate.actuals[1].sourceKey = duplicate.actuals[0].sourceKey;
    expect(() => normalizeSsmaWorkSnapshot(duplicate)).toThrow('duplicada');
    const missing = base();
    missing.actuals[0].amount = null as unknown as string;
    expect(() => normalizeSsmaWorkSnapshot(missing)).toThrow('sem valor');
  });

  it('rejects impossible calendar dates and non-UTC snapshot time', () => {
    const invalidDay = base();
    invalidDay.actuals[0].entryDate = '2026-02-30';
    expect(() => normalizeSsmaWorkSnapshot(invalidDay)).toThrow(
      'entryDate invalido',
    );
    const localTime = base();
    localTime.generatedAt = '2026-10-19T15:00:00-03:00';
    expect(() => normalizeSsmaWorkSnapshot(localTime)).toThrow(
      'generatedAt invalido',
    );
  });
});
