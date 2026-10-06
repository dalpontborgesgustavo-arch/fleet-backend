import { resolveSupervisorFleetScope } from './supervisor-fleet-scope';

describe('resolveSupervisorFleetScope', () => {
  it('combines tipo de frota and filial for a regular supervisor', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'supervisor',
          tipoFrota: 'Veiculos',
          filial: 'NORTE',
        }),
      },
    } as any;

    await expect(
      resolveSupervisorFleetScope(prisma, {
        sub: 'supervisor-norte',
        role: 'supervisor',
      }),
    ).resolves.toEqual({ tipoFrota: 'Veiculos', filial: 'NORTE' });
  });

  it('does not restrict Apoio aos Supervisores', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as any;

    await expect(
      resolveSupervisorFleetScope(prisma, {
        sub: 'apoio',
        role: 'supervisor_apoio',
      }),
    ).resolves.toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when a regular supervisor has no fleet type', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'supervisor',
          tipoFrota: null,
          filial: 'MATRIZ',
        }),
      },
    } as any;

    await expect(
      resolveSupervisorFleetScope(prisma, {
        sub: 'supervisor-sem-tipo',
        role: 'supervisor',
      }),
    ).resolves.toBeNull();
  });
});
