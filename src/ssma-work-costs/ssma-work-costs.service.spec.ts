import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SsmaWorkCostsService } from './ssma-work-costs.service';

const sample = () => ({
  runId: 'ssma-work-20261019-001',
  generatedAt: '2026-10-19T15:00:00Z',
  fullSnapshot: true,
  productCodes: ['13189', '14515', '17410', '15016', '17411', '07085'],
  budgets: [
    {
      sourceId: 'b1',
      workCode: '459',
      workName: 'Obra 459',
      companyCode: '1',
      productCode: '14515',
      productDescription: 'Placa',
      unit: 'UN',
      parentSourceId: null,
      stageId: null,
      quantity: '1',
      unitCost: '10',
      amount: '10.00',
      status: 'E',
      isOriginal: true,
    },
  ],
  actuals: [
    {
      sourceKey: 'a1',
      workCode: '459',
      workName: 'Obra 459',
      companyCode: '1',
      productCode: '14515',
      productDescription: 'Placa',
      entryDate: '2026-05-20',
      status: 'F',
      unit: 'UN',
      quantity: '1',
      unitCost: '8',
      amount: '8.00',
      accountCode: '811',
      documentType: 'NFE',
      documentId: '1',
      documentItemId: '1',
      stageId: null,
    },
  ],
});

describe('SsmaWorkCostsService', () => {
  const makePrisma = () => ({
    ssmaWorkCostSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...data,
          receivedAt: new Date('2026-10-19T15:00:01Z'),
        }),
      ),
    },
  });

  it('rejects unauthorized reads before querying data', async () => {
    const prisma = makePrisma();
    const service = new SsmaWorkCostsService(prisma as never);
    await expect(service.read('gestor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.ssmaWorkCostSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('accepts one complete snapshot and returns a precise receipt', async () => {
    const prisma = makePrisma();
    const service = new SsmaWorkCostsService(prisma as never);
    const result = await service.sync(sample());
    expect(result).toMatchObject({
      runId: 'ssma-work-20261019-001',
      budgetCount: 1,
      actualCount: 1,
      replayed: false,
    });
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.ssmaWorkCostSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a runId with another payload', async () => {
    const prisma = makePrisma();
    prisma.ssmaWorkCostSnapshot.findUnique.mockResolvedValueOnce({
      runId: 'ssma-work-20261019-001',
      payloadHash: 'different',
    } as never);
    const service = new SsmaWorkCostsService(prisma as never);
    await expect(service.sync(sample())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.ssmaWorkCostSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects a sharp coverage drop instead of replacing a complete view', async () => {
    const prisma = makePrisma();
    prisma.ssmaWorkCostSnapshot.findFirst.mockResolvedValueOnce({
      generatedAt: new Date('2026-10-18T15:00:00Z'),
      budgetCount: 10,
      actualCount: 10,
    } as never);
    const service = new SsmaWorkCostsService(prisma as never);
    await expect(service.sync(sample())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns only the six scoped products to SSMA', async () => {
    const prisma = makePrisma();
    prisma.ssmaWorkCostSnapshot.findFirst.mockResolvedValueOnce({
      runId: 'r1',
      generatedAt: new Date('2026-10-19T15:00:00Z'),
      receivedAt: new Date('2026-10-19T15:00:01Z'),
      budgetCount: 2,
      actualCount: 1,
      payloadHash: 'hash',
      budgets: [
        { productCode: '14515', amount: '10.00' },
        { productCode: '14519', amount: '999.00' },
      ],
      actuals: [{ productCode: '14515', amount: '8.00' }],
    } as never);
    const service = new SsmaWorkCostsService(prisma as never);
    const result = await service.read('ssma');
    expect(result.budgets).toHaveLength(1);
    expect(result.actuals).toHaveLength(1);
    expect(result.monthlyBudgetAvailable).toBe(false);
  });
});
