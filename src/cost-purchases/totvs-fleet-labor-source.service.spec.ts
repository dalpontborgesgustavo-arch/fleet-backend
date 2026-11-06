import { normalizeFleetLaborRows, TotvsFleetLaborSourceService } from './totvs-fleet-labor-source.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

const row = (competence: string, employeeNumber: string, period = 20,
  total = '100.00') => ({
  CODCOLIGADA: '1', CHAPA: employeeNumber, FK_FUNCIONARIO: `1-${employeeNumber}`,
  DT_MES: `${competence}-01T00:00:00`, NROPERIODO: period,
  TOTAL_GERAL_RATEADO: total, CARDINALIDADE_OK: 1,
  FORMULA_ID: 'IND.BI.0025_RATEADO_V1',
});

describe('fonte isolada de mao de obra de Resultados Frota', () => {
  it('aceita duas competencias e calcula totais exatos sem misturar meses', () => {
    const prepared = normalizeFleetLaborRows([
      row('2026-09', '0002', 20, '123.456789'),
      row('2026-10', '0001', 30, '9.01'),
      row('2026-09', '0001', 20, '10.00'),
    ]);
    expect(prepared.competences).toEqual([
      { competence: '2026-09', rowCount: 2, totalCost: '133.456789' },
      { competence: '2026-10', rowCount: 1, totalCost: '9.010000' },
    ]);
    expect(prepared.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita cardinalidade nao reconciliada e total nulo', () => {
    expect(() => normalizeFleetLaborRows([
      { ...row('2026-09', '0001'), CARDINALIDADE_OK: 0,
        TOTAL_GERAL_RATEADO: null },
    ])).toThrow();
  });

  it('rejeita funcionario-periodo duplicado e identidade divergente', () => {
    expect(() => normalizeFleetLaborRows([
      row('2026-09', '0001'), row('2026-09', '0001'),
    ])).toThrow(/duplicados/);
    expect(() => normalizeFleetLaborRows([
      { ...row('2026-09', '0001'), FK_FUNCIONARIO: '1-0002' },
    ])).toThrow(/Identidade/);
  });

  it('rejeita mais de duas competencias e formula errada', () => {
    expect(() => normalizeFleetLaborRows([
      row('2026-08', '0001'), row('2026-09', '0001'), row('2026-10', '0001'),
    ])).toThrow(/duas competencias/);
    expect(() => normalizeFleetLaborRows([
      { ...row('2026-10', '0001'), FORMULA_ID: 'IND.BI.0025' },
    ])).toThrow(/Formula/);
  });

  it('rejeita o antigo rascunho integral mesmo se ele alegar cardinalidade valida', () => {
    expect(() => normalizeFleetLaborRows([{
      ...row('2026-10', '0001'), FORMULA_ID: 'IND.BI.0025_INTEGRAL_V1',
    }])).toThrow(/Formula/);
    expect(() => normalizeFleetLaborRows([{
      ...row('2026-10', '0001'), TOTAL_GERAL_RATEADO: null,
    }])).toThrow(/TOTAL_GERAL_RATEADO/);
  });

  it('rejeita colunas extras, inclusive do rascunho integral', () => {
    expect(() => normalizeFleetLaborRows([{
      ...row('2026-10', '0001'), TOTAL_GERAL_INTEGRAL: '100.00',
    }])).toThrow(/Colunas/);
  });

  it('rejeita competencia ainda nao encerrada', () => {
    expect(() => normalizeFleetLaborRows([row('2099-01', '0001')]))
      .toThrow(/encerrada/);
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
    global.fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify(source)));
    const tx = {
      totvsFleetLaborCost: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      totvsFleetLaborSyncRun: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      totvsFleetLaborSyncRun: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValueOnce({ id: 'run-1', companyId: 'JR_CONSTRUCOES',
          unitId: 'USINA_ASFALTO_ICARA' }).mockResolvedValueOnce({ id: 'run-2',
          companyId: 'JR_CONSTRUCOES', unitId: 'USINA_ASFALTO_ICARA' }),
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      totvsFleetLaborCost: { count: jest.fn().mockResolvedValue(2) },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
    };
    try {
      const service = new TotvsFleetLaborSourceService(prisma as unknown as PrismaService);
      const first = await service.stage('admin-1');
      const second = await service.stage('admin-1');
      expect(first).toMatchObject({ runId: 'run-1', status: 'STAGED', rowCount: 2 });
      expect(second).toMatchObject({ runId: 'run-1', checkRunId: 'run-2',
        status: 'UNCHANGED', rowCount: 2 });
      expect(tx.totvsFleetLaborCost.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.totvsFleetLaborSyncRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'UNCHANGED' }) }),
      );
    } finally {
      global.fetch = oldFetch;
      if (oldEnv.code === undefined) delete process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE;
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
    const rowId = 'row-september';
    const tx = {
      totvsFleetLaborSyncRun: { findUnique: jest.fn().mockResolvedValue({
        id: 'run-1', status: 'STAGED', companyId: 'JR_CONSTRUCOES',
        unitId: 'USINA_ASFALTO_ICARA', sourceHash: 'a'.repeat(64),
        queryCode: 'IND.BI.0039', ruleVersion: 'IND.BI.0025_RATEADO_V1',
      }) },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue([{ id: rowId,
          competence: new Date('2026-09-01T00:00:00.000Z'),
          employeeKey: '1-0001', period: 20,
          totalGeneralRateado: new Prisma.Decimal('100.00'), cardinalityOk: true,
          ruleVersion: 'IND.BI.0025_RATEADO_V1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      totvsFleetLaborApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'approval-september' }),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)) };
    try {
      const service = new TotvsFleetLaborSourceService(prisma as unknown as PrismaService);
      const result = await service.activate('run-1', {
        competence: '2026-09', sourceHash: 'a'.repeat(64), rowCount: 1,
        totalCost: '100.00', evidenceRef: 'parity-report-2026-09-reviewed',
      }, 'admin-1');
      expect(result).toEqual({ approvalId: 'approval-september',
        competence: '2026-09', alreadyActive: false });
      expect(tx.totvsFleetLaborCost.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { syncRunId: 'run-1', competence: new Date('2026-09-01T00:00:00.000Z') },
      }));
      expect(tx.totvsFleetLaborCost.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { syncRunId: 'run-1', competence: new Date('2026-09-01T00:00:00.000Z') },
        data: { isCurrent: true, approvalId: 'approval-september' },
      }));
    } finally {
      if (old === undefined) delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('nao reativa uma aprovacao antiga depois de ser substituida', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = 'true';
    const tx = {
      totvsFleetLaborSyncRun: { findUnique: jest.fn().mockResolvedValue({
        id: 'old-run', status: 'STAGED', companyId: 'JR_CONSTRUCOES',
        unitId: 'USINA_ASFALTO_ICARA', sourceHash: 'b'.repeat(64),
        queryCode: 'IND.BI.0039', ruleVersion: 'IND.BI.0025_RATEADO_V1',
      }) },
      totvsFleetLaborCost: {
        findMany: jest.fn().mockResolvedValue([{ id: 'row-old',
          competence: new Date('2026-09-01T00:00:00.000Z'),
          employeeKey: '1-0001', period: 20,
          totalGeneralRateado: new Prisma.Decimal('100.00'), cardinalityOk: true,
          ruleVersion: 'IND.BI.0025_RATEADO_V1' }]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      totvsFleetLaborApproval: { findUnique: jest.fn().mockResolvedValue({ id: 'old-approval' }) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)) };
    try {
      const service = new TotvsFleetLaborSourceService(prisma as unknown as PrismaService);
      await expect(service.activate('old-run', {
        competence: '2026-09', sourceHash: 'b'.repeat(64), rowCount: 1,
        totalCost: '100.00', evidenceRef: 'parity-report-2026-09-reviewed',
      })).rejects.toThrow(/substituido/);
      expect(tx.totvsFleetLaborCost.updateMany).not.toHaveBeenCalled();
    } finally {
      if (old === undefined) delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
      else process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('bloqueia ativacao sem flag mesmo com lote preparado', async () => {
    const old = process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    delete process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED;
    try {
      const service = new TotvsFleetLaborSourceService({} as PrismaService);
      await expect(service.activate('run-1', { competence: '2026-09',
        sourceHash: 'a'.repeat(64), rowCount: 1, totalCost: '100',
        evidenceRef: 'parity-report-2026-09-reviewed',
      })).rejects.toThrow(/nao liberada/);
    } finally {
      if (old !== undefined) process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED = old;
    }
  });

  it('readback independente detecta total divergente apos aprovacao', async () => {
    const prisma = {
      totvsFleetLaborApproval: { findFirst: jest.fn().mockResolvedValue({
        id: 'approval-1', sourceHash: 'c'.repeat(64), rowCount: 1,
        totalCost: new Prisma.Decimal('100.00'),
        evidenceRef: 'parity-report-2026-09-reviewed', approvedAt: new Date(),
        syncRun: { queryCode: 'IND.BI.0039', status: 'STAGED',
          sourceHash: 'c'.repeat(64), ruleVersion: 'IND.BI.0025_RATEADO_V1' },
      }) },
      totvsFleetLaborCost: {
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValueOnce({
          _sum: { totalGeneralRateado: new Prisma.Decimal('100.00') },
        }).mockResolvedValueOnce({
          _sum: { totalGeneralRateado: new Prisma.Decimal('99.00') },
        }),
      },
    };
    const service = new TotvsFleetLaborSourceService(prisma as unknown as PrismaService);
    expect(await service.readback('2026-09')).toMatchObject({
      competence: '2026-09', officialReady: true, currentRows: 1,
      currentTotal: '100.000000',
    });
    expect(await service.readback('2026-09')).toMatchObject({
      competence: '2026-09', officialReady: false, currentTotal: '99.000000',
    });
  });
});
