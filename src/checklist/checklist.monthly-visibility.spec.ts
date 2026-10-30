import { ChecklistService } from './checklist.service';

describe('ChecklistService monthly visibility', () => {
  const vehicleFindMany = jest.fn();
  const vehicleCount = jest.fn();
  const userFindUnique = jest.fn();
  const checklistFindMany = jest.fn();
  const prisma = {
    user: { findUnique: userFindUnique },
    vehicle: { findMany: vehicleFindMany, count: vehicleCount },
    checklist: { findMany: checklistFindMany },
  };
  const service = new ChecklistService(prisma as any, {} as any, {} as any);
  const actor = { sub: 'supervisor-1', role: 'supervisor' };

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({
      id: actor.sub,
      role: actor.role,
      active: true,
      filial: 'MATRIZ',
      tipoFrota: 'Asfalto',
    });
    vehicleCount.mockResolvedValue(1);
    vehicleFindMany.mockResolvedValue([{ id: 'fleet-170' }]);
    checklistFindMany.mockResolvedValue([{ id: 'completed-170' }]);
  });

  it('includes completed assigned and assisted monthly vehicles outside the supervisor fleet scope', async () => {
    await expect(
      service.findAll(actor, { type: 'MONTHLY', month: 10, year: 2026 }),
    ).resolves.toEqual([{ id: 'completed-170' }]);

    expect(vehicleFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { tipoFrota: 'Asfalto', filial: 'MATRIZ' },
          {
            active: true,
            checklistEnabled: true,
            monthlyChecklistResponsibleId: actor.sub,
          },
          {
            active: true,
            checklistEnabled: true,
            monthlyChecklistResponsibleId: {
              not: null,
              notIn: [actor.sub],
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(checklistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { vehicleId: { in: ['fleet-170'] } },
            { type: 'MONTHLY' },
            { month: 10 },
            { year: 2026 },
          ],
        },
      }),
    );
  });

  it('keeps the original filial and type scope for daily checklists', async () => {
    await service.findAll(actor, { type: 'DAILY', month: 10, year: 2026 });

    expect(vehicleFindMany).toHaveBeenCalledWith({
      where: { tipoFrota: 'Asfalto', filial: 'MATRIZ' },
      select: { id: true },
    });
    expect(vehicleCount).not.toHaveBeenCalled();
  });

  it('does not broaden monthly access for an inactive supervisor', async () => {
    userFindUnique.mockResolvedValue({
      id: actor.sub,
      role: actor.role,
      active: false,
      filial: 'MATRIZ',
      tipoFrota: 'Asfalto',
    });

    await service.findAll(actor, { type: 'MONTHLY', month: 10, year: 2026 });

    expect(vehicleFindMany).toHaveBeenCalledWith({
      where: { OR: [{ tipoFrota: 'Asfalto', filial: 'MATRIZ' }] },
      select: { id: true },
    });
  });
});
