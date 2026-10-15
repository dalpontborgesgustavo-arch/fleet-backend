import { AethosVehicleSyncService } from './aethos-vehicle-sync.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AethosVehicleSyncService', () => {
  const existingVehicles = [
    {
      id: 'jr-importable',
      fleet: '900',
      plate: 'ABC-1D23',
      active: true,
      aethosVehicleId: '200',
      aethosManaged: true,
    },
    {
      id: 'jr-outside-import',
      fleet: '878',
      plate: 'OJJ-2F15',
      active: true,
      aethosVehicleId: '1111',
      aethosManaged: true,
    },
  ];
  const snapshot = {
    snapshotId: 'vehicle-status-regression-1',
    generatedAt: '2026-10-15T12:00:00.000Z',
    expectedCount: 1,
    execute: true,
    vehicles: [
      {
        idVeiculoAethos: '200',
        idEmpresa: '1',
        frota: '900',
        placaSistema: 'ABC-1D23',
        ativo: true,
      },
    ],
  };

  it('preserves a managed active vehicle omitted by the importable subset', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      vehicle: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      aethosVehicleSyncRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      vehicle: { findMany: jest.fn().mockResolvedValue(existingVehicles) },
      aethosVehicleSyncRun: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    };
    const service = new AethosVehicleSyncService(
      prisma as unknown as PrismaService,
    );

    const result = await service.sync(snapshot);

    expect(result.executed).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(result.deactivatedCount).toBe(0);
    expect(result.managedActiveOutsideImportCount).toBe(1);
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledTimes(1);
    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'jr-importable' } }),
    );
    const [createdRun] = tx.aethosVehicleSyncRun.create.mock.calls[0] as [
      { data: { deactivatedCount: number } },
    ];
    expect(createdRun.data.deactivatedCount).toBe(0);
  });

  it('still applies an explicit official S-to-N event by Aethos ID', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      vehicle: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue(existingVehicles),
      },
      aethosVehicleSyncRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      aethosVehicleStatusEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      vehicle: { findMany: jest.fn().mockResolvedValue(existingVehicles) },
      aethosVehicleSyncRun: { findUnique: jest.fn().mockResolvedValue(null) },
      aethosVehicleStatusEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    };
    const service = new AethosVehicleSyncService(
      prisma as unknown as PrismaService,
    );

    const result = await service.sync({
      ...snapshot,
      snapshotId: 'vehicle-status-regression-2',
      inativacoesVeiculos: [
        {
          idEventoAethos: 'official-transition-1',
          idVeiculoAethos: '1111',
          idEmpresa: '1',
          statusAnterior: 'S',
          statusAtual: 'N',
          dataAlteracaoStatus: '2026-10-15T11:00:00.000Z',
          frota: '878',
          placaSistema: 'OJJ-2F15',
        },
      ],
    });

    expect(result.statusEventsAppliedCount).toBe(1);
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'jr-outside-import' },
      data: expect.objectContaining({
        active: false,
        aethosVehicleId: '1111',
      }) as object,
    });
    expect(tx.aethosVehicleStatusEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects an old N event that contradicts the current active snapshot', async () => {
    const prisma = {
      vehicle: { findMany: jest.fn().mockResolvedValue(existingVehicles) },
      aethosVehicleStatusEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AethosVehicleSyncService(
      prisma as unknown as PrismaService,
    );

    const result = await service.sync({
      ...snapshot,
      execute: false,
      inativacoesVeiculos: [
        {
          idEventoAethos: 'stale-n-event',
          idVeiculoAethos: '200',
          idEmpresa: '1',
          statusAnterior: 'S',
          statusAtual: 'N',
          dataAlteracaoStatus: '2026-10-14T11:00:00.000Z',
          placaSistema: 'ABC-1D23',
        },
      ],
    });

    expect(result.statusEventsWouldApplyCount).toBe(0);
    expect(result.statusEventsConflictCount).toBe(1);
    expect(result.deactivatedCount).toBe(0);
  });

  it('does not resolve an unknown status event by plate or fleet alone', async () => {
    const prisma = {
      vehicle: { findMany: jest.fn().mockResolvedValue(existingVehicles) },
      aethosVehicleStatusEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AethosVehicleSyncService(
      prisma as unknown as PrismaService,
    );

    const result = await service.sync({
      ...snapshot,
      execute: false,
      inativacoesVeiculos: [
        {
          idEventoAethos: 'unknown-id-event',
          idVeiculoAethos: '9999',
          idEmpresa: '1',
          statusAnterior: 'S',
          statusAtual: 'N',
          dataAlteracaoStatus: '2026-10-15T11:00:00.000Z',
          frota: '878',
          placaSistema: 'OJJ-2F15',
        },
      ],
    });

    expect(result.statusEventsWouldApplyCount).toBe(0);
    expect(result.statusEventsNotFoundCount).toBe(1);
  });
});
