import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeFilial } from '../common/filial';
import {
  AuthenticatedActor,
  resolveSupervisorFleetScope,
} from '../common/supervisor-fleet-scope';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlateKey(value: unknown): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeFleetKey(value: unknown): string {
  return cleanText(value)
    .replace(/^FROTA[\s-]*/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAll(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return [];
    }

    return this.prisma.vehicle.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: any) {
    const normalizedData = this.normalizeVehicleData(data, true);
    this.ensureRequiredIdentity(normalizedData);
    await this.ensureUniqueIdentity(normalizedData);

    try {
      return await this.prisma.vehicle.create({ data: normalizedData });
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const normalizedData = this.normalizeVehicleData(data);
    const identity = {
      plate:
        normalizedData.plate === undefined
          ? existing.plate
          : normalizedData.plate,
      fleet:
        normalizedData.fleet === undefined
          ? existing.fleet
          : normalizedData.fleet,
    };
    this.ensureRequiredIdentity(identity);
    await this.ensureUniqueIdentity(identity, id, existing.aethosManaged);

    try {
      return await this.prisma.vehicle.update({
        where: { id },
        data: normalizedData,
      });
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  delete(id: string) {
    return this.prisma.vehicle.delete({
      where: { id },
    });
  }

  private normalizeVehicleData(data: any, defaultFilial = false) {
    const normalized = { ...data };

    if (Object.prototype.hasOwnProperty.call(data || {}, 'plate')) {
      normalized.plate = cleanText(data.plate).toUpperCase();
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'fleet')) {
      normalized.fleet = cleanText(data.fleet) || null;
    }
    for (const field of ['group', 'subgroup', 'company'] as const) {
      if (Object.prototype.hasOwnProperty.call(data || {}, field)) {
        normalized[field] = cleanText(data[field]) || null;
      }
    }
    if (
      defaultFilial ||
      Object.prototype.hasOwnProperty.call(data || {}, 'filial')
    ) {
      normalized.filial = normalizeFilial(data?.filial);
    }

    return normalized;
  }

  private ensureRequiredIdentity(data: { plate?: unknown }) {
    if (!normalizePlateKey(data.plate)) {
      throw new BadRequestException('Informe uma placa válida.');
    }
  }

  private async ensureUniqueIdentity(
    data: { plate?: unknown; fleet?: unknown },
    excludeId?: string,
    allowDuplicateFleet = false,
  ) {
    const plateKey = normalizePlateKey(data.plate);
    const fleetKey = normalizeFleetKey(data.fleet);
    const existingVehicles = await this.prisma.vehicle.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: {
        plate: true,
        fleet: true,
      },
    });

    const plateConflict = existingVehicles.find(
      (vehicle) => normalizePlateKey(vehicle.plate) === plateKey,
    );
    const fleetConflict =
      !allowDuplicateFleet && fleetKey
        ? existingVehicles.find(
            (vehicle) => normalizeFleetKey(vehicle.fleet) === fleetKey,
          )
        : null;

    if (plateConflict && fleetConflict === plateConflict) {
      throw new ConflictException(
        `Já existe um veículo cadastrado com a frota ${cleanText(data.fleet)} e a placa ${cleanText(data.plate).toUpperCase()}.`,
      );
    }
    if (plateConflict) {
      throw new ConflictException(
        `A placa ${cleanText(data.plate).toUpperCase()} já está cadastrada em outro veículo.`,
      );
    }
    if (fleetConflict) {
      throw new ConflictException(
        `A frota ${cleanText(data.fleet)} já está cadastrada em outro veículo.`,
      );
    }
  }

  private rethrowUniqueConstraint(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe outro veículo cadastrado com esta frota ou placa.',
      );
    }
  }
}
