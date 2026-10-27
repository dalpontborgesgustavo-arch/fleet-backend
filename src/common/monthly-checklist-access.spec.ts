import { PrismaService } from '../prisma/prisma.service';
import {
  canAccessMonthlyChecklist,
  resolveMonthlyChecklistVehicleWhere,
} from './monthly-checklist-access';

describe('monthly checklist access', () => {
  const userFindUnique = jest.fn();
  const vehicleCount = jest.fn();
  const prisma = {
    user: { findUnique: userFindUnique },
    vehicle: { count: vehicleCount },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', active: true });
    vehicleCount.mockResolvedValue(0);
  });

  it('lets an administrator help another responsible without owning a fleet', async () => {
    const where = await resolveMonthlyChecklistVehicleWhere(
      prisma,
      { sub: 'admin-1', role: 'admin' },
      'ASSISTANCE',
    );

    expect(where).toEqual({
      active: true,
      checklistEnabled: true,
      monthlyChecklistResponsibleId: {
        not: null,
        notIn: ['admin-1'],
      },
    });
    expect(vehicleCount).not.toHaveBeenCalled();
  });

  it('keeps the administrator own-fleet scope unchanged', async () => {
    await expect(
      resolveMonthlyChecklistVehicleWhere(
        prisma,
        { sub: 'admin-1', role: 'admin' },
      ),
    ).resolves.toEqual({
      active: true,
      checklistEnabled: true,
      monthlyChecklistResponsibleId: 'admin-1',
    });
  });

  it('advertises monthly access when the administrator can help another responsible', async () => {
    vehicleCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(
      canAccessMonthlyChecklist(prisma, { sub: 'admin-1', role: 'admin' }),
    ).resolves.toBe(true);
    expect(vehicleCount).toHaveBeenNthCalledWith(2, {
      where: {
        active: true,
        checklistEnabled: true,
        monthlyChecklistResponsibleId: {
          not: null,
          notIn: ['admin-1'],
        },
      },
    });
  });

  it('does not extend assistance to an unassigned regular user', async () => {
    userFindUnique.mockResolvedValue({ id: 'user-1', role: 'supervisor', active: true });

    await expect(
      resolveMonthlyChecklistVehicleWhere(
        prisma,
        { sub: 'user-1', role: 'supervisor' },
        'ASSISTANCE',
      ),
    ).resolves.toBeNull();
  });

  it('rejects an inactive administrator', async () => {
    userFindUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', active: false });

    await expect(
      resolveMonthlyChecklistVehicleWhere(
        prisma,
        { sub: 'admin-1', role: 'admin' },
        'ASSISTANCE',
      ),
    ).resolves.toBeNull();
  });
});
