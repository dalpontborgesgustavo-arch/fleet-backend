import {
  normalizeFleetLaborRows,
  TotvsFleetLaborSourceService,
} from './totvs-fleet-labor-source.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  compareFleetLaborParity,
  fingerprint0025Aggregate,
  fingerprint0025Manifest,
  fingerprintFleetLaborFacts,
} from './fleet-labor-integrity';

const row = (
  competence: string,
  employeeNumber: string,
  period = 20,
  total = '100.00',
) => ({
  CODCOLIGADA: '1',
  CHAPA: employeeNumber,
  FK_FUNCIONARIO: `1-${employeeNumber}`,
  DT_MES: `${competence}-01T00:00:00`,
  NROPERIODO: period,
  TOTAL_GERAL_RATEADO: total,
  CARDINALIDADE_OK: 1,
  FORMULA_ID: 'IND.BI.0025_RATEADO_V1',
});

const scope = {
  companyId: 'JR_CONSTRUCOES',
  unitId: 'USINA_ASFALTO_ICARA',
  queryCode: 'IND.BI.0039',
  ruleVersion: 'IND.BI.0025_RATEADO_V1',
  syncRunId: 'run-1',
};
function fact(competence: string, employeeNumber: string, total = '100.00') {
  return {
    ...normalizeFleetLaborRows([row(competence, employeeNumber, 20, total)])
      .rows[0],
    ...scope,
    id: `fact-${competence}-${employeeNumber}`,
    active: true,
    isCurrent: false,
    approvalId: null,
  };
}
function baseline(item: ReturnType<typeof fact>) {
  const source = {
    id: `aggregate-${item.employeeKey}-${item.competence.toISOString().slice(0, 7)}`,
    companyCode: item.companyCode,
    employeeNumber: item.employeeNumber,
    employeeKey: item.employeeKey,
    competence: item.competence,
    period: item.period,
    totalGeneralLine: item.totalGeneralRateado,
    sourceRows: 1,
    allocationRows: 0,
    fixedAllocationValue: null,
    allocationClosed: false,
    officialCostEligible: false,
    pendingReason: 'PFRATEIOFIXO_CARDINALIDADE_NAO_RECONCILIADA',
    contentHash: '',
    syncRunId: 'baseline-row-run',
    isCurrent: true,
    active: true,
    syncRun: { status: 'SUCCEEDED', rejectedRows: 0 },
  };
  return { ...source, contentHash: fingerprint0025Aggregate(source) };
}

describe('fonte isolada de mao de obra de Resultados Frota', () => {
  it('aceita duas competencias e calcula totais exatos sem misturar meses', () => {
    const prepared = normalizeFleetLaborRows([
      row('2026-09', '0002', 20, '123.456789'),
      row('2026-10', '0001', 20, '9.01'),
      row('2026-09', '0001', 20, '10.00'),
    ]);
    expect(prepared.competences).toEqual([
      { competence: '2026-09', rowCount: 2, totalCost: '133.456789' },
      { competence: '2026-10', rowCount: 1, totalCost: '9.010000' },
    ]);
    expect(prepared.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita cardinalidade nao reconciliada e total nulo', () => {
    expect(() =>
      normalizeFleetLaborRows([
        {
          ...row('2026-09', '0001'),
          CARDINALIDADE_OK: 0,
          TOTAL_GERAL_RATEADO: null,
        },
      ]),
    ).toThrow();
  });

  it('rejeita funcionario-periodo duplicado e identidade divergente', () => {
    expect(() =>
      normalizeFleetLaborRows([row('2026-09', '0001'), row('2026-09', '0001')]),
    ).toThrow(/duplicados/);
    expect(() =>
      normalizeFleetLaborRows([
        { ...row('2026-09', '0001'), FK_FUNCIONARIO: '1-0002' },
      ]),
    ).toThrow(/Identidade/);
  });

  it('rejeita mais de duas competencias e formula errada', () => {
    expect(() =>
      normalizeFleetLaborRows([
        row('2026-08', '0001'),
        row('2026-09', '0001'),
        row('2026-10', '0001'),
      ]),
    ).toThrow(/duas competencias/);
    expect(() =>
      normalizeFleetLaborRows([
        { ...row('2026-10', '0001'), FORMULA_ID: 'IND.BI.0025' },
      ]),
    ).toThrow(/Formula/);
  });

  it('rejeita periodo de decimo terceiro em mes incorreto', () => {
    expect(() => normalizeFleetLaborRows([row('2026-10', '0001', 30)])).toThrow(
      /Periodo de decimo terceiro/,
    );
  });

  it('rejeita o antigo rascunho integral mesmo se ele alegar cardinalidade valida', () => {
    expect(() =>
      normalizeFleetLaborRows([
        {
          ...row('2026-10', '0001'),
          FORMULA_ID: 'IND.BI.0025_INTEGRAL_V1',
        },
      ]),
    ).toThrow(/Formula/);
    expect(() =>
      normalizeFleetLaborRows([
        {
          ...row('2026-10', '0001'),
          TOTAL_GERAL_RATEADO: null,
        },
      ]),
    ).toThrow(/TOTAL_GERAL_RATEADO/);
  });

  it('rejeita colunas extras, inclusive do rascunho integral', () => {
    expect(() =>
      normalizeFleetLaborRows([
        {
          ...row('2026-10', '0001'),
          TOTAL_GERAL_INTEGRAL: '100.00',
        },
      ]),
    ).toThrow(/Colunas/);
  });

  it('rejeita competencia ainda nao encerrada', () => {
    expect(() => normalizeFleetLaborRows([row('2099-01', '0001')])).toThrow(
      /encerrada/,
    );
  });

  it('nao permite usar a consulta compartilhada como fonte dedicada', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE;
    process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE = 'IND.BI.0025';
    try {
      const service = new TotvsFleetLaborSourceService({} as PrismaService);
      await expect(service.stage()).rejects.toThrow(/nao configurada/);
    } finally {
      if (old === undefined) delete process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE;
      else process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE = old;
    }
  });

  it('estagia uma vez e reconhece repeticao identica sem duplicar linhas', async () => {
    const oldEnv = {
      code: process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE,
      base: process.env.TOTVS_RM_BASE_URL,
      user: process.env.TOTVS_RM_USERNAME,
      password: process.env.TOTVS_RM_PASSWORD,
    };
    const oldFetch = global.fetch;
    process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE = 'IND.BI.0039';
    process.env.TOTVS_RM_BASE_URL = 'https://totvs.example';
    process.env.TOTVS_RM_USERNAME = 'test';
    process.env.TOTVS_RM_PASSWORD = 'test';
    const source = [row('2026-09', '0001'), row('2026-10', '0002')];
    global.fetch = jest
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(source)));
    const tx = {
      totvsFleetLaborCost: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      totvsFleetLaborSyncRun: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      totvsFleetLaborSyncRun: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'run-1',
            companyId: 'JR_CONSTRUCOES',
            unitId: 'USINA_ASFALTO_ICARA',
          })
          .mockResolvedValueOnce({
            id: 'run-2',
            companyId: 'JR_CONSTRUCOES',
            unitId: 'USINA_ASFALTO_ICARA',
          }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      totvsFleetLaborCost: { count: jest.fn().mockResolvedValue(2) },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(
        prisma as unknown as PrismaService,
      );
      const first = await service.stage('admin-1');
      const second = await service.stage('admin-1');
      expect(first).toMatchObject({
        runId: 'run-1',
        status: 'STAGED',
        rowCount: 2,
      });
      expect(second).toMatchObject({
        runId: 'run-1',
        checkRunId: 'run-2',
        status: 'UNCHANGED',
        rowCount: 2,
      });
      expect(tx.totvsFleetLaborCost.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.totvsFleetLaborSyncRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'STAGED',
            approvals: { none: {} },
            finishedAt: { gte: expect.any(Date) },
          }),
        }),
      );
      expect(prisma.totvsFleetLaborSyncRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'UNCHANGED' }),
        }),
      );
    } finally {
      global.fetch = oldFetch;
      if (oldEnv.code === undefined)
        delete process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE;
      else process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE = oldEnv.code;
      if (oldEnv.base === undefined) delete process.env.TOTVS_RM_BASE_URL;
      else process.env.TOTVS_RM_BASE_URL = oldEnv.base;
      if (oldEnv.user === undefined) delete process.env.TOTVS_RM_USERNAME;
      else process.env.TOTVS_RM_USERNAME = oldEnv.user;
      if (oldEnv.password === undefined) delete process.env.TOTVS_RM_PASSWORD;
      else process.env.TOTVS_RM_PASSWORD = oldEnv.password;
    }
  });

  it('ativa somente a competencia conciliada do lote de dois meses', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = 'true';
    const facts = [fact('2026-09', '0001'), fact('2026-10', '0002')];
    const sourceHash = fingerprintFleetLaborFacts(facts, scope).sourceHash;
    const now = new Date();
    const baselineRow = baseline(facts[0]);
    const baselineManifest = fingerprint0025Manifest([baselineRow]);
    const tx = {
      totvsFleetLaborSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'STAGED',
          companyId: 'JR_CONSTRUCOES',
          unitId: 'USINA_ASFALTO_ICARA',
          sourceHash,
          acceptedRows: 2,
          queryCode: 'IND.BI.0039',
          ruleVersion: 'IND.BI.0025_RATEADO_V1',
          finishedAt: now,
        }),
      },
      totvsEmployeeSyncRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'baseline-run',
          status: 'SUCCEEDED',
          rejectedRows: 0,
          finishedAt: now,
          contextCode: '0/P',
          aggregateCount: 1,
        }),
      },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([baselineRow]),
      },
      totvsEmployeeCostRunManifest: {
        findUnique: jest.fn().mockResolvedValue({
          rowCount: 1,
          contentHash: baselineManifest.contentHash,
          memberships: [{ aggregate: baselineRow }],
        }),
      },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue(facts),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      totvsFleetLaborApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'approval-september' }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(
        prisma as unknown as PrismaService,
      );
      const result = await service.activate(
        'run-1',
        {
          competence: '2026-09',
          sourceHash,
          rowCount: 1,
          totalCost: '100.00',
          evidenceRef: 'parity-report-2026-09-reviewed',
        },
        'admin-1',
      );
      expect(result).toMatchObject({
        approvalId: 'approval-september',
        competence: '2026-09',
        alreadyActive: false,
        baselineRunId: 'baseline-run',
      });
      expect(tx.totvsFleetLaborCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { syncRunId: 'run-1' },
        }),
      );
      expect(tx.totvsFleetLaborCost.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            syncRunId: 'run-1',
            competence: new Date('2026-09-01T00:00:00.000Z'),
            approvalId: null,
            isCurrent: false,
          },
          data: { isCurrent: true, approvalId: 'approval-september' },
        }),
      );
      expect(tx.totvsFleetLaborApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            baselineSyncRunId: 'baseline-run',
            baselineHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      );
    } finally {
      if (old === undefined)
        delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('relata diferencas por funcionario e bloqueia ativacao com soma igual', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = 'true';
    const facts = [
      fact('2026-10', '0001', '100.00'),
      fact('2026-10', '0002', '50.00'),
    ];
    const sourceHash = fingerprintFleetLaborFacts(facts, scope).sourceHash;
    const swappedA = {
      ...baseline(facts[0]),
      totalGeneralLine: new Prisma.Decimal('50.00'),
    };
    const swappedB = {
      ...baseline(facts[1]),
      totalGeneralLine: new Prisma.Decimal('100.00'),
    };
    swappedA.contentHash = fingerprint0025Aggregate(swappedA);
    swappedB.contentHash = fingerprint0025Aggregate(swappedB);
    const baselineManifest = fingerprint0025Manifest([swappedA, swappedB]);
    const now = new Date();
    const tx = {
      totvsFleetLaborSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'STAGED',
          companyId: scope.companyId,
          unitId: scope.unitId,
          queryCode: scope.queryCode,
          ruleVersion: scope.ruleVersion,
          sourceHash,
          acceptedRows: 2,
          finishedAt: now,
        }),
      },
      totvsEmployeeSyncRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'baseline-run',
          status: 'SUCCEEDED',
          rejectedRows: 0,
          finishedAt: now,
          contextCode: '0/P',
          aggregateCount: 2,
        }),
      },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue(facts),
        updateMany: jest.fn(),
      },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([swappedA, swappedB]),
      },
      totvsEmployeeCostRunManifest: {
        findUnique: jest.fn().mockResolvedValue({
          rowCount: 2,
          contentHash: baselineManifest.contentHash,
          memberships: [{ aggregate: swappedA }, { aggregate: swappedB }],
        }),
      },
      totvsFleetLaborApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(
        prisma as unknown as PrismaService,
      );
      expect(await service.parity('run-1', '2026-10')).toMatchObject({
        matching: false,
        issueCount: 2,
        baselineTotal: '150.000000',
        candidateTotal: '150.000000',
      });
      await expect(
        service.activate('run-1', {
          competence: '2026-10',
          sourceHash,
          rowCount: 2,
          totalCost: '150.00',
          evidenceRef: 'manual-note-does-not-prove-parity',
        }),
      ).rejects.toThrow(/Paridade/);
      expect(tx.totvsFleetLaborApproval.create).not.toHaveBeenCalled();
      expect(tx.totvsFleetLaborCost.updateMany).not.toHaveBeenCalled();
    } finally {
      if (old === undefined)
        delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('bloqueia paridade se a ultima captura 0025 tem rejeicoes', async () => {
    const item = fact('2026-10', '0001');
    const sourceHash = fingerprintFleetLaborFacts([item], scope).sourceHash;
    const now = new Date();
    const prisma = {
      totvsFleetLaborSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'STAGED',
          companyId: scope.companyId,
          unitId: scope.unitId,
          queryCode: scope.queryCode,
          ruleVersion: scope.ruleVersion,
          sourceHash,
          acceptedRows: 1,
          finishedAt: now,
        }),
      },
      totvsEmployeeSyncRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'baseline-run',
          status: 'SUCCEEDED',
          rejectedRows: 1,
          finishedAt: now,
          contextCode: '0/P',
        }),
      },
      totvsFleetLaborCost: { findMany: jest.fn() },
    };
    const service = new TotvsFleetLaborSourceService(
      prisma as unknown as PrismaService,
    );
    await expect(service.parity('run-1', '2026-10')).rejects.toThrow(
      /incompleta/,
    );
    expect(prisma.totvsFleetLaborCost.findMany).not.toHaveBeenCalled();
  });

  it('rejeita agregado corrente antigo que nao foi observado no ultimo run 0025', async () => {
    const item = fact('2026-10', '0001');
    const sourceHash = fingerprintFleetLaborFacts([item], scope).sourceHash;
    const stale = baseline(item);
    const now = new Date();
    const prisma = {
      totvsFleetLaborSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'STAGED',
          companyId: scope.companyId,
          unitId: scope.unitId,
          queryCode: scope.queryCode,
          ruleVersion: scope.ruleVersion,
          sourceHash,
          acceptedRows: 1,
          finishedAt: now,
        }),
      },
      totvsEmployeeSyncRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'baseline-run-latest',
          status: 'SUCCEEDED',
          rejectedRows: 0,
          finishedAt: now,
          contextCode: '0/P',
          aggregateCount: 1,
        }),
      },
      totvsFleetLaborCost: { findMany: jest.fn().mockResolvedValue([item]) },
      totvsEmployeeCostRunManifest: {
        findUnique: jest.fn().mockResolvedValue({
          // The latest run explicitly observed no aggregate in this competence.
          rowCount: 0,
          contentHash: fingerprint0025Manifest([]).contentHash,
          memberships: [],
        }),
      },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([stale]),
      },
    };
    const service = new TotvsFleetLaborSourceService(
      prisma as unknown as PrismaService,
    );
    await expect(service.parity('run-1', '2026-10')).rejects.toThrow(
      /manifesto/,
    );
  });

  it('registra reversao imutavel sem apagar a aprovacao anterior', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = 'true';
    const tx = {
      totvsFleetLaborApproval: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'approval-1',
          companyId: scope.companyId,
          unitId: scope.unitId,
          competence: new Date('2026-10-01T00:00:00.000Z'),
          reversal: null,
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 'approval-1' }),
      },
      totvsFleetLaborReversal: {
        create: jest.fn().mockResolvedValue({ id: 'reverse-1' }),
      },
      totvsFleetLaborCost: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(
        prisma as unknown as PrismaService,
      );
      expect(
        await service.reverse(
          'approval-1',
          'Fonte corrigida e lote substituido',
          'admin-1',
        ),
      ).toEqual({
        approvalId: 'approval-1',
        reversalId: 'reverse-1',
        alreadyReversed: false,
      });
      expect(tx.totvsFleetLaborReversal.create).toHaveBeenCalledWith({
        data: {
          approvalId: 'approval-1',
          reason: 'Fonte corrigida e lote substituido',
          reversedById: 'admin-1',
        },
      });
      expect(tx.totvsFleetLaborCost.updateMany).toHaveBeenCalledWith({
        where: { approvalId: 'approval-1', isCurrent: true, active: true },
        data: { isCurrent: false },
      });
    } finally {
      if (old === undefined)
        delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('nao reativa uma aprovacao antiga depois de ser substituida', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = 'true';
    const tx = {
      totvsFleetLaborSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-run',
          status: 'STAGED',
          companyId: 'JR_CONSTRUCOES',
          unitId: 'USINA_ASFALTO_ICARA',
          sourceHash: 'b'.repeat(64),
          queryCode: 'IND.BI.0039',
          ruleVersion: 'IND.BI.0025_RATEADO_V1',
        }),
      },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'row-old',
            competence: new Date('2026-09-01T00:00:00.000Z'),
            employeeKey: '1-0001',
            period: 20,
            totalGeneralRateado: new Prisma.Decimal('100.00'),
            cardinalityOk: true,
            ruleVersion: 'IND.BI.0025_RATEADO_V1',
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      totvsFleetLaborApproval: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-approval',
          reversal: { id: 'reversal-1' },
        }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(
        prisma as unknown as PrismaService,
      );
      await expect(
        service.activate('old-run', {
          competence: '2026-09',
          sourceHash: 'b'.repeat(64),
          rowCount: 1,
          totalCost: '100.00',
          evidenceRef: 'parity-report-2026-09-reviewed',
        }),
      ).rejects.toThrow(/substituido/);
      expect(tx.totvsFleetLaborCost.updateMany).not.toHaveBeenCalled();
    } finally {
      if (old === undefined)
        delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('bloqueia ativacao sem flag mesmo com lote preparado', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    try {
      const service = new TotvsFleetLaborSourceService({} as PrismaService);
      await expect(
        service.activate('run-1', {
          competence: '2026-09',
          sourceHash: 'a'.repeat(64),
          rowCount: 1,
          totalCost: '100',
          evidenceRef: 'parity-report-2026-09-reviewed',
        }),
      ).rejects.toThrow(/nao liberada/);
    } finally {
      if (old !== undefined)
        process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('readback independente detecta total divergente apos aprovacao', async () => {
    const approvedFact = {
      ...fact('2026-09', '0001'),
      isCurrent: true,
      approvalId: 'approval-1',
    };
    const fingerprint = fingerprintFleetLaborFacts([approvedFact], scope);
    const baselineRow = baseline(approvedFact);
    const baselineManifest = fingerprint0025Manifest([baselineRow]);
    const parity = compareFleetLaborParity(fingerprint.entries, [baselineRow]);
    const now = new Date();
    const prisma = {
      totvsFleetLaborApproval: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'approval-1',
          competence: approvedFact.competence,
          syncRunId: 'run-1',
          baselineSyncRunId: 'baseline-run',
          baselineHash: parity.baselineHash,
          candidateHash: fingerprint.sourceHash,
          parityVerifiedAt: now,
          sourceHash: fingerprint.sourceHash,
          rowCount: 1,
          totalCost: new Prisma.Decimal('100.00'),
          evidenceRef: 'parity-report-2026-09-reviewed',
          approvedAt: now,
          syncRun: {
            queryCode: 'IND.BI.0039',
            status: 'STAGED',
            sourceHash: fingerprint.sourceHash,
            ruleVersion: 'IND.BI.0025_RATEADO_V1',
            companyId: scope.companyId,
            unitId: scope.unitId,
            finishedAt: now,
          },
        }),
      },
      totvsEmployeeSyncRun: {
        findUnique: jest.fn().mockResolvedValue({
          companyId: scope.companyId,
          unitId: scope.unitId,
          queryCode: 'IND.BI.0025',
          contextCode: '0/P',
          status: 'SUCCEEDED',
          rejectedRows: 0,
          aggregateCount: 1,
          finishedAt: now,
        }),
      },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([baselineRow]),
      },
      totvsEmployeeCostRunManifest: {
        findUnique: jest.fn().mockResolvedValue({
          rowCount: 1,
          contentHash: baselineManifest.contentHash,
          memberships: [{ aggregate: baselineRow }],
        }),
      },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue([approvedFact]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({
            _sum: { totalGeneralRateado: new Prisma.Decimal('100.00') },
          })
          .mockResolvedValueOnce({
            _sum: { totalGeneralRateado: new Prisma.Decimal('99.00') },
          }),
      },
    };
    const service = new TotvsFleetLaborSourceService(
      prisma as unknown as PrismaService,
    );
    expect(await service.readback('2026-09')).toMatchObject({
      competence: '2026-09',
      officialReady: true,
      currentRows: 1,
      currentTotal: '100.000000',
    });
    expect(await service.readback('2026-09')).toMatchObject({
      competence: '2026-09',
      officialReady: false,
      currentTotal: '99.000000',
    });
  });
});
