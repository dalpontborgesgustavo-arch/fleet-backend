import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  businessDaysBetween,
  ContractsService,
  detectContractWorkflowType,
  ensureContractReadAccess,
  ensureContractWriteAccess,
  workflowTemplate,
} from './contracts.service';

function contractRecord() {
  return {
    id: 'contract-db-id',
    aethosId: '1992',
    quotationAethosId: '1760',
    companyAethosId: '1',
    workAethosId: '530',
    workName: 'OBRA TESTE',
    contractorAethosId: '8103',
    contractorName: 'CLIENTE TESTE',
    registeredAt: new Date('2026-07-20T17:11:12.583Z'),
    startDate: null,
    endDate: null,
    finalizedAt: null,
    contractedAt: null,
    lastContractedAt: null,
    contractedByUser: null,
    originalValue: new Prisma.Decimal('2558.00'),
    statusCode: 'P',
    statusDescription: 'Aguardando aprovacao',
    notes: null,
    engineerAethosId: null,
    engineerName: null,
    retentionValue: new Prisma.Decimal(0),
    anticipatedRetentionValue: new Prisma.Decimal(0),
    retentionBalance: new Prisma.Decimal(0),
    totalMeasuredValue: new Prisma.Decimal(0),
    payableBalance: new Prisma.Decimal('2558.00'),
    measurementBalance: new Prisma.Decimal(0),
    contractBalance: new Prisma.Decimal('2558.00'),
    contractQuantity: null,
    movesFinancial: false,
    returnsWorkBalance: false,
    accountPlanAethosId: null,
    accountPlanName: null,
    cancellationReason: null,
    generatedAttachments: {
      recorteDetalhesDesde: '2026-06-01',
      contrato: { itensDetalhados: [], itensResumo: [] },
      cotacao: { itensDetalhados: [] },
    },
    syncedAt: new Date('2026-07-21T13:00:00.000Z'),
    _count: { attachments: 1 },
  };
}

describe('ContractsService', () => {
  it('restricts access to the same profiles that consult construction works', () => {
    expect(() => ensureContractReadAccess('juridico')).not.toThrow();
    expect(() => ensureContractReadAccess('engenharia')).toThrow(
      ForbiddenException,
    );
    expect(() => ensureContractReadAccess('consultor')).toThrow(
      ForbiddenException,
    );
    expect(() => ensureContractReadAccess('supervisor')).toThrow(
      ForbiddenException,
    );
  });

  it('allows only Administrativo and Admin to fill workflow dates', () => {
    expect(() => ensureContractWriteAccess('administrativo')).not.toThrow();
    expect(() => ensureContractWriteAccess('admin')).not.toThrow();
    expect(() => ensureContractWriteAccess('juridico')).toThrow(
      ForbiddenException,
    );
    expect(() => ensureContractWriteAccess('gestor')).toThrow(
      ForbiddenException,
    );
  });

  it('classifies contractor contracts from the official account plan rule', () => {
    expect(detectContractWorkflowType({ accountPlanAethosId: '750' })).toBe(
      'EMPREITEIRO',
    );
    expect(
      detectContractWorkflowType({ accountPlanName: 'CUSTO EMPREITEIROS' }),
    ).toBe('EMPREITEIRO');
    expect(
      detectContractWorkflowType({ accountPlanName: 'PRESTACAO DE SERVICOS' }),
    ).toBe('SERVICO');
  });

  it('uses the official seven-stage service flow and eight-stage contractor flow', () => {
    expect(workflowTemplate('SERVICO')).toEqual([
      expect.objectContaining({
        key: 'SOLICITACAO',
        targetDays: 0,
        targetUnit: 'BUSINESS_DAYS',
      }),
      expect.objectContaining({
        key: 'CONFERENCIA_ADMINISTRATIVO',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'ELABORACAO_JURIDICO',
        targetDays: 3,
      }),
      expect.objectContaining({
        key: 'ASSINATURA_FORNECEDOR',
        targetDays: 2,
      }),
      expect.objectContaining({
        key: 'APROVACAO_DIRETORA_ADMINISTRATIVA',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'DISPONIBILIZACAO_JURIDICO',
        targetDays: null,
      }),
      expect.objectContaining({
        key: 'CONTRATO_LIBERADO',
        targetDays: null,
      }),
    ]);

    expect(workflowTemplate('EMPREITEIRO')).toEqual([
      expect.objectContaining({
        key: 'SOLICITACAO_ENGENHEIRO',
        targetDays: 15,
        targetUnit: 'CALENDAR_DAYS',
        targetComparison: 'MIN',
      }),
      expect.objectContaining({
        key: 'CONFERENCIA_ADMINISTRATIVO',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'APROVACAO_DIRETOR_OPERACOES',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'ENCAMINHAMENTO_JURIDICO',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'VALIDACAO_JURIDICO',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'ASSINATURA_EMPREITEIRO',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'LIBERACAO_GERENTE_ADMINISTRATIVA',
        targetDays: 1,
      }),
      expect.objectContaining({
        key: 'CONTRATO_LIBERADO',
        targetDays: null,
      }),
    ]);
  });

  it('measures business days excluding weekends', () => {
    expect(
      businessDaysBetween(
        new Date('2026-07-17T12:00:00.000Z'),
        new Date('2026-07-20T12:00:00.000Z'),
      ),
    ).toBe(1);
    expect(
      businessDaysBetween(
        new Date('2026-07-20T12:00:00.000Z'),
        new Date('2026-07-22T12:00:00.000Z'),
      ),
    ).toBe(2);
  });

  it('uses the official contracted date in the final workflow stage', async () => {
    const prisma = {
      aethosContract: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...contractRecord(),
            contractedAt: new Date('2026-07-24T10:15:30.123Z'),
            lastContractedAt: new Date('2026-07-25T11:16:31.456Z'),
            contractedByUser: 'USUARIO.TESTE',
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            originalValue: new Prisma.Decimal('2558.00'),
            totalMeasuredValue: new Prisma.Decimal(0),
            contractBalance: new Prisma.Decimal('2558.00'),
          },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({
          syncedAt: new Date('2026-07-28T11:43:00.662Z'),
        }),
      },
    };
    const service = new ContractsService(prisma as never);

    const result = await service.findAll({ page: '1' }, 'admin');
    const finalStage = result.items[0].workflow.stages.at(-1);

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        contractedAt: '2026-07-24T10:15:30.123Z',
        lastContractedAt: '2026-07-25T11:16:31.456Z',
        contractedByUser: 'USUARIO.TESTE',
      }),
    );
    expect(finalStage).toEqual(
      expect.objectContaining({
        key: 'CONTRATO_LIBERADO',
        completedAt: '2026-07-24T10:15:30.123Z',
        performanceStatus: 'COMPLETED',
      }),
    );
  });

  it('returns paginated contracts and numeric summary values', async () => {
    const prisma = {
      aethosContract: {
        findMany: jest.fn().mockResolvedValue([contractRecord()]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            originalValue: new Prisma.Decimal('2558.00'),
            totalMeasuredValue: new Prisma.Decimal(0),
            contractBalance: new Prisma.Decimal('2558.00'),
          },
        }),
        groupBy: jest.fn().mockResolvedValue([
          {
            statusCode: 'P',
            statusDescription: 'Aguardando aprovacao',
            _count: { _all: 1 },
            _sum: { originalValue: new Prisma.Decimal('2558.00') },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          syncedAt: new Date('2026-07-21T13:00:00.000Z'),
        }),
      },
    };
    const service = new ContractsService(prisma as never);

    const result = await service.findAll(
      { page: '1', search: 'obra' },
      'gestor',
    );

    expect(result.summary).toEqual(
      expect.objectContaining({
        total: 1,
        originalValue: 2558,
        balanceValue: 2558,
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        aethosId: '1992',
        companyName: 'JR Construções',
        originalValue: 2558,
        attachmentCount: 1,
      }),
    );
    expect(result.items[0].workflow.stages[0]).toEqual(
      expect.objectContaining({
        label: 'Solicitacao do contrato',
        completedAt: '2026-07-20T17:11:12.583Z',
        performanceStatus: 'ON_TIME',
      }),
    );
  });

  it('filters contractor and service contracts by account plan', async () => {
    const prisma = {
      aethosContract: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            originalValue: null,
            totalMeasuredValue: null,
            contractBalance: null,
          },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ContractsService(prisma as never);

    await service.findAll({ contractType: 'empreiteiro' }, 'admin');
    expect(prisma.aethosContract.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([{ accountPlanAethosId: '750' }]),
            }),
          ]),
        }),
      }),
    );

    await service.findAll({ contractType: 'servico' }, 'admin');
    expect(prisma.aethosContract.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              accountPlanName: { not: null },
              NOT: expect.any(Object),
            }),
          ]),
        }),
      }),
    );

    await expect(
      service.findAll({ contractType: 'invalido' }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns not found for an unavailable contract', async () => {
    const prisma = {
      aethosContract: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ContractsService(prisma as never);

    await expect(service.findOne('missing', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('persists the service workflow template for Administrativo', async () => {
    const base = { ...contractRecord(), workflow: null };
    const saved = {
      ...contractRecord(),
      attachments: [],
      workflow: {
        id: 'workflow-1',
        type: 'SERVICO',
        status: 'IN_PROGRESS',
        outcomeAt: null,
        cancellationReason: null,
        notes: null,
        updatedById: 'admin-user',
        updatedByName: 'Administrativo',
        updatedAt: new Date('2026-07-21T18:00:00.000Z'),
        stages: [],
      },
    };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(saved);
    const stageUpsert = jest.fn().mockResolvedValue({});
    const transactionClient = {
      contractWorkflow: {
        upsert: jest.fn().mockResolvedValue({ id: 'workflow-1' }),
      },
      contractWorkflowStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: stageUpsert,
      },
    };
    const prisma = {
      aethosContract: { findFirst },
      $transaction: jest.fn((callback) => callback(transactionClient)),
    };
    const service = new ContractsService(prisma as never);

    const result = await service.updateWorkflow(
      'contract-db-id',
      {
        type: 'SERVICO',
        status: 'IN_PROGRESS',
        stages: [],
      },
      'administrativo',
      { id: 'admin-user', name: 'Administrativo' },
    );

    expect(stageUpsert).toHaveBeenCalledTimes(7);
    expect(stageUpsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        create: expect.objectContaining({
          completedAt: new Date('2026-07-20T17:11:12.583Z'),
        }),
        update: expect.objectContaining({
          targetDays: 0,
          targetUnit: 'BUSINESS_DAYS',
          targetComparison: 'MAX',
          completedAt: new Date('2026-07-20T17:11:12.583Z'),
        }),
      }),
    );
    expect(result.workflow).toEqual(
      expect.objectContaining({ type: 'SERVICO', totalStages: 7 }),
    );
  });
});
