import {
  AethosIntegrationService,
  normalizeContracts,
} from './aethos-integration.service';
import { Prisma } from '@prisma/client';

describe('AethosIntegrationService fiscal fields', () => {
  it('persists the canonical invoice fields without flattening observations', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ aethosPlanoContaCost: { upsert } }),
      ),
    };
    const service = new AethosIntegrationService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.syncPlanAccountCosts({
      custosPlanoConta: [
        {
          idLancamento: '123',
          codigoPlanoConta: '0010',
          competencia: '2026-07',
          dataLancamento: '2026-07-02',
          dataVencimento: '2026-08-02',
          valorCusto: 150.75,
          origem: 'VW_LST_CONTAS_PAGAR',
          temNotaFiscal: true,
          idNotaFiscal: '987',
          numeroNotaFiscal: '4567',
          dataEmissaoNotaFiscal: '2026-06-30',
          observacaoLancamento: 'Linha 1\nLinha 2',
          observacaoNotaFiscal: 'Observacao fiscal',
        },
      ],
    });

    expect(result).toEqual({ ok: true, received: 1, upserted: 1, skipped: 0 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          temNotaFiscal: true,
          idNotaFiscal: '987',
          numeroNotaFiscal: '4567',
          dataEmissaoNotaFiscal: new Date('2026-06-30T00:00:00.000Z'),
          observacaoLancamento: 'Linha 1\nLinha 2',
          observacaoNotaFiscal: 'Observacao fiscal',
        }),
        update: expect.objectContaining({
          temNotaFiscal: true,
          numeroNotaFiscal: '4567',
          observacaoLancamento: 'Linha 1\nLinha 2',
        }),
      }),
    );
  });
});

describe('AethosIntegrationService plan-account reparcelment reconciliation', () => {
  const reconciliationPayload = {
    reconciliationId: 'reparcelamento-2026-07-30',
    idLancamentosAgrupadores: ['814621', '999999'],
  };

  it('simulates the logical deactivation without changing data', async () => {
    const prisma = {
      aethosPlanoContaCostReconciliation: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aethosPlanoContaCost: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cost-parent',
            idLancamento: '814621',
            active: true,
            valorCusto: new Prisma.Decimal('85721.20'),
          },
        ]),
      },
      $transaction: jest.fn(),
    };
    const service = new AethosIntegrationService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.reconcilePlanAccountCostReparcelments(
      reconciliationPayload,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        executed: false,
        requestedCount: 2,
        foundCount: 1,
        wouldDeactivateCount: 1,
        notFoundCount: 1,
        totalWouldDeactivateValue: 85721.2,
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deactivates only matched active parent titles and records the audit', async () => {
    const costFindMany = jest.fn().mockResolvedValue([
      {
        id: 'cost-parent',
        idLancamento: '814621',
        active: true,
        valorCusto: new Prisma.Decimal('85721.20'),
      },
    ]);
    const costUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockImplementation(({ data }) => ({
      ...data,
      executedAt: new Date('2026-07-30T12:00:00.000Z'),
    }));
    const tx = {
      aethosPlanoContaCostReconciliation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: auditCreate,
      },
      aethosPlanoContaCost: {
        findMany: costFindMany,
        updateMany: costUpdateMany,
      },
    };
    const prisma = {
      aethosPlanoContaCostReconciliation: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new AethosIntegrationService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.reconcilePlanAccountCostReparcelments({
      ...reconciliationPayload,
      execute: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        executed: true,
        replayed: false,
        deactivatedCount: 1,
        totalDeactivatedValue: 85721.2,
      }),
    );
    expect(costUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['cost-parent'] }, active: true },
        data: expect.objectContaining({
          active: false,
          deactivationReason: 'RECEBERPAGAR_REPAR_DOC_ORIG_TITULO_PAI',
          reconciliationId: 'reparcelamento-2026-07-30',
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedCount: 2,
          foundCount: 1,
          deactivatedCount: 1,
          notFoundCount: 1,
        }),
      }),
    );
  });
});

describe('AethosIntegrationService contract sync', () => {
  const contractPayload = {
    idContratoAethos: 1992,
    idCotacaoAethos: 1760,
    idEmpresaAethos: 1,
    idObraAethos: 530,
    nomeObra: 'OBRA TESTE',
    idContratanteAethos: 8103,
    nomeContratante: 'CLIENTE TESTE',
    dataCadastro: '2026-07-20T17:11:12.583',
    dataInicio: '0202-11-06T00:00:00',
    dataFim: '2026-09-03T00:00:00',
    dataContratado: '2026-07-24T10:15:30.123',
    dataUltimaContratacao: '2026-07-25T11:16:31.456',
    usuarioContratacao: 'USUARIO.TESTE',
    valorOriginal: 2558,
    statusCodigo: 'P',
    statusDescricao: 'Aguardando aprovacao',
    observacao: 'Contrato de teste',
    anexosGerados: {
      recorteDetalhesDesde: '2026-06-01',
      contrato: {
        origemProcedimento: 'PROC_REL_OBRA_CONTRATO',
        origemItensDetalhados:
          'OBRA_CONTRATO_ITEM/OBRA_COTACAO_ITEM/OBRA_ORCAMENTO',
        itensDetalhados: [
          {
            idItem: 10,
            descricaoItem: 'SERVIÇO TESTE',
            quantidade: 2,
            unidadeMedida: 'UN',
            valorCustoUnitario: 100,
            valorTotal: 200,
          },
        ],
        itensResumo: [],
      },
      cotacao: {
        origemProcedimento: 'PROC_REL_OBRA_COTACAO',
        origemItensDetalhados: 'OBRA_COTACAO_ITEM/OBRA_ORCAMENTO',
        idCotacaoAethos: 1760,
        resumoOrcamentoCorrespondente: {
          quantidadeItensCotacao: 1,
          quantidadeItensVinculados: 1,
          quantidadeSemOrcamento: 0,
          quantidadeVinculosAmbiguos: 0,
          custoTotalOrcadoCorrespondente: 200,
          totalRealizadoCorrespondente: null,
        },
        itensDetalhados: [
          {
            nivel: '1.2.1',
            descricaoItem: 'SERVIÇO TESTE',
            vinculoOrcamento: {
              situacao: 'VINCULADO',
              idObraOrcamentoAethos: 901,
              idObraOrcamentoReferenciaAethos: 900,
            },
            orcamentoCorrespondente: {
              nivel: '1.2.1',
              custoTotalOrcado: 200,
            },
            composicaoOrcamento: [
              {
                nivel: '1.2.1.1',
                codigoItem: '1588',
                descricao: 'MÃO-DE-OBRA TERCEIRIZADA',
                quantidadeOrcada: 2,
                custoUnitarioOrcado: 100,
                custoTotalOrcado: 200,
              },
            ],
          },
        ],
      },
    },
    anexos: [
      {
        idAnexoAethos: 126307,
        idDocumentoAethos: 1992,
        tipoDocumentoAethos: 'OCT',
        nomeArquivo: 'contrato.pdf',
        extensao: 'PDF',
        md5: 'D41D8CD98F00B204E9800998ECF8427E',
        dataInclusao: '2026-07-20T16:41:38.347',
        formaArmazenamento: 'BLOB_FIREBIRD',
        referenciaOrigem: 'CONTRATO',
      },
    ],
  };

  it('normalizes canonical contract fields, attachments and invalid ancient dates', () => {
    const [contract] = normalizeContracts({ contratos: [contractPayload] });

    expect(contract).toEqual(
      expect.objectContaining({
        aethosId: '1992',
        companyAethosId: '1',
        workAethosId: '530',
        startDate: null,
        endDate: new Date('2026-09-03T00:00:00.000Z'),
        contractedAt: new Date('2026-07-24T10:15:30.123Z'),
        lastContractedAt: new Date('2026-07-25T11:16:31.456Z'),
        contractedByUser: 'USUARIO.TESTE',
        originalValue: expect.anything(),
        statusCode: 'P',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        generatedAttachments: expect.objectContaining({
          recorteDetalhesDesde: '2026-06-01',
          cotacao: expect.objectContaining({
            resumoOrcamentoCorrespondente: expect.objectContaining({
              quantidadeItensVinculados: 1,
            }),
            itensDetalhados: [
              expect.objectContaining({
                vinculoOrcamento: expect.objectContaining({
                  situacao: 'VINCULADO',
                }),
                composicaoOrcamento: [
                  expect.objectContaining({
                    codigoItem: '1588',
                    custoTotalOrcado: 200,
                  }),
                ],
              }),
            ],
          }),
        }),
      }),
    );
    expect(contract.attachments[0]).toEqual(
      expect.objectContaining({
        aethosId: '126307',
        documentAethosId: '1992',
        extension: 'PDF',
        md5: 'd41d8cd98f00b204e9800998ecf8427e',
      }),
    );
  });

  it('upserts contracts and attachment metadata and reports missing files', async () => {
    const contractUpsert = jest
      .fn()
      .mockResolvedValue({ id: 'contract-db-id' });
    const attachmentUpsert = jest.fn().mockResolvedValue(undefined);
    const attachmentFindUnique = jest.fn().mockResolvedValue(null);
    const attachmentUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const contractUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const filesNeeded = [
      { aethosId: '126307', md5: 'd41d8cd98f00b204e9800998ecf8427e' },
    ];
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: Record<string, unknown>) => unknown) =>
          callback({
            aethosContract: {
              upsert: contractUpsert,
              updateMany: contractUpdateMany,
            },
            aethosContractAttachment: {
              findUnique: attachmentFindUnique,
              upsert: attachmentUpsert,
              updateMany: attachmentUpdateMany,
            },
          }),
      ),
      aethosContractAttachment: {
        findMany: jest.fn().mockResolvedValue(filesNeeded),
      },
    };
    const storage = { deleteFile: jest.fn() };
    const service = new AethosIntegrationService(
      prisma as never,
      {} as never,
      storage as never,
    );

    const result = await service.syncContracts({
      contratos: [contractPayload],
      syncMode: 'full',
      syncRunId: 'contracts-2026-07-21T12:00:00Z',
      isLastBatch: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        received: 1,
        upserted: 1,
        attachmentsUpserted: 1,
        finalized: true,
        filesNeeded,
      }),
    );
    expect(contractUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { aethosId: '1992' },
        create: expect.objectContaining({
          workName: 'OBRA TESTE',
          generatedAttachments: expect.objectContaining({
            recorteDetalhesDesde: '2026-06-01',
          }),
          lastSeenSyncId: 'contracts-2026-07-21T12:00:00Z',
        }),
      }),
    );
    expect(attachmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { aethosId: '126307' } }),
    );
  });

  it('requires a run id before accepting a full synchronization', async () => {
    const service = new AethosIntegrationService(
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.syncContracts({
        contratos: [contractPayload],
        syncMode: 'full',
      }),
    ).rejects.toThrow('syncRunId e obrigatorio');
  });
});
