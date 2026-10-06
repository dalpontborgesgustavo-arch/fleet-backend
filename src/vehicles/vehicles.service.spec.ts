import { BadRequestException, ConflictException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
  it('lists only vehicles matching both fleet type and branch for a supervisor', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new VehiclesService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'supervisor',
          tipoFrota: 'Veiculos',
          filial: 'NORTE',
        }),
      },
      vehicle: { findMany },
    } as any);

    await service.findAll({ sub: 'supervisor-1', role: 'supervisor' });

    expect(findMany).toHaveBeenCalledWith({
      where: { tipoFrota: 'Veiculos', filial: 'NORTE' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('blocks a duplicated fleet and plate even with different formatting', async () => {
    const create = jest.fn();
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            fleet: '23',
            plate: 'IPM-7A28',
          },
        ]),
        create,
      },
    } as any);

    await expect(
      service.create({
        fleet: 'FROTA 23',
        plate: 'ipm7a28',
        tipoFrota: 'Asfalto',
      }),
    ).rejects.toThrow(
      'Já existe um veículo cadastrado com a frota FROTA 23 e a placa IPM7A28.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a duplicated plate assigned to another fleet', async () => {
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            fleet: '23',
            plate: 'IPM-7A28',
          },
        ]),
        create: jest.fn(),
      },
    } as any);

    await expect(
      service.create({
        fleet: '99',
        plate: 'IPM7A28',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks a duplicated fleet assigned to another plate', async () => {
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            fleet: 'Frota 23',
            plate: 'IPM-7A28',
          },
        ]),
        create: jest.fn(),
      },
    } as any);

    await expect(
      service.create({
        fleet: '23',
        plate: 'ABC-1D23',
      }),
    ).rejects.toThrow('A frota 23 já está cadastrada em outro veículo.');
  });

  it('allows an update that keeps the identity of the same vehicle', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'vehicle-1',
      fleet: '23',
      plate: 'IPM-7A28',
    });
    const service = new VehiclesService({
      vehicle: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vehicle-1',
          fleet: '23',
          plate: 'IPM-7A28',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update,
      },
    } as any);

    await expect(
      service.update('vehicle-1', {
        fleet: '23',
        plate: 'ipm-7a28',
        model: 'C-1317',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'vehicle-1',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vehicle-1' },
        data: expect.objectContaining({
          plate: 'IPM-7A28',
          fleet: '23',
        }),
      }),
    );
  });

  it('defaults a new vehicle to Matriz', async () => {
    const create = jest.fn().mockImplementation(({ data }) => data);
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        create,
      },
    } as any);

    await service.create({ plate: 'ABC-1D23' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ filial: 'MATRIZ' }),
    });
  });

  it('trims and persists the optional vehicle classification', async () => {
    const create = jest.fn().mockImplementation(({ data }) => data);
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        create,
      },
    } as any);

    await service.create({
      plate: 'ABC-1D23',
      group: '  DESPESAS VEÍCULOS  ',
      subgroup: '  CARROS FROTA JR  ',
      company: '  JR CONSTRUÇÕES  ',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        group: 'DESPESAS VEÍCULOS',
        subgroup: 'CARROS FROTA JR',
        company: 'JR CONSTRUÇÕES',
      }),
    });
  });

  it('normalizes Filial Norte and rejects an unknown branch', async () => {
    const create = jest.fn().mockImplementation(({ data }) => data);
    const service = new VehiclesService({
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        create,
      },
    } as any);

    await service.create({ plate: 'ABC-1D23', filial: 'Filial Norte' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ filial: 'NORTE' }),
    });

    await expect(
      service.create({ plate: 'DEF-4G56', filial: 'Sul' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
