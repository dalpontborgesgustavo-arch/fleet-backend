import { BadRequestException } from '@nestjs/common';
import { AethosIntegrationService } from './aethos-integration.service';

describe('Aethos plan-account status snapshot', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T15:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  function makeService(
    existing: { idSubnivel: string; nome: string; ativo: boolean }[] = [],
    lastEvents: { idSubnivel: string; effectiveAt: Date }[] = [],
  ) {
    const createAccount = jest.fn().mockResolvedValue({ count: 1 });
    const updateAccount = jest.fn().mockResolvedValue({});
    const createEvent = jest.fn().mockResolvedValue({ count: 1 });
    const findLastEvent = jest.fn().mockResolvedValue(lastEvents);
    const tx = {
      aethosPlanoConta: { createMany: createAccount, update: updateAccount },
      aethosPlanoContaStatusEvent: {
        createMany: createEvent,
        findMany: findLastEvent,
      },
    };
    const prisma = {
      aethosPlanoConta: {
        findMany: jest.fn().mockResolvedValue(existing),
        count: jest.fn().mockResolvedValue(existing.length),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    return {
      service: new AethosIntegrationService(
        prisma as never,
        {} as never,
        {} as never,
      ),
      createAccount,
      updateAccount,
      createEvent,
      findLastEvent,
    };
  }

  it('records first observation for an inactive plan without proven S-to-N history', async () => {
    const { service, createAccount, createEvent } = makeService();
    const result = await service.syncPlanAccounts({
      totalPlanos: 1,
      planosConta: [{ id: 267, nome: 'Plano inativo', ativo: false }],
    });
    expect(result).toEqual({ ok: true, received: 1, upserted: 1, changed: 0 });
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ idSubnivel: '267', ativo: false })],
      }),
    );
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            idSubnivel: '267',
            ativo: false,
            effectiveAt: new Date('2026-11-10T00:00:00.000Z'),
            source: 'SYNC_OBSERVED',
          }),
        ],
      }),
    );
  });

  it('uses proven historical date, but never backdates across a later event', async () => {
    const initial = makeService();
    await initial.service.syncPlanAccounts({
      totalPlanos: 1,
      planosConta: [
        {
          id: 267,
          nome: 'Plano inativo',
          ativo: false,
          dataInativacao: '2026-10-20',
        },
      ],
    });
    expect(initial.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            effectiveAt: new Date('2026-10-20T00:00:00.000Z'),
            source: 'AETHOS_HISTORY',
          }),
        ],
      }),
    );

    const changed = makeService(
      [{ idSubnivel: '267', nome: 'Plano ativo', ativo: true }],
      [
        {
          idSubnivel: '267',
          effectiveAt: new Date('2026-11-01T00:00:00.000Z'),
        },
      ],
    );
    await changed.service.syncPlanAccounts({
      totalPlanos: 1,
      planosConta: [
        {
          id: 267,
          nome: 'Plano inativo',
          ativo: false,
          dataInativacao: '2026-10-20',
        },
      ],
    });
    expect(changed.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            effectiveAt: new Date('2026-11-10T00:00:00.000Z'),
            source: 'SYNC_OBSERVED',
          }),
        ],
      }),
    );
  });

  it('does not create a duplicate event when the same snapshot is resent', async () => {
    const { service, createAccount, updateAccount, createEvent } = makeService([
      { idSubnivel: '267', nome: 'Plano inativo', ativo: false },
    ]);
    const result = await service.syncPlanAccounts({
      totalPlanos: 1,
      planosConta: [{ id: 267, nome: 'Plano inativo', ativo: false }],
    });
    expect(result).toEqual({ ok: true, received: 1, upserted: 0, changed: 0 });
    expect(createAccount).not.toHaveBeenCalled();
    expect(updateAccount).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('records reactivation and rejects ambiguous or duplicated rows', async () => {
    const { service, updateAccount, createEvent } = makeService([
      { idSubnivel: '267', nome: 'Plano', ativo: false },
    ]);
    const result = await service.syncPlanAccounts({
      totalPlanos: 1,
      planosConta: [{ id: 267, nome: 'Plano', ativo: true }],
    });
    expect(result.changed).toBe(1);
    expect(updateAccount).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ ativo: true, source: 'SYNC_OBSERVED' }),
        ],
      }),
    );
    await expect(
      service.syncPlanAccounts({
        planosConta: [
          { id: 267, nome: 'Plano', ativo: true },
          { id: 267, nome: 'Plano duplicado', ativo: false },
        ],
        totalPlanos: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.syncPlanAccounts({
        planosConta: [
          {
            id: 267,
            nome: 'Plano',
            ativo: false,
            dataInativacao: '2026-02-30',
          },
        ],
        totalPlanos: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('batches the first full catalog and rejects truncated snapshots', async () => {
    const { service, createAccount, createEvent } = makeService();
    const planosConta = Array.from({ length: 847 }, (_, index) => ({
      id: index + 1,
      nome: `Plano ${index + 1}`,
      ativo: index < 468,
    }));
    await service.syncPlanAccounts({ totalPlanos: 847, planosConta });
    expect(createAccount).toHaveBeenCalledTimes(1);
    const accountCall = createAccount.mock.calls[0] as unknown as [
      { data: unknown[] },
    ];
    expect(accountCall[0].data).toHaveLength(847);
    expect(createEvent).toHaveBeenCalledTimes(1);
    const eventCall = createEvent.mock.calls[0] as unknown as [
      { data: unknown[] },
    ];
    expect(eventCall[0].data).toHaveLength(847);

    const existing = Array.from({ length: 100 }, (_, index) => ({
      idSubnivel: String(index + 1),
      nome: `Plano ${index + 1}`,
      ativo: true,
    }));
    const partial = makeService(existing);
    await expect(
      partial.service.syncPlanAccounts({
        totalPlanos: 89,
        planosConta: planosConta.slice(0, 89),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(partial.createAccount).not.toHaveBeenCalled();

    await expect(
      service.syncPlanAccounts({
        totalPlanos: 846,
        planosConta,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
