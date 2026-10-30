import { OccurrencesService } from './occurrences.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';

function makeService(ownerIds: string[], checklistType = 'MONTHLY') {
  const tx = {
    checklist: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ type: checklistType, vehicleId: 'vehicle-1' }),
    },
    occurrence: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(ownerIds.map((id) => ({ id }))),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    occurrence: { create: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
  };
  const service = new OccurrencesService(
    prisma as unknown as PrismaService,
    {} as S3UploadService,
  );
  return { service, tx };
}

describe('monthly occurrence triage owner', () => {
  it('assigns Filipe to a new monthly occurrence when his active maintenance account is unique', async () => {
    const { service, tx } = makeService(['filipe-id']);

    const result = await service.create(
      {
        vehicleId: 'vehicle-1',
        checklistId: 'checklist-1',
        questionId: 'question-1',
        questionLabel: 'Freios',
      },
      'creator-id',
    );

    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          role: { equals: 'manutencao', mode: 'insensitive' },
          name: { equals: 'Filipe Crispim Neto', mode: 'insensitive' },
        },
        take: 2,
      }),
    );
    expect(result.triageOwnerUserId).toBe('filipe-id');
    expect(result.maintenanceTargetUserId).toBeNull();
  });

  it.each([[[]], [['filipe-1', 'filipe-2']]])(
    'keeps the checklist available without a unique owner: %j',
    async (ownerIds) => {
      const { service } = makeService(ownerIds);
      const result = await service.create(
        {
          vehicleId: 'vehicle-1',
          checklistId: 'checklist-1',
          questionLabel: 'Freios',
        },
        'creator-id',
      );
      expect(result.triageOwnerUserId).toBeNull();
    },
  );

  it('does not assign Filipe to a daily checklist occurrence', async () => {
    const { service, tx } = makeService(['filipe-id'], 'DAILY');
    const result = await service.create(
      {
        vehicleId: 'vehicle-1',
        checklistId: 'checklist-1',
        questionLabel: 'Freios',
      },
      'creator-id',
    );
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(result.triageOwnerUserId).toBeUndefined();
  });
});
