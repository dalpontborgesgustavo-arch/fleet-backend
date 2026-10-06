import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChecklistService } from './checklist.service';
import type { CreateChecklistDto } from './dto/create-checklist.dto';

const BASE_PHOTOS = [
  { slot: 'front', label: 'Foto frontal', photoUrl: '/front.jpg' },
  { slot: 'rear', label: 'Foto traseira', photoUrl: '/rear.jpg' },
  { slot: 'interior', label: 'Foto interna', photoUrl: '/interior.jpg' },
  { slot: 'left', label: 'Foto lado esquerdo', photoUrl: '/left.jpg' },
  { slot: 'right', label: 'Foto lado direito', photoUrl: '/right.jpg' },
];

function monthlyDto(fleetPhotos = BASE_PHOTOS): CreateChecklistDto {
  return {
    title: 'Checklist mensal',
    vehicleId: 'vehicle-1',
    type: 'MONTHLY',
    fleetPhotos,
    items: [{ label: 'Item', ok: true }],
  };
}

describe('ChecklistService monthly fleet photos', () => {
  const checklistCreate = jest.fn();
  const checklistFindFirst = jest.fn();
  const userFindUnique = jest.fn();
  const vehicleFindFirst = jest.fn();
  const vehicleFindUnique = jest.fn();
  const vehicleUpdateMany = jest.fn();
  const queryRaw = jest.fn();
  const transaction = jest.fn();
  const createForChecklistIfNeeded = jest.fn();
  const prisma = {
    user: { findUnique: userFindUnique },
    vehicle: {
      findFirst: vehicleFindFirst,
      findUnique: vehicleFindUnique,
      updateMany: vehicleUpdateMany,
    },
    checklist: {
      create: checklistCreate,
      findFirst: checklistFindFirst,
    },
    $transaction: transaction,
  };
  const consentService = { createForChecklistIfNeeded };
  const service = new ChecklistService(prisma as any, consentService as any);

  beforeEach(() => {
    jest.clearAllMocks();
    checklistFindFirst.mockResolvedValue(null);
    checklistCreate.mockResolvedValue({ id: 'checklist-1', items: [] });
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'supervisor_apoio',
      active: true,
      name: 'Usuario Teste',
      email: 'teste@jr.com',
    });
    vehicleFindFirst.mockResolvedValue({
      id: 'vehicle-1',
      monthlyChecklistResponsible: { id: 'user-1', name: 'Usuario Teste' },
    });
    vehicleFindUnique.mockResolvedValue({
      id: 'vehicle-1',
      hasTimeClockDevice: false,
      subgroup: null,
    });
    vehicleUpdateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValue([]);
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: queryRaw,
        checklist: { create: checklistCreate },
        vehicle: { updateMany: vehicleUpdateMany },
      }),
    );
    createForChecklistIfNeeded.mockResolvedValue(null);
  });

  it('returns the existing monthly checklist instead of creating a duplicate', async () => {
    checklistFindFirst.mockResolvedValue({
      id: 'existing-checklist',
      items: [{ id: 'existing-item' }],
    });

    await expect(service.create(monthlyDto(), 'user-1')).resolves.toMatchObject({
      id: 'existing-checklist',
    });
    expect(vehicleFindUnique).not.toHaveBeenCalled();
    expect(checklistCreate).not.toHaveBeenCalled();
    expect(createForChecklistIfNeeded).not.toHaveBeenCalled();
  });

  it('recovers a concurrent monthly retry blocked by the unique index', async () => {
    checklistFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'concurrent-checklist',
        items: [{ id: 'concurrent-item' }],
      });
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: false });
    checklistCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the monthly checklist period.',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      ),
    );

    await expect(service.create(monthlyDto(), 'user-1')).resolves.toMatchObject({
      id: 'concurrent-checklist',
    });
    expect(checklistFindFirst).toHaveBeenCalledTimes(2);
    expect(createForChecklistIfNeeded).not.toHaveBeenCalled();
  });

  it('accepts the five standard photos when the vehicle has no time clock device', async () => {
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: false });

    await expect(service.create(monthlyDto(), 'user-1')).resolves.toMatchObject(
      {
        id: 'checklist-1',
      },
    );
    expect(checklistCreate).toHaveBeenCalledTimes(1);
  });

  it('requires a time clock device photo when configured on the vehicle', async () => {
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: true });

    await expect(service.create(monthlyDto(), 'user-1')).rejects.toThrow(
      new BadRequestException(
        'A foto do dispositivo de ponto e obrigatoria para este veiculo.',
      ),
    );
    expect(checklistCreate).not.toHaveBeenCalled();
  });

  it('accepts the additional time clock device photo for configured vehicles', async () => {
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: true });
    const photos = [
      ...BASE_PHOTOS,
      {
        slot: 'timeClockDevice',
        label: 'Foto do dispositivo de ponto',
        photoUrl: '/time-clock-device.jpg',
      },
    ];

    await expect(
      service.create(monthlyDto(photos), 'user-1'),
    ).resolves.toMatchObject({
      id: 'checklist-1',
    });
    expect(checklistCreate).toHaveBeenCalledTimes(1);
  });

  it('persists NA without creating a nonconformity in the legacy ok field', async () => {
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: false });
    const dto = monthlyDto();
    dto.items = [{ label: 'Item nao aplicavel', answer: 'NA' }];

    await service.create(dto, 'user-1');

    expect(checklistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              {
                label: 'Item nao aplicavel',
                answer: 'NA',
                ok: true,
              },
            ],
          },
        }),
      }),
    );
  });

  it('keeps accepting legacy clients that only send ok', async () => {
    vehicleFindUnique.mockResolvedValue({ hasTimeClockDevice: false });

    await service.create(monthlyDto(), 'user-1');

    expect(checklistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              {
                label: 'Item',
                answer: 'OK',
                ok: true,
              },
            ],
          },
        }),
      }),
    );
  });
});
