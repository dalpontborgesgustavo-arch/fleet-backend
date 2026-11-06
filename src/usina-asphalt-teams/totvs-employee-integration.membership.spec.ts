import { BadGatewayException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TotvsEmployeeIntegrationService } from './totvs-employee-integration.service';

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('manifesto por run da IND.BI.0025', () => {
  const previousEnv = {
    base: process.env.TOTVS_RM_BASE_URL,
    user: process.env.TOTVS_RM_USERNAME,
    password: process.env.TOTVS_RM_PASSWORD,
  };
  const previousFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-06T12:00:00.000Z'));
    process.env.TOTVS_RM_BASE_URL = 'https://totvs.example';
    process.env.TOTVS_RM_USERNAME = 'test';
    process.env.TOTVS_RM_PASSWORD = 'test';
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = previousFetch;
    if (previousEnv.base === undefined) delete process.env.TOTVS_RM_BASE_URL;
    else process.env.TOTVS_RM_BASE_URL = previousEnv.base;
    if (previousEnv.user === undefined) delete process.env.TOTVS_RM_USERNAME;
    else process.env.TOTVS_RM_USERNAME = previousEnv.user;
    if (previousEnv.password === undefined)
      delete process.env.TOTVS_RM_PASSWORD;
    else process.env.TOTVS_RM_PASSWORD = previousEnv.password;
  });

  it('vincula agregado inalterado e preserva snapshots sem reprocessar', async () => {
    const competence = new Date('2026-09-01T00:00:00.000Z');
    const aggregateHash = hash({
      sourceRows: 1,
      allocationRows: 1,
      fixedAllocationValue: '1.000000',
      totalGeneralLine: '100.000000',
      allocationClosed: false,
      officialCostEligible: false,
      pendingReason: 'PFRATEIOFIXO_CARDINALIDADE_NAO_RECONCILIADA',
    });
    const employeeHash = hash({
      displayName: 'Funcionario 1',
      jobName: null,
      departmentName: null,
      employmentStatus: null,
      admissionDate: null,
      dismissalDate: null,
    });
    const currentEmployee = {
      id: 'employee-current',
      employeeKey: '1-0001',
      competence,
      period: 20,
      version: 1,
      contentHash: employeeHash,
      active: true,
    };
    const missingEmployee = {
      id: 'employee-missing',
      employeeKey: '1-0002',
      competence,
      period: 20,
      version: 1,
      contentHash: 'old',
      active: true,
    };
    const currentAggregate = {
      id: 'aggregate-current',
      employeeKey: '1-0001',
      competence,
      period: 20,
      version: 1,
      contentHash: aggregateHash,
      syncRunId: 'older-run',
      sourceRows: 1,
      active: true,
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            CODCOLIGADA: '1',
            CHAPA: '0001',
            FK_FUNCIONARIO: '1-0001',
            NOME: 'Funcionario 1',
            DT_MES: '2026-09-01',
            NROPERIODO: 20,
            'PFRATEIOFIXO.VALOR': '1',
            'TOTAL GERAL LINHA': '100',
          },
        ]),
      ),
    );
    const tx = {
      totvsEmployeeSnapshot: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn(),
      },
      totvsEmployeeCostAggregate: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn(),
      },
      totvsEmployeeCostRunManifest: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      totvsEmployeeCostRunMembership: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      totvsEmployeeSyncRun: {
        create: jest.fn().mockResolvedValue({ id: 'baseline-run' }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      },
      totvsEmployeeSnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue([currentEmployee, missingEmployee]),
      },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([currentAggregate]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    const service = new TotvsEmployeeIntegrationService(
      prisma as unknown as PrismaService,
    );

    const result = (await service.refresh('admin-1')) as { replayed: boolean };

    expect(tx.totvsEmployeeCostRunManifest.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          syncRunId: 'baseline-run',
          competence: new Date('2026-09-01T00:00:00.000Z'),
          rowCount: 1,
        }),
        expect.objectContaining({
          syncRunId: 'baseline-run',
          competence: new Date('2026-10-01T00:00:00.000Z'),
          rowCount: 0,
        }),
      ]),
    });
    expect(tx.totvsEmployeeCostRunMembership.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          aggregateId: 'aggregate-current',
          id: expect.any(String),
          manifestId: expect.any(String),
        }),
      ],
    });
    expect(tx.totvsEmployeeCostAggregate.updateMany).not.toHaveBeenCalled();
    expect(tx.totvsEmployeeSnapshot.updateMany).not.toHaveBeenCalled();
    expect(tx.totvsEmployeeCostAggregate.createMany).not.toHaveBeenCalled();
    expect(result.replayed).toBe(true);
  });

  it('falha sem gravar agregados quando parte da resposta da 0025 e invalida', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            CODCOLIGADA: '1',
            CHAPA: '0001',
            FK_FUNCIONARIO: '1-0001',
            NOME: 'Funcionario 1',
            DT_MES: '2026-09-01',
            NROPERIODO: 20,
            'PFRATEIOFIXO.VALOR': '1',
            'TOTAL GERAL LINHA': '100',
          },
          {
            CODCOLIGADA: '1',
            CHAPA: '0002',
            FK_FUNCIONARIO: '1-0002',
            NOME: 'Funcionario 2',
            DT_MES: '2026-09-01',
            NROPERIODO: 99,
            'PFRATEIOFIXO.VALOR': '1',
            'TOTAL GERAL LINHA': '200',
          },
        ]),
      ),
    );
    const updateRun = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(data));
    const prisma = {
      totvsEmployeeSyncRun: {
        create: jest.fn().mockResolvedValue({ id: 'partial-run' }),
        update: updateRun,
      },
      totvsEmployeeSnapshot: { findMany: jest.fn() },
      totvsEmployeeCostAggregate: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new TotvsEmployeeIntegrationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.refresh('admin-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.totvsEmployeeSnapshot.findMany).not.toHaveBeenCalled();
    expect(prisma.totvsEmployeeCostAggregate.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'partial-run' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorDetail: expect.stringContaining('1 linha(s) invalida(s)'),
      }),
    });
  });

  it.each([
    {
      caseName: 'mes anteriormente populado agora vazio',
      rows: [
        {
          CODCOLIGADA: '1',
          CHAPA: '0003',
          FK_FUNCIONARIO: '1-0003',
          NOME: 'Funcionario 3',
          DT_MES: '2026-10-01',
          NROPERIODO: 20,
          'PFRATEIOFIXO.VALOR': '1',
          'TOTAL GERAL LINHA': '100',
        },
      ],
      currentAggregates: [
        {
          id: 'aggregate-september-1',
          employeeKey: '1-0001',
          competence: new Date('2026-09-01T00:00:00.000Z'),
          period: 20,
          sourceRows: 1,
          active: true,
        },
      ],
    },
    {
      caseName: 'queda parcial de chaves no mesmo mes',
      rows: [
        {
          CODCOLIGADA: '1',
          CHAPA: '0001',
          FK_FUNCIONARIO: '1-0001',
          NOME: 'Funcionario 1',
          DT_MES: '2026-09-01',
          NROPERIODO: 20,
          'PFRATEIOFIXO.VALOR': '1',
          'TOTAL GERAL LINHA': '100',
        },
      ],
      currentAggregates: [
        {
          id: 'aggregate-september-1',
          employeeKey: '1-0001',
          competence: new Date('2026-09-01T00:00:00.000Z'),
          period: 20,
          sourceRows: 1,
          active: true,
        },
        {
          id: 'aggregate-september-2',
          employeeKey: '1-0002',
          competence: new Date('2026-09-01T00:00:00.000Z'),
          period: 20,
          sourceRows: 1,
          active: true,
        },
      ],
    },
  ])('bloqueia $caseName sem alterar agregados', async ({ rows, currentAggregates }) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(rows)));
    const updateRun = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(data));
    const prisma = {
      totvsEmployeeSyncRun: {
        create: jest.fn().mockResolvedValue({ id: 'baseline-run' }),
        update: updateRun,
      },
      totvsEmployeeSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue(currentAggregates),
      },
      $transaction: jest.fn(),
    };
    const service = new TotvsEmployeeIntegrationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.refresh('admin-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'baseline-run' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorDetail: expect.stringContaining('Cobertura incompleta'),
      }),
    });
  });

  it('bloqueia reducao de linhas-fonte mesmo quando a chave continua presente', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            CODCOLIGADA: '1',
            CHAPA: '0001',
            FK_FUNCIONARIO: '1-0001',
            NOME: 'Funcionario 1',
            DT_MES: '2026-09-01',
            NROPERIODO: 20,
            'PFRATEIOFIXO.VALOR': '1',
            'TOTAL GERAL LINHA': '100',
          },
        ]),
      ),
    );
    const updateRun = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(data));
    const prisma = {
      totvsEmployeeSyncRun: {
        create: jest.fn().mockResolvedValue({ id: 'baseline-run' }),
        update: updateRun,
      },
      totvsEmployeeSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      totvsEmployeeCostAggregate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'aggregate-september-1',
            employeeKey: '1-0001',
            competence: new Date('2026-09-01T00:00:00.000Z'),
            period: 20,
            sourceRows: 2,
            active: true,
          },
        ]),
      },
      $transaction: jest.fn(),
    };
    const service = new TotvsEmployeeIntegrationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.refresh('admin-1')).rejects.toThrow(
      '1 com menos linhas',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
