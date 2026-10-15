import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrumareService } from './prumare.service';

describe('Prumare VGV saved scenarios', () => {
  const prisma = {
    prumareEnterprise: { findUnique: jest.fn() },
    prumareVgvScenario: { create: jest.fn(), findMany: jest.fn() },
  };
  const service = new PrumareService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.prumareEnterprise.findUnique.mockResolvedValue({
      id: 'enterprise-1',
    });
    prisma.prumareVgvScenario.create.mockResolvedValue({ id: 'scenario-1' });
    prisma.prumareVgvScenario.findMany.mockResolvedValue([]);
  });

  const input = {
    enterpriseId: 'enterprise-1',
    title: 'Reajuste gradual',
    phases: [
      { label: 'Tabela inicial', triggerLots: 10, increasePercent: 1.5 },
      { label: 'Segunda fase', triggerLots: 20, increasePercent: 2.5 },
    ],
  };

  it('saves only validated scenario inputs under the current user', async () => {
    await service.saveVgvScenario(
      { ...input, ignored: 'not stored' },
      'prumare',
      'user-1',
    );
    expect(prisma.prumareVgvScenario.create).toHaveBeenCalledWith({
      data: {
        enterpriseId: 'enterprise-1',
        createdBy: 'user-1',
        title: 'Reajuste gradual',
        phases: input.phases,
      },
    });
  });

  it('supports a separate all-enterprises scope without inventing an enterprise', async () => {
    await service.saveVgvScenario(
      { ...input, enterpriseId: '__ALL_ENTERPRISES__' },
      'admin',
      'user-1',
    );
    expect(prisma.prumareEnterprise.findUnique).not.toHaveBeenCalled();
    const calls = prisma.prumareVgvScenario.create.mock
      .calls as unknown as Array<[{ data: { enterpriseId: string | null } }]>;
    expect(calls[0][0].data.enterpriseId).toBeNull();
  });

  it('lists only the current user and selected scope', async () => {
    await service.findVgvScenarios('enterprise-1', 'prumare_admin', 'user-1');
    expect(prisma.prumareVgvScenario.findMany).toHaveBeenCalledWith({
      where: { createdBy: 'user-1', enterpriseId: 'enterprise-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('rejects unauthorized or malformed scenario writes', async () => {
    await expect(
      service.saveVgvScenario(input, 'corretor', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.saveVgvScenario(input, 'prumare'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.saveVgvScenario(
        { ...input, phases: [{ ...input.phases[0], increasePercent: -1 }] },
        'prumare',
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveVgvScenario({ ...input, phases: [] }, 'prumare', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.prumareVgvScenario.create).not.toHaveBeenCalled();
  });
});
