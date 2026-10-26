import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  businessDaysBetween,
  ContractsService,
  ensureContractReadAccess,
  ensureContractWriteAccess,
  workflowTemplate,
  mapContractWorkflow,
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
    approvedAt: new Date('2026-07-21T09:00:00.000Z'),
    approvalCycleContractedAt: null,
    approvalCycleSourceId: 'history-1992',
    approvalCycleHistoryComplete: true,
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
  describe('official approval cycle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-27T12:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('ages only the first pending stage of approval, starting after registration', () => {
      const workflow = mapContractWorkflow(contractRecord());
      expect(workflow.totalElapsedBusinessDays).toBe(4);
      expect(workflow.stages[1]).toMatchObject({
        elapsedDays: 4,
        isCurrent: true,
      });
      expect(
        workflow.stages.slice(2).every((stage) => stage.elapsedDays === null),
      ).toBe(true);
    });

    it.each(['O', 'F'])(
      'closes %s at the official same-cycle hiring while keeping missing dates visible',
      (statusCode) => {
        const workflow = mapContractWorkflow({
          ...contractRecord(),
          statusCode,
          approvalCycleContractedAt: new Date('2026-07-24T15:00:00Z'),
          lastContractedAt: new Date('2026-07-27T11:00:00Z'),
          workflow: { type: 'SERVICO', status: 'IN_PROGRESS', stages: [] },
        });
        expect(workflow).toMatchObject({
          status: 'COMPLETED',
          operationallyActive: false,
          totalElapsedBusinessDays: 3,
          dataEntryComplete: false,
          missingStageCount: 5,
        });
        expect(
          workflow.stages
            .slice(1, -1)
            .every(
              (stage) => stage.elapsedDays === null && stage.requiresDataEntry,
            ),
        ).toBe(true);
        expect(workflow.stages.at(-1)).toMatchObject({
          elapsedDays: null,
          intervalComplete: false,
        });
      },
    );

    it.each(['A', 'C'])(
      'excludes %s from indicators even if old dates exist',
      (statusCode) => {
        const workflow = mapContractWorkflow({
          ...contractRecord(),
          statusCode,
        });
        expect(workflow).toMatchObject({
          eligibleForIndicators: false,
          operationallyActive: false,
          totalElapsedBusinessDays: null,
          approvedAt: null,
        });
        expect(
          workflow.stages.every((stage) => stage.elapsedDays === null),
        ).toBe(true);
      },
    );

    it('does not infer approval from registration, synchronization or legacy hiring', () => {
      const workflow = mapContractWorkflow({
        ...contractRecord(),
        statusCode: 'F',
        approvedAt: null,
        approvalCycleHistoryComplete: true,
        contractedAt: new Date('2026-07-24T15:00:00Z'),
      });
      expect(workflow.totalElapsedBusinessDays).toBeNull();
      expect(workflow.stages.every((stage) => stage.elapsedDays === null)).toBe(
        true,
      );
    });

    it('ignores dates from a previous cycle and keeps notice time separate', () => {
      const workflow = mapContractWorkflow({
        ...contractRecord(),
        startDate: new Date('2026-08-05T00:00:00Z'),
        workflow: {
          type: 'EMPREITEIRO',
          stages: [
            {
              key: 'CONFERENCIA_ADMINISTRATIVO',
              completedAt: new Date('2026-07-20T12:00:00Z'),
            },
          ],
        },
      });
      expect(workflow.stages[1]).toMatchObject({
        completedAt: null,
        elapsedDays: 4,
      });
      expect(workflow.requestNotice).toMatchObject({
        elapsedCalendarDays: 16,
        targetCalendarDays: 15,
      });
      expect(workflow.totalElapsedBusinessDays).toBe(4);
    });

    it('uses adjacent complete stages for duration, never spans a missing intermediate date', () => {
      const workflow = mapContractWorkflow({
        ...contractRecord(),
        statusCode: 'O',
        approvalCycleContractedAt: new Date('2026-07-24T15:00:00Z'),
        workflow: {
          type: 'SERVICO',
          stages: [
            {
              key: 'CONFERENCIA_ADMINISTRATIVO',
              completedAt: new Date('2026-07-22T12:00:00Z'),
            },
            {
              key: 'ASSINATURA_FORNECEDOR',
              completedAt: new Date('2026-07-24T12:00:00Z'),
            },
          ],
        },
      });
      expect(workflow.stages[1]).toMatchObject({
        elapsedDays: 1,
        intervalComplete: true,
      });
      expect(workflow.stages[3]).toMatchObject({
        elapsedDays: null,
        intervalComplete: false,
      });
    });
  });
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

  it('requires explicit workflow classification even when an account plan is present', async () => {
    const prisma = {
      aethosContract: {
        findFirst: jest.fn().mockResolvedValue({
          ...contractRecord(),
          accountPlanAethosId: '750',
          workflow: null,
        }),
      },
    };
    const service = new ContractsService(prisma as never);

    await expect(
      service.updateWorkflow(
        'contract-db-id',
        { status: 'IN_PROGRESS', stages: [] },
        'administrativo',
      ),
    ).rejects.toThrow('Classifique o contrato antes de preencher o fluxo');
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
        targetDays: 1,
        targetUnit: 'BUSINESS_DAYS',
      }),
      expect.objectContaining({
        key: 'CONTRATO_LIBERADO',
        targetDays: null,
      }),
    ]);

    expect(workflowTemplate('EMPREITEIRO')).toEqual([
      expect.objectContaining({
        key: 'SOLICITACAO_ENGENHEIRO',
        targetDays: 0,
        targetUnit: 'BUSINESS_DAYS',
        targetComparison: 'MAX',
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
            statusCode: 'O',
            approvalCycleContractedAt: new Date('2026-07-24T10:15:30.123Z'),
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
        label: 'Entrada em aprovacao',
        completedAt: '2026-07-21T09:00:00.000Z',
        performanceStatus: 'ON_TIME',
      }),
    );
  });

  it('filters contractor and service contracts by their explicit workflow classification', async () => {
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
              workflow: { is: { type: 'EMPREITEIRO' } },
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
              workflow: { is: { type: 'SERVICO' } },
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
          completedAt: new Date('2026-07-21T09:00:00.000Z'),
        }),
        update: expect.objectContaining({
          targetDays: 0,
          targetUnit: 'BUSINESS_DAYS',
          targetComparison: 'MAX',
          completedAt: new Date('2026-07-21T09:00:00.000Z'),
        }),
      }),
    );
    expect(result.workflow).toEqual(
      expect.objectContaining({ type: 'SERVICO', totalStages: 7 }),
    );
  });

  it('saves an incomplete hired workflow without reopening it or erasing hidden previous-cycle dates', async () => {
    const oldDate = new Date('2026-07-20T12:00:00Z');
    const contract = {
      ...contractRecord(),
      statusCode: 'O',
      approvalCycleContractedAt: new Date('2026-07-24T15:00:00Z'),
      workflow: {
        id: 'workflow-1',
        type: 'SERVICO',
        status: 'IN_PROGRESS',
        stages: [{ key: 'CONFERENCIA_ADMINISTRATIVO', completedAt: oldDate }],
      },
    };
    const stageUpsert = jest.fn().mockResolvedValue({});
    const workflowUpsert = jest.fn().mockResolvedValue({ id: 'workflow-1' });
    const tx = {
      contractWorkflow: { upsert: workflowUpsert },
      contractWorkflowStage: { upsert: stageUpsert, deleteMany: jest.fn() },
    };
    const prisma = {
      aethosContract: { findFirst: jest.fn().mockResolvedValue(contract) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    await new ContractsService(prisma as never).updateWorkflow(
      'contract-db-id',
      {
        type: 'SERVICO',
        status: 'IN_PROGRESS',
        notes: 'Conferir datas pendentes',
        stages: [],
      },
      'admin',
    );
    expect(workflowUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'COMPLETED',
          outcomeAt: contract.approvalCycleContractedAt,
        }),
      }),
    );
    expect(stageUpsert.mock.calls[1][0].update.completedAt).toEqual(oldDate);
  });
});
