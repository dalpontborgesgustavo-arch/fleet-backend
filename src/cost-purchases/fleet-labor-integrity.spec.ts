import { Prisma } from '@prisma/client';
import { normalizeFleetLaborRows } from './totvs-fleet-labor-source.service';
import {
  compareFleetLaborParity, fingerprint0025Aggregate, fingerprintFleetLaborFacts,
  verifyApprovedFleetLaborIntegrity,
} from './fleet-labor-integrity';
import { PrismaService } from '../prisma/prisma.service';

const scope = { companyId: 'JR_CONSTRUCOES', unitId: 'USINA_ASFALTO_ICARA',
  queryCode: 'IND.BI.0039', ruleVersion: 'IND.BI.0025_RATEADO_V1',
  syncRunId: 'dedicated-run' };
function fact(number: string, value: string) {
  const normalized = normalizeFleetLaborRows([{
    CODCOLIGADA: '1', CHAPA: number, FK_FUNCIONARIO: `1-${number}`,
    DT_MES: '2026-10-01', NROPERIODO: 20,
    TOTAL_GERAL_RATEADO: value, CARDINALIDADE_OK: 1,
    FORMULA_ID: 'IND.BI.0025_RATEADO_V1',
  }]).rows[0];
  return { ...normalized, ...scope, active: true, isCurrent: true,
    approvalId: 'approval-1' };
}
function baseline(item: ReturnType<typeof fact>, value = item.totalGeneralRateado.toFixed(6)) {
  const source = { companyCode: item.companyCode, employeeNumber: item.employeeNumber,
    employeeKey: item.employeeKey, competence: item.competence, period: item.period,
    totalGeneralLine: new Prisma.Decimal(value), contentHash: `source-${item.employeeKey}`,
    sourceRows: 1, allocationRows: 0, fixedAllocationValue: null,
    allocationClosed: false, officialCostEligible: false,
    pendingReason: 'PFRATEIOFIXO_CARDINALIDADE_NAO_RECONCILIADA',
    syncRunId: `source-run-${item.employeeKey}`,
    syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } };
  return { ...source, contentHash: fingerprint0025Aggregate(source) };
}

describe('paridade canonica de mao de obra', () => {
  const a = fact('001', '100.00');
  const b = fact('002', '50.00');

  it('aceita keyset e valores exatos, incluindo o hash de cada fato', () => {
    const fingerprint = fingerprintFleetLaborFacts([b, a], scope);
    const report = compareFleetLaborParity(fingerprint.entries, [baseline(a), baseline(b)]);
    expect(report).toMatchObject({ matching: true, issueCount: 0,
      baselineRows: 2, candidateRows: 2,
      baselineTotal: '150.000000', candidateTotal: '150.000000' });
  });

  it('rejeita troca de valores mesmo quando a soma global permanece igual', () => {
    const fingerprint = fingerprintFleetLaborFacts([a, b], scope);
    const report = compareFleetLaborParity(fingerprint.entries,
      [baseline(a, '50.00'), baseline(b, '100.00')]);
    expect(report.matching).toBe(false);
    expect(report.issueCount).toBe(2);
    expect(report.baselineTotal).toBe(report.candidateTotal);
    expect(report.issues.every((issue) => issue.reason === 'VALUE_MISMATCH')).toBe(true);
  });

  it('rejeita custo nulo, lacuna de chave e run de origem rejeitado', () => {
    const fingerprint = fingerprintFleetLaborFacts([a, b], scope);
    const source = { ...baseline(a), totalGeneralLine: null,
      syncRun: { status: 'SUCCEEDED', rejectedRows: 1 } };
    const report = compareFleetLaborParity(fingerprint.entries, [source]);
    expect(report.matching).toBe(false);
    expect(report.issues.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'NULL_0025_VALUE', 'UNHEALTHY_0025_ROW_RUN', 'MISSING_IN_0025',
    ]));
  });

  it('recalcula o hash e rejeita adulteracao de fato estagiado', () => {
    expect(() => fingerprintFleetLaborFacts([
      { ...a, totalGeneralRateado: new Prisma.Decimal('99.00') }, b,
    ], scope)).toThrow(/Hash/);
    expect(() => fingerprintFleetLaborFacts([
      { ...a, employeeNumber: '999' }, b,
    ], scope)).toThrow(/contrato/);
  });

  it('detecta troca de dois valores com hashes individuais refeitos e mesma soma', () => {
    const original = fingerprintFleetLaborFacts([a, b], scope);
    const swapped = fingerprintFleetLaborFacts([
      fact('001', '50.00'), fact('002', '100.00'),
    ], scope);
    expect(swapped.entries.reduce((sum, row) => sum + Number(row.value), 0))
      .toBe(original.entries.reduce((sum, row) => sum + Number(row.value), 0));
    expect(swapped.sourceHash).not.toBe(original.sourceHash);
  });

  it('readback invalida recibo quando o baseline 0025 muda', async () => {
    const fingerprint = fingerprintFleetLaborFacts([a], scope);
    const parity = compareFleetLaborParity(fingerprint.entries, [baseline(a)]);
    const receipt = { id: 'approval-1', competence: a.competence, rowCount: 1,
      totalCost: new Prisma.Decimal('100.00'), sourceHash: fingerprint.sourceHash,
      baselineHash: parity.baselineHash, candidateHash: fingerprint.sourceHash,
      baselineSyncRunId: 'baseline-checkpoint', syncRunId: scope.syncRunId,
      syncRun: { status: 'STAGED', sourceHash: fingerprint.sourceHash,
        queryCode: scope.queryCode, ruleVersion: scope.ruleVersion },
      reversal: null };
    const db = { totvsFleetLaborCost: { findMany: jest.fn().mockResolvedValue([a]) },
      totvsEmployeeCostAggregate: { findMany: jest.fn()
        .mockResolvedValueOnce([baseline(a)])
        .mockResolvedValueOnce([baseline(a, '101.00')]) },
      totvsEmployeeSyncRun: { findUnique: jest.fn().mockResolvedValue({
        status: 'SUCCEEDED', rejectedRows: 0,
      }) } };
    expect(await verifyApprovedFleetLaborIntegrity(db as unknown as PrismaService,
      receipt, scope)).toBe(true);
    expect(await verifyApprovedFleetLaborIntegrity(db as unknown as PrismaService,
      receipt, scope)).toBe(false);
  });
});
