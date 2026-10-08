import { Prisma } from '@prisma/client';
import { TopographyInventoryService } from './topography-inventory.service';

describe('TopographyInventoryService — liquid stock', () => {
  it('stores a liter measurement without inventing tonnage when density is missing', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      topographyInventory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'inventory-september' }),
      },
      topographyInventoryItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany,
      },
      topographyInventoryHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-september' }),
      },
    };
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'diesel-usina',
        company: 'USINA_JR',
        inputUnit: 'LITER',
        density: null,
        aethosItemCode: null,
      },
    ]);
    const service = new TopographyInventoryService({
      topographyInventoryMaterial: { findMany },
      $transaction: jest.fn((callback) => callback(transaction)),
    } as any);
    jest.spyOn(service, 'bootstrap').mockResolvedValue({ ok: true } as any);

    await service.save(
      {
        company: 'USINA_JR',
        referenceYear: 2026,
        referenceMonth: 9,
        measuredAt: '2026-10-01T13:20:00-03:00',
        items: [{ materialId: 'diesel-usina', volumeM3: 3500 }],
      },
      'topografia',
      'user-1',
      true,
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { availableFromCompetence: null },
          { availableFromCompetence: { lte: new Date('2026-09-01T00:00:00.000Z') } },
        ],
      }),
    }));
    const saved = createMany.mock.calls[0][0].data[0];
    expect(saved.volumeM3).toEqual(new Prisma.Decimal('3500'));
    expect(saved.densitySnapshot).toBeNull();
    expect(saved.tonnage).toBeNull();
  });
});
