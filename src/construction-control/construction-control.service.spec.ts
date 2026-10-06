import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConstructionControlService } from './construction-control.service';

describe('ConstructionControlService limited cadastral access', () => {
  const currentState = {
    activeWorkId: 'obra-1',
    works: [
      {
        id: 'obra-1',
        nome: 'OBRA TESTE',
        cliente: 'CLIENTE PRESERVADO',
        cno: 'CNO PRESERVADA',
        cnoBaixada: 'Nao',
        termoDefinitivoFinalizado: 'Nao',
        statusObra: 'Em andamento',
      },
    ],
    stages: [],
    measurements: [],
    additives: [],
    arts: [],
    quality: [],
    requirements: [],
    production: [],
    audit: [],
  };

  it.each(['administrativo', 'juridico'])(
    'allows %s to update only the three limited fields',
    async (role) => {
      const update = jest.fn().mockImplementation(({ data }) => ({
        data: data.data,
      }));
      const service = new ConstructionControlService({
        constructionControlState: {
          findUnique: jest.fn().mockResolvedValue({ data: currentState }),
          update,
        },
      } as any);

      const result = (await service.updateLimitedCadastralFields(
        'obra-1',
        {
          cnoBaixada: 'Sim',
          termoDefinitivoFinalizado: 'Sim',
          statusObra: 'Entregue',
          cliente: 'NAO DEVE ALTERAR',
        },
        role,
        'Usuario Teste',
      )) as any;

      expect(result.works[0]).toMatchObject({
        cliente: 'CLIENTE PRESERVADO',
        cno: 'CNO PRESERVADA',
        cnoBaixada: 'Sim',
        termoDefinitivoFinalizado: 'Sim',
        statusObra: 'Entregue',
      });
      expect(result.audit).toHaveLength(3);
    },
  );

  it('does not grant Juridico access to the complete state write endpoint', async () => {
    const service = new ConstructionControlService({} as any);

    await expect(service.saveState(currentState, 'juridico')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks CNO closure while the work is not delivered', async () => {
    const service = new ConstructionControlService({} as any);

    await expect(
      service.updateLimitedCadastralFields(
        'obra-1',
        {
          cnoBaixada: 'Sim',
          termoDefinitivoFinalizado: 'Sim',
          statusObra: 'Em andamento',
        },
        'juridico',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows Maria Eduarda to release a work schedule', async () => {
    const update = jest.fn().mockImplementation(({ data }) => ({
      data: data.data,
    }));
    const service = new ConstructionControlService({
      constructionControlState: {
        findUnique: jest.fn().mockResolvedValue({ data: currentState }),
        update,
      },
    } as any);

    const result = (await service.releaseSchedule(
      'obra-1',
      'administrativo',
      'Maria Eduarda',
    )) as any;

    expect(result.scheduleControls[0]).toMatchObject({
      workId: 'obra-1',
      status: 'RELEASED',
      releasedBy: 'Maria Eduarda',
    });
  });

  it('blocks schedule release by another administrative user', async () => {
    const service = new ConstructionControlService({} as any);

    await expect(
      service.releaseSchedule('obra-1', 'administrativo', 'Outra Pessoa'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires a reason and snapshots the previous schedule when Engineering reopens it', async () => {
    const releasedState = {
      ...currentState,
      stages: [
        {
          id: 'etapa-1',
          workId: 'obra-1',
          descricao: 'DRENAGEM',
          valorTotal: 1000,
          possui: 'Sim',
          dataInicio: '2026-07-01',
          dataFim: '2026-07-31',
          mesesMedicao: [],
          metasMedicao: [],
        },
      ],
      scheduleControls: [
        {
          workId: 'obra-1',
          status: 'RELEASED',
          releasedAt: '2026-07-22T12:00:00.000Z',
          releasedBy: 'Maria Eduarda',
        },
      ],
      scheduleVersions: [],
    };
    const update = jest.fn().mockImplementation(({ data }) => ({
      data: data.data,
    }));
    const service = new ConstructionControlService({
      constructionControlState: {
        findUnique: jest.fn().mockResolvedValue({ data: releasedState }),
        update,
      },
    } as any);

    await expect(
      service.reopenSchedule('obra-1', '', 'engenharia', 'Engenheiro Teste'),
    ).rejects.toThrow(BadRequestException);

    const result = (await service.reopenSchedule(
      'obra-1',
      'Reprogramacao solicitada pelo cliente',
      'engenharia',
      'Engenheiro Teste',
    )) as any;

    expect(result.scheduleControls[0]).toMatchObject({
      workId: 'obra-1',
      status: 'OPEN',
      reopenedBy: 'Engenheiro Teste',
    });
    expect(result.scheduleVersions[0]).toMatchObject({
      workId: 'obra-1',
      version: 1,
      reason: 'Reprogramacao solicitada pelo cliente',
      createdBy: 'Engenheiro Teste',
    });
    expect(result.scheduleVersions[0].stages).toHaveLength(1);
  });

  it('blocks Engineering from changing a locked schedule through the complete state endpoint', async () => {
    const service = new ConstructionControlService({
      constructionControlState: {
        findUnique: jest.fn().mockResolvedValue({
          data: {
            ...currentState,
            stages: [
              {
                id: 'etapa-1',
                workId: 'obra-1',
                descricao: 'DRENAGEM',
                valorTotal: 1000,
                possui: 'Sim',
                mesesMedicao: [],
                metasMedicao: [],
              },
            ],
            scheduleControls: [],
            scheduleVersions: [],
          },
        }),
      },
    } as any);

    await expect(
      service.saveState(
        {
          ...currentState,
          stages: [
            {
              id: 'etapa-1',
              workId: 'obra-1',
              descricao: 'DRENAGEM ALTERADA',
              valorTotal: 1000,
              possui: 'Sim',
              mesesMedicao: [],
              metasMedicao: [],
            },
          ],
        },
        'engenharia',
        'Engenheiro Teste',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
