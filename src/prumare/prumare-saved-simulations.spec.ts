import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrumareService } from './prumare.service';

describe('Prumare saved price simulations', () => {
  const prisma = {
    prumareEnterprise: { findUnique: jest.fn() },
    prumareLot: { findUnique: jest.fn() },
    prumareSimulation: { create: jest.fn(), findMany: jest.fn() },
  };
  const service = new PrumareService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.prumareEnterprise.findUnique.mockResolvedValue({
      id: 'enterprise-1',
    });
    prisma.prumareLot.findUnique.mockResolvedValue({
      id: 'lot-1',
      enterpriseId: 'enterprise-1',
    });
    prisma.prumareSimulation.create.mockResolvedValue({ id: 'simulation-1' });
    prisma.prumareSimulation.findMany.mockResolvedValue([]);
  });

  const input = {
    enterpriseId: 'enterprise-1',
    lotId: 'lot-1',
    title: 'Quadra A - Lote 1',
    totalValue: 100000,
    downPayment: 5000,
    installments: 36,
    monthlyRatePercent: 0.5,
    annualReinforcement: 5000,
    save: true,
  };

  it('saves a validated lot snapshot without writing form control flags', async () => {
    const result = await service.simulatePrice(
      input,
      'prumare_admin',
      'user-1',
    );
    expect(result.monthlyPayment).toBeGreaterThan(0);
    const calls = prisma.prumareSimulation.create.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const write = calls[0]?.[0];
    expect(write.data).toMatchObject({
      enterpriseId: 'enterprise-1',
      lotId: 'lot-1',
      kind: 'PRICE',
      title: 'Quadra A - Lote 1',
      createdBy: 'user-1',
      inputs: {
        totalValue: 100000,
        downPayment: 5000,
        installments: 36,
        monthlyRatePercent: 0.5,
        annualReinforcement: 5000,
      },
    });
  });

  it('rejects saving without enterprise or with a lot from another enterprise', async () => {
    await expect(
      service.simulatePrice({ ...input, enterpriseId: undefined }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.prumareLot.findUnique.mockResolvedValue({
      id: 'lot-1',
      enterpriseId: 'enterprise-2',
    });
    await expect(service.simulatePrice(input, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.prumareSimulation.create).not.toHaveBeenCalled();
  });

  it('lists only recent price simulations for the selected enterprise and lot', async () => {
    await service.findSimulations('enterprise-1', 'lot-1', 'admin');
    expect(prisma.prumareSimulation.findMany).toHaveBeenCalledWith({
      where: { enterpriseId: 'enterprise-1', kind: 'PRICE', lotId: 'lot-1' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    await expect(
      service.findSimulations('enterprise-1', 'lot-1', 'corretor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
