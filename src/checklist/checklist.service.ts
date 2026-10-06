import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { ChecklistConsentService } from './checklist-consent.service';
import {
  AuthenticatedActor,
  resolveSupervisorFleetScope,
} from '../common/supervisor-fleet-scope';

@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checklistConsentService: ChecklistConsentService,
  ) {}

  async create(dto: CreateChecklistDto, userId: string) {
    const now = new Date();
    const type = dto.type === 'MONTHLY' ? 'MONTHLY' : 'DAILY';
    const fleetPhotos = normalizeFleetPhotos(dto.fleetPhotos);
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    if (type === 'MONTHLY') {
      const existingChecklist = await this.findExistingMonthlyChecklist(
        dto.vehicleId,
        month,
        year,
      );

      if (existingChecklist) {
        return existingChecklist;
      }

      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { hasTimeClockDevice: true },
      });

      if (!vehicle) {
        throw new BadRequestException('Veiculo nao encontrado.');
      }

      assertCompleteMonthlyFleetPhotos(
        fleetPhotos,
        vehicle.hasTimeClockDevice === true,
      );
    }

    let checklist;

    try {
      checklist = await this.prisma.checklist.create({
        data: {
          title: dto.title,
          vehicleId: dto.vehicleId,
          photoUrl:
            dto.photoUrl ?? getRepresentativeFleetPhotoUrl(fleetPhotos) ?? null,
          fleetPhotos,
          month,
          year,
          status: 'aberto',
          type,
          createdBy: userId,
          items: {
            create: dto.items.map((item) => {
              const answer = normalizeChecklistAnswer(item);

              return {
                label: item.label,
                answer,
                ok: answer !== 'NC',
              };
            }),
          },
        },
        include: {
          items: true,
        },
      });
    } catch (error) {
      if (type === 'MONTHLY' && isUniqueConstraintError(error)) {
        const existingChecklist = await this.findExistingMonthlyChecklist(
          dto.vehicleId,
          month,
          year,
        );

        if (existingChecklist) {
          return existingChecklist;
        }
      }

      throw error;
    }

    await this.checklistConsentService.createForChecklistIfNeeded(checklist.id);

    return checklist;
  }

  private findExistingMonthlyChecklist(
    vehicleId: string,
    month: number,
    year: number,
  ) {
    return this.prisma.checklist.findFirst({
      where: {
        vehicleId,
        type: 'MONTHLY',
        month,
        year,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        items: true,
      },
    });
  }

  async findAll(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return [];
    }

    const vehicleIds = scope
      ? (
          await this.prisma.vehicle.findMany({
            where: scope,
            select: { id: true },
          })
        ).map((vehicle) => vehicle.id)
      : null;

    return this.prisma.checklist.findMany({
      where: vehicleIds ? { vehicleId: { in: vehicleIds } } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
        consent: {
          select: {
            id: true,
            status: true,
            responsibleName: true,
            responsibleEmail: true,
            sentAt: true,
            lastEmailError: true,
            lastReminderAt: true,
            lastReminderError: true,
            reminderCount: true,
            consentedAt: true,
            rejectedAt: true,
            note: true,
            responseIp: true,
            responseUserAgent: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async findHistory(
    query: Record<string, unknown>,
    actor?: AuthenticatedActor | null,
  ) {
    const page = positiveInteger(query.page, 1);
    const pageSize = Math.min(positiveInteger(query.pageSize, 50), 100);
    const search = cleanQueryText(query.search).slice(0, 120);
    const vehicleId = cleanQueryText(query.vehicleId);
    const actorRole = cleanQueryText(actor?.role).toLowerCase();
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return emptyHistoryPage(page, pageSize);
    }

    if (actorRole === 'motorista' && !actor?.sub) {
      return emptyHistoryPage(page, pageSize);
    }

    const scopedVehicleIds = scope
      ? (
          await this.prisma.vehicle.findMany({
            where: scope,
            select: { id: true },
          })
        ).map((vehicle) => vehicle.id)
      : null;

    if (
      vehicleId &&
      scopedVehicleIds &&
      !scopedVehicleIds.includes(vehicleId)
    ) {
      return emptyHistoryPage(page, pageSize);
    }

    const allowedVehicleIds = vehicleId ? [vehicleId] : scopedVehicleIds;
    const filters: Prisma.ChecklistWhereInput[] = [];

    if (actorRole === 'motorista' && actor?.sub) {
      filters.push({ createdBy: actor.sub });
    }

    if (allowedVehicleIds) {
      filters.push({ vehicleId: { in: allowedVehicleIds } });
    }

    if (search) {
      const matchingVehicles = await this.prisma.vehicle.findMany({
        where: {
          ...(scope || {}),
          ...(vehicleId ? { id: vehicleId } : {}),
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { plate: { contains: search, mode: 'insensitive' } },
            { fleet: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { tipoFrota: { contains: search, mode: 'insensitive' } },
            { vehicleType: { contains: search, mode: 'insensitive' } },
            { responsibleName: { contains: search, mode: 'insensitive' } },
            { responsibleEmail: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      const searchOptions: Prisma.ChecklistWhereInput[] = [
        { id: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { status: { contains: search, mode: 'insensitive' } },
        { createdBy: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        {
          consent: {
            responsibleName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          consent: {
            responsibleEmail: { contains: search, mode: 'insensitive' },
          },
        },
        {
          items: { some: { label: { contains: search, mode: 'insensitive' } } },
        },
        { vehicleId: { in: matchingVehicles.map((vehicle) => vehicle.id) } },
      ];

      const normalizedSearch = normalizeSearchText(search);
      if (normalizedSearch.includes('mensal')) {
        searchOptions.push({ type: 'MONTHLY' });
      }
      if (
        normalizedSearch.includes('diario') ||
        normalizedSearch.includes('diaria')
      ) {
        searchOptions.push({ type: 'DAILY' });
      }
      if (
        normalizedSearch.includes('nao conforme') ||
        normalizedSearch === 'nc' ||
        normalizedSearch.includes('problema') ||
        normalizedSearch.includes('atencao')
      ) {
        searchOptions.push({ items: { some: { answer: 'NC' } } });
      }

      filters.push({ OR: searchOptions });
    }

    const where: Prisma.ChecklistWhereInput = filters.length
      ? { AND: filters }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.checklist.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: true,
          user: { select: { id: true, name: true, email: true } },
          consent: {
            select: {
              id: true,
              status: true,
              responsibleName: true,
              responsibleEmail: true,
              sentAt: true,
              lastEmailError: true,
              lastReminderAt: true,
              lastReminderError: true,
              reminderCount: true,
              consentedAt: true,
              rejectedAt: true,
              note: true,
              responseIp: true,
              responseUserAgent: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.prisma.checklist.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async findTiReport() {
    const [checklists, vehicles] = await this.prisma.$transaction([
      this.prisma.checklist.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          items: true,
          user: { select: { id: true, name: true, email: true } },
          consent: true,
          occurrences: {
            orderBy: { createdAt: 'asc' },
            include: {
              photos: {
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.vehicle.findMany({
        orderBy: [{ active: 'desc' }, { fleet: 'asc' }],
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      checklists,
      vehicles,
    };
  }
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanQueryText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function emptyHistoryPage(page: number, pageSize: number) {
  return {
    items: [],
    pagination: { page, pageSize, total: 0, totalPages: 1 },
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function normalizeChecklistAnswer(
  item: CreateChecklistDto['items'][number],
): 'OK' | 'NC' | 'NA' {
  if (item.answer === 'OK' || item.answer === 'NC' || item.answer === 'NA') {
    return item.answer;
  }

  if (typeof item.ok === 'boolean') {
    return item.ok ? 'OK' : 'NC';
  }

  throw new BadRequestException(
    'Cada item do checklist precisa de uma resposta valida.',
  );
}

function normalizeFleetPhotos(
  photos: CreateChecklistDto['fleetPhotos'],
): Prisma.InputJsonArray | undefined {
  if (!Array.isArray(photos) || photos.length === 0) {
    return undefined;
  }

  const entries = photos
    .map((photo) => ({
      slot: photo.slot?.trim(),
      label: photo.label?.trim() || 'Foto da frota',
      photoUrl: photo.photoUrl?.trim() || null,
    }))
    .filter((photo) => photo.slot && photo.photoUrl);

  return entries.length ? entries : undefined;
}

const MONTHLY_FLEET_PHOTO_SLOTS = [
  'front',
  'rear',
  'interior',
  'left',
  'right',
];
const TIME_CLOCK_DEVICE_PHOTO_SLOT = 'timeClockDevice';

function assertCompleteMonthlyFleetPhotos(
  photos: Prisma.InputJsonArray | undefined,
  requiresTimeClockDevicePhoto: boolean,
) {
  const requiredSlots = requiresTimeClockDevicePhoto
    ? [...MONTHLY_FLEET_PHOTO_SLOTS, TIME_CLOCK_DEVICE_PHOTO_SLOT]
    : MONTHLY_FLEET_PHOTO_SLOTS;

  if (!Array.isArray(photos)) {
    throw new BadRequestException(
      requiresTimeClockDevicePhoto
        ? 'As fotos obrigatorias da frota, incluindo o dispositivo de ponto, precisam ser enviadas no checklist mensal.'
        : 'As 5 fotos obrigatorias da frota precisam ser enviadas no checklist mensal.',
    );
  }

  const availableSlots = new Set(
    photos
      .map((photo) => {
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
          return null;
        }

        const entry = photo as Record<string, unknown>;
        return typeof entry.slot === 'string' &&
          typeof entry.photoUrl === 'string'
          ? entry.slot
          : null;
      })
      .filter((slot): slot is string => Boolean(slot)),
  );

  const missingSlots = requiredSlots.filter(
    (slot) => !availableSlots.has(slot),
  );

  if (missingSlots.length > 0) {
    throw new BadRequestException(
      missingSlots.includes(TIME_CLOCK_DEVICE_PHOTO_SLOT)
        ? 'A foto do dispositivo de ponto e obrigatoria para este veiculo.'
        : 'As fotos obrigatorias da frota precisam ser enviadas no checklist mensal.',
    );
  }
}

function getRepresentativeFleetPhotoUrl(
  photos: Prisma.InputJsonArray | undefined,
) {
  if (!Array.isArray(photos)) {
    return null;
  }

  const frontPhoto = photos.find((photo) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
      return false;
    }

    return (photo as Record<string, unknown>).slot === 'front';
  });
  const representative = frontPhoto ?? photos[0];

  if (
    !representative ||
    typeof representative !== 'object' ||
    Array.isArray(representative)
  ) {
    return null;
  }

  const photoUrl = (representative as Record<string, unknown>).photoUrl;

  return typeof photoUrl === 'string' ? photoUrl : null;
}
