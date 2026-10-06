import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const includeArrivalRelations = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
};

const BRASILIA_OFFSET = '-03:00';

type TopographyArrivalWithUser = Prisma.TopographyArrivalGetPayload<{
  include: typeof includeArrivalRelations;
}>;

interface TopographyArrivalInput {
  obra?: unknown;
  city?: unknown;
  locationUrl?: unknown;
  locationLatitude?: unknown;
  locationLongitude?: unknown;
  photoUrl?: unknown;
  workDate?: unknown;
  arrivalAt?: unknown;
  arrivalTime?: unknown;
  justification?: unknown;
}

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function trimRequired(value: unknown, fieldName: string) {
  const text = coerceText(value);
  if (!text) {
    throw new BadRequestException(`${fieldName} e obrigatorio`);
  }
  return text;
}

function normalizeOptionalText(value: unknown) {
  const text = coerceText(value);
  return text || null;
}

function normalizeOptionalCoordinate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const coordinate =
    typeof value === 'number' ? value : Number(coerceText(value));

  if (!Number.isFinite(coordinate)) {
    throw new BadRequestException(`${fieldName} invalida`);
  }

  return coordinate;
}

function formatBrasiliaWorkDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getBrasiliaTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((part) => part.type === 'minute')?.value ?? 0),
  };
}

function appendBrasiliaOffsetIfNeeded(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return value;
  }

  return `${value}${BRASILIA_OFFSET}`;
}

function normalizeWorkDate(value: unknown, arrivalAt: Date) {
  const text = coerceText(value);
  if (text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new BadRequestException('Data do registro invalida');
    }
    return text;
  }

  return formatBrasiliaWorkDate(arrivalAt);
}

function parseArrivalAt(value: unknown) {
  if (!value) {
    return new Date();
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          typeof value === 'string'
            ? appendBrasiliaOffsetIfNeeded(value)
            : appendBrasiliaOffsetIfNeeded(coerceText(value)),
        );
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Hora de chegada invalida');
  }

  return date;
}

function parseArrivalMinutes(data: TopographyArrivalInput, arrivalAt: Date) {
  const explicitTime = coerceText(data.arrivalTime);
  if (/^\d{2}:\d{2}$/.test(explicitTime)) {
    const [hours, minutes] = explicitTime.split(':').map(Number);
    return hours * 60 + minutes;
  }

  const rawArrivalAt = coerceText(data.arrivalAt);
  const timeMatch = rawArrivalAt.match(/T(\d{2}):(\d{2})/);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  const brTime = getBrasiliaTimeParts(arrivalAt);
  return brTime.hour * 60 + brTime.minute;
}

function normalizeJustification(value: unknown, isLate: boolean) {
  const text = coerceText(value);
  if (isLate && !text) {
    throw new BadRequestException(
      'Justificativa e obrigatoria para chegadas depois das 08:00',
    );
  }

  return text || null;
}

@Injectable()
export class TopographyArrivalsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(actorRole?: string | null, actorId?: string | null) {
    const role = normalizeRole(actorRole);
    const where: Prisma.TopographyArrivalWhereInput = {};

    if (role === 'topografia') {
      if (!actorId) {
        throw new BadRequestException('Usuario autenticado nao encontrado');
      }
      where.userId = actorId;
    } else if (role !== 'admin') {
      throw new ForbiddenException(
        'Sem permissao para acessar registros de topografia',
      );
    }

    const records = await this.prisma.topographyArrival.findMany({
      where,
      orderBy: [{ workDate: 'desc' }, { arrivalAt: 'desc' }],
      take: 60,
      include: includeArrivalRelations,
    });

    return records.map((record) => this.serialize(record));
  }

  async saveToday(
    data: TopographyArrivalInput,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    if (normalizeRole(actorRole) !== 'topografia') {
      throw new ForbiddenException('Somente Topografia pode registrar chegada');
    }

    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const obra = trimRequired(data?.obra, 'Obra');
    const city = normalizeOptionalText(data?.city);
    const locationUrl = normalizeOptionalText(data?.locationUrl);
    const locationLatitude = normalizeOptionalCoordinate(
      data?.locationLatitude,
      'Latitude',
    );
    const locationLongitude = normalizeOptionalCoordinate(
      data?.locationLongitude,
      'Longitude',
    );
    const photoUrl = normalizeOptionalText(data?.photoUrl);
    const arrivalAt = parseArrivalAt(data?.arrivalAt);
    const workDate = normalizeWorkDate(data?.workDate, arrivalAt);
    const isLateArrival = parseArrivalMinutes(data, arrivalAt) > 8 * 60;
    const justification = normalizeJustification(
      data?.justification,
      isLateArrival,
    );

    const record = await this.prisma.topographyArrival.upsert({
      where: {
        userId_workDate: {
          userId: actorId,
          workDate,
        },
      },
      update: {
        obra,
        city,
        locationUrl,
        locationLatitude,
        locationLongitude,
        photoUrl,
        arrivalAt,
        justification,
      },
      create: {
        userId: actorId,
        workDate,
        obra,
        city,
        locationUrl,
        locationLatitude,
        locationLongitude,
        photoUrl,
        arrivalAt,
        justification,
      },
      include: includeArrivalRelations,
    });

    return this.serialize(record);
  }

  private serialize(record: TopographyArrivalWithUser) {
    return record;
  }
}
