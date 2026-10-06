import { RncsService, validateRncInternalUnit } from './rncs.service';

describe('RNC internal item units', () => {
  it.each([
    ['Unidade', 'Unidade'],
    [' unidade ', 'Unidade'],
    ['UNIDADE', 'Unidade'],
    ['Verba', 'Verba'],
    [' verba\u200B ', 'Verba'],
  ])('normalizes %s to the canonical unit %s', (input, expected) => {
    expect(validateRncInternalUnit(input)).toBe(expected);
  });

  it('rejects unknown units', () => {
    expect(() => validateRncInternalUnit('Caixa inexistente')).toThrow(
      'Unidade de medida invalida',
    );
  });
});

describe('RncsService issuer changes before manager action', () => {
  const service = new RncsService({} as any, {} as any, {} as any, {} as any);
  const pendingRnc = {
    engineerId: 'issuer-1',
    status: 'PENDING_MANAGER_APPROVAL',
    reviewedAt: null,
    reviewedById: null,
    history: [{ action: 'CREATED' }],
  };

  it('allows the issuer while the manager has not acted', () => {
    expect(() =>
      (service as any).ensureIssuerCanChangeBeforeManagerAction(
        pendingRnc,
        'issuer-1',
      ),
    ).not.toThrow();
  });

  it('blocks a different user', () => {
    expect(() =>
      (service as any).ensureIssuerCanChangeBeforeManagerAction(
        pendingRnc,
        'another-user',
      ),
    ).toThrow('Somente o responsavel pode editar esta RNC');
  });

  it('blocks an investigation update even if the status remains pending', () => {
    expect(() =>
      (service as any).ensureIssuerCanChangeBeforeManagerAction(
        {
          ...pendingRnc,
          history: [{ action: 'INVESTIGATION_UPDATED' }],
        },
        'issuer-1',
      ),
    ).toThrow(
      'A RNC so pode ser editada antes da primeira acao do gestor',
    );
  });

  it('blocks every non-pending manager state', () => {
    expect(() =>
      (service as any).ensureIssuerCanChangeBeforeManagerAction(
        { ...pendingRnc, status: 'IN_PROGRESS' },
        'issuer-1',
      ),
    ).toThrow(
      'A RNC so pode ser editada antes da primeira acao do gestor',
    );
  });
});

describe('RncsService supervisor support profile', () => {
  const service = new RncsService({} as any, {} as any, {} as any, {} as any);

  it('accepts support as an RNC direction target just like a supervisor', () => {
    expect((service as any).canAnswerDirectedRnc('supervisor')).toBe(true);
    expect((service as any).canAnswerDirectedRnc('supervisor_apoio')).toBe(
      true,
    );
  });
});

describe('RncsService responsibility-only direction targets', () => {
  const service = new RncsService({} as any, {} as any, {} as any, {} as any);

  it.each(['ssma', 'ti', 'vendas', 'rh'])(
    'accepts %s as an RNC direction target',
    (role) => {
      expect((service as any).canAnswerDirectedRnc(role)).toBe(true);
    },
  );
});

describe('RncsService RNC oversight profiles', () => {
  it.each([
    'qualidade',
    'juridico',
    'almoxarifado',
    'licitacao',
    'usina_icara',
  ])('accepts %s as an RNC direction target', (role) => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);
    expect((service as any).canAnswerDirectedRnc(role)).toBe(true);
  });

  it.each([
    'qualidade',
    'juridico',
    'almoxarifado',
    'licitacao',
    'usina_icara',
  ])(
    'lists every RNC for %s without filtering by responsibility',
    async (role) => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new RncsService(
        { rnc: { findMany } } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await service.findAll(role, 'oversight-user-1');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    },
  );
});

describe('RncsService responsibility-only profile', () => {
  it.each(['financeiro', 'contabilidade', 'ssma', 'ti', 'vendas', 'rh'])(
    'lists RNCs tied to the authenticated %s user by internal authorship or responsibility',
    async (role) => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new RncsService(
        { rnc: { findMany } } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await service.findAll(role, 'responsible-user-1');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { engineerId: 'responsible-user-1', type: 'INTERNAL' },
              { responsibleUserId: 'responsible-user-1' },
              {
                correctiveActions: {
                  some: { responsibleUserId: 'responsible-user-1' },
                },
              },
              {
                assignments: {
                  some: { assignedToId: 'responsible-user-1' },
                },
              },
            ],
          },
        }),
      );
    },
  );

  it('allows accounting to open an RNC assigned to the authenticated user', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);

    expect(() =>
      (service as any).ensureCanRead(
        {
          type: 'INTERNAL',
          status: 'AWAITING_RESPONSIBLE_ACTION',
          engineerId: 'opening-user',
          responsibleUserId: 'another-user',
          colocarItemSistema: false,
          systemItemStatus: 'NOT_REQUIRED',
          assignments: [{ assignedToId: 'accounting-user-1' }],
        },
        'contabilidade',
        'accounting-user-1',
      ),
    ).not.toThrow();
  });
});

describe('RncsService engineering profile', () => {
  it.each(['engenharia', 'engenheiro'])(
    'lists every RNC for the %s role without filtering by creator',
    async (role) => {
      const findMany = jest.fn().mockResolvedValue([]);
      const service = new RncsService(
        { rnc: { findMany } } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await service.findAll(role, 'opening-user-1');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    },
  );

  it('allows engineering to open an RNC created by another user', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);

    expect(() =>
      (service as any).ensureCanRead(
        { engineerId: 'another-user' },
        'engenharia',
        'current-user',
      ),
    ).not.toThrow();
  });
});

describe('RncsService consultant internal RNC test access', () => {
  it('lists every internal RNC, including completed records', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new RncsService(
      { rnc: { findMany } } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.findAll('consultor', 'consultant-user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'INTERNAL' },
      }),
    );
  });

  it('allows a consultant to open completed internal RNCs only', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);
    const baseRnc = {
      status: 'COMPLETED',
      engineerId: 'another-user',
      responsibleUserId: 'another-user',
      colocarItemSistema: false,
      assignments: [],
    };

    expect(() =>
      (service as any).ensureCanRead(
        { ...baseRnc, type: 'INTERNAL' },
        'consultor',
        'consultant-user-1',
      ),
    ).not.toThrow();
    expect(() =>
      (service as any).ensureCanRead(
        { ...baseRnc, type: 'EXTERNAL' },
        'consultor',
        'consultant-user-1',
      ),
    ).toThrow('Sem permissao para acessar esta RNC');
  });

  it('allows a consultant to create internal RNCs but not external or work RNCs', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);

    expect(() =>
      (service as any).ensureCanCreateRnc('consultor', 'INTERNAL'),
    ).not.toThrow();
    expect(() =>
      (service as any).ensureCanCreateRnc('consultor', 'EXTERNAL'),
    ).toThrow('Sem permissao para criar este tipo de RNC');
    expect(() =>
      (service as any).ensureCanCreateRnc('consultor', 'WORK'),
    ).toThrow('Sem permissao para criar este tipo de RNC');
  });
});

describe('RncsService internal RNC work fields', () => {
  it('accepts an internal RNC without immediate reaction data', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);

    const data = (service as any).buildNewInternalInitialData({
      type: 'INTERNAL',
      ncArea: 'Qualidade',
      issuer: 'Emitente',
      destinationSector: 'Setor',
      responsibleUserId: 'responsible-user-1',
      nonConformityDescription: 'Descricao',
    });

    expect(data.immediateReaction).toBeNull();
    expect(data.immediateResponsible).toBeNull();
    expect(data.immediateDate).toBeNull();
  });

  it('ignores work code and description for internal RNCs', () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);

    const data = (service as any).buildNewInternalInitialData({
      type: 'INTERNAL',
      obra: '445',
      obraDescricao: 'Obra que nao deve ser vinculada',
      ncArea: 'Qualidade',
      issuer: 'Emitente',
      destinationSector: 'Setor',
      responsibleUserId: 'responsible-user-1',
      nonConformityDescription: 'Descricao',
      immediateReaction: 'Reacao',
      immediateResponsible: 'Responsavel',
      immediateDate: '2026-07-23',
    });

    expect(data.obra).toBe('Interna');
    expect(data.obraDescricao).toBeNull();
    expect(data.status).toBe('AWAITING_RESPONSIBLE_ACTION');
  });

  it('creates an internal RNC for the selected responsible without manager review', async () => {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        id: 'rnc-internal-1',
        number: 56,
        engineerId: 'engineer-1',
        responsibleUser: {
          id: 'responsible-user-1',
          name: 'Responsavel',
          email: 'responsavel@jr.com',
          role: 'administrativo',
        },
        engineer: null,
        reviewedBy: null,
        effectivenessReviewedBy: null,
        systemItemIncludedBy: null,
        items: [],
        history: [],
        assignments: [],
        attachments: [],
        correctiveActions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const notifyUsers = jest.fn().mockResolvedValue(undefined);
    const notifyRoles = jest.fn().mockResolvedValue(undefined);
    const findMany = jest.fn();
    const service = new RncsService(
      { rnc: { create }, user: { findMany } } as any,
      { notifyUsers, notifyRoles } as any,
      { sendMail: jest.fn() } as any,
      {} as any,
    );

    const result = await service.create(
      {
        type: 'INTERNAL',
        obra: 'Interna',
        ncArea: 'Qualidade',
        issuer: 'Emitente',
        destinationSector: 'Setor',
        responsibleUserId: 'responsible-user-1',
        nonConformityDescription: 'Descricao',
        immediateReaction: 'Reacao',
        immediateResponsible: 'Responsavel',
        immediateDate: '2026-07-23',
      },
      'engineer-1',
      'engenharia',
    );

    expect(result.status).toBe('AWAITING_RESPONSIBLE_ACTION');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'AWAITING_RESPONSIBLE_ACTION',
          history: {
            create: expect.objectContaining({
              note: 'RNC enviada diretamente ao responsavel pelo tratamento',
            }),
          },
        }),
      }),
    );
    expect(notifyUsers).toHaveBeenCalledWith(
      ['responsible-user-1'],
      expect.objectContaining({ title: 'RNC Interna para tratamento' }),
    );
    expect(notifyRoles).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('RncsService corrective action execution evidence', () => {
  const currentRnc = (evidence: any[] = []) => ({
    id: 'rnc-internal-1',
    number: 77,
    type: 'INTERNAL',
    status: 'RESPONSIBLE_ACTION_COMPLETED',
    engineerId: 'issuer-1',
    engineer: null,
    reviewedById: null,
    reviewedBy: null,
    responsibleUserId: 'responsible-1',
    responsibleUser: null,
    effectivenessReviewedBy: null,
    systemItemIncludedBy: null,
    valorRetidoInicial: 0,
    valorRetido: 0,
    colocarItemSistema: false,
    items: [],
    history: [],
    assignments: [],
    attachments: [],
    correctiveActions: [
      {
        id: 'action-1',
        rncId: 'rnc-internal-1',
        description: 'Executar treinamento da equipe',
        responsible: 'Responsavel teste',
        responsibleUserId: 'responsible-1',
        dueDate: new Date('2026-08-20T12:00:00.000Z'),
        situation: 'Em andamento',
        executionNotes: null,
        completedAt: null,
        completedById: null,
        completedBy: null,
        evidence,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('requires at least one evidence before concluding the action', async () => {
    const service = new RncsService({} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service as any, 'getRnc').mockResolvedValue(currentRnc());

    await expect(
      service.completeCorrectiveAction(
        'rnc-internal-1',
        'action-1',
        { executionNotes: 'Treinamento realizado com toda a equipe.' },
        'actor-1',
        'consultor',
      ),
    ).rejects.toThrow(
      'Anexe pelo menos uma evidencia antes de concluir a acao',
    );
  });

  it('records notes, author and completion date when evidence exists', async () => {
    const update = jest.fn().mockResolvedValue({});
    const createHistory = jest.fn().mockResolvedValue({});
    const transaction = jest.fn().mockResolvedValue([]);
    const notifyUsers = jest.fn().mockResolvedValue(undefined);
    const rnc = currentRnc([
      {
        id: 'evidence-1',
        uploadedById: 'actor-1',
        fileName: 'evidencia.jpg',
      },
    ]);
    const service = new RncsService(
      {
        rncCorrectiveAction: { update },
        rncHistory: { create: createHistory },
        $transaction: transaction,
      } as any,
      { notifyUsers } as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'getRnc')
      .mockResolvedValueOnce(rnc)
      .mockResolvedValueOnce({
        ...rnc,
        correctiveActions: rnc.correctiveActions.map((action) => ({
          ...action,
          situation: 'Concluida',
          executionNotes: 'Treinamento realizado com toda a equipe.',
        })),
      });

    await service.completeCorrectiveAction(
      'rnc-internal-1',
      'action-1',
      { executionNotes: ' Treinamento realizado com toda a equipe. ' },
      'actor-1',
      'consultor',
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'action-1' },
      data: expect.objectContaining({
        situation: 'Concluida',
        executionNotes: 'Treinamento realizado com toda a equipe.',
        completedById: 'actor-1',
        completedAt: expect.any(Date),
      }),
    });
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rncId: 'rnc-internal-1',
        actorId: 'actor-1',
        action: 'CORRECTIVE_ACTION_COMPLETED',
      }),
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      ['issuer-1'],
      expect.objectContaining({
        title: 'RNC Interna pronta para avaliacao de eficacia',
      }),
    );
  });

  it('allows editing an open action while the plan is running', async () => {
    const update = jest.fn().mockResolvedValue({});
    const createHistory = jest.fn().mockResolvedValue({});
    const transaction = jest.fn().mockResolvedValue([]);
    const notifyUsers = jest.fn().mockResolvedValue(undefined);
    const rnc = currentRnc();
    const updatedRnc = {
      ...rnc,
      correctiveActions: rnc.correctiveActions.map((action) => ({
        ...action,
        responsible: 'Novo responsavel',
        situation: 'Em andamento',
      })),
    };
    const service = new RncsService(
      {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'responsible-1',
            name: 'Novo responsavel',
            email: 'responsavel@jr.com',
            role: 'administrativo',
          }),
        },
        rncCorrectiveAction: { update },
        rncHistory: { create: createHistory },
        $transaction: transaction,
      } as any,
      { notifyUsers } as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'getRnc')
      .mockResolvedValueOnce(rnc)
      .mockResolvedValueOnce(updatedRnc);

    await service.updateCorrectiveAction(
      'rnc-internal-1',
      'action-1',
      {
        description: ' Treinar a equipe e registrar a ata ',
        responsibleUserId: 'responsible-1',
        dueDate: '2026-08-25',
        situation: 'Em andamento',
      },
      'actor-1',
      'consultor',
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'action-1' },
      data: {
        description: 'Treinar a equipe e registrar a ata',
        responsible: 'Novo responsavel',
        responsibleUserId: 'responsible-1',
        dueDate: expect.any(Date),
        situation: 'Em andamento',
      },
    });
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rncId: 'rnc-internal-1',
        actorId: 'actor-1',
        action: 'UPDATED_PROGRESS',
      }),
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});
