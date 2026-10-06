import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const COMMUNICATION_TYPES = [
  'JOB',
  'NEWS',
  'ANNOUNCEMENT',
  'PROMOTION',
] as const;
const COMMUNICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const MANAGER_ROLES = ['admin', 'rh'];

type CommunicationType = (typeof COMMUNICATION_TYPES)[number];
type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

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

function optionalText(value: unknown) {
  const text = coerceText(value);
  return text || null;
}

function requiredText(value: unknown, fieldName: string) {
  const text = coerceText(value);
  if (!text) {
    throw new BadRequestException(`${fieldName} e obrigatorio`);
  }
  return text;
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  fieldName: string,
) {
  const normalized = (coerceText(value) || fallback).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new BadRequestException(`${fieldName} invalido`);
  }
  return normalized as T[number];
}

function optionalDate(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(coerceText(value));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} invalida`);
  }
  return date;
}

function canManage(role?: string | null) {
  return MANAGER_ROLES.includes(normalizeRole(role));
}

@Injectable()
export class HrCommunicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublic() {
    const now = new Date();
    const fifteenDaysAgo = new Date(now);
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    return this.prisma.hrCommunication.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [
          {
            OR: [{ endAt: null }, { endAt: { gte: now } }],
          },
          {
            OR: [
              { type: { not: 'PROMOTION' } },
              {
                type: 'PROMOTION',
                promotionDate: { gte: fifteenDaysAgo },
              },
            ],
          },
        ],
      },
      orderBy: [
        { priority: 'desc' },
        { startAt: 'desc' },
        { promotionDate: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findAll(actorRole?: string | null) {
    this.ensureCanManage(actorRole);

    return this.prisma.hrCommunication.findMany({
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async create(
    dto: Record<string, unknown>,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureCanManage(actorRole);
    const data = this.buildPayload(
      dto,
      true,
    ) as Prisma.HrCommunicationUncheckedCreateInput;

    return this.prisma.hrCommunication.create({
      data: {
        ...data,
        createdById: actorId || undefined,
      },
    });
  }

  async update(
    id: string,
    dto: Record<string, unknown>,
    actorRole?: string | null,
  ) {
    this.ensureCanManage(actorRole);
    const existing = await this.prisma.hrCommunication.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Comunicado nao encontrado');
    }

    const data = this.buildPayload(dto, false);

    return this.prisma.hrCommunication.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, actorRole?: string | null) {
    this.ensureCanManage(actorRole);
    const existing = await this.prisma.hrCommunication.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Comunicado nao encontrado');
    }

    return this.prisma.hrCommunication.delete({
      where: { id },
    });
  }

  private buildPayload(dto: Record<string, unknown>, isCreate: boolean) {
    const type = normalizeEnum(dto.type, COMMUNICATION_TYPES, 'NEWS', 'Tipo');
    const status = normalizeEnum(
      dto.status,
      COMMUNICATION_STATUSES,
      'DRAFT',
      'Status',
    );

    const title = requiredText(dto.title, 'Titulo');
    const payload: Prisma.HrCommunicationUncheckedCreateInput = {
      type,
      status,
      title,
      subtitle: optionalText(dto.subtitle),
      body: optionalText(dto.body),
      company: optionalText(dto.company),
      department: optionalText(dto.department),
      city: optionalText(dto.city),
      position: optionalText(dto.position),
      requirements: optionalText(dto.requirements),
      benefits: optionalText(dto.benefits),
      contact: optionalText(dto.contact),
      employeeName: optionalText(dto.employeeName),
      previousRole: optionalText(dto.previousRole),
      newRole: optionalText(dto.newRole),
      promotionDate: optionalDate(dto.promotionDate, 'Data da promocao'),
      imageUrl: optionalText(dto.imageUrl),
      priority: Boolean(dto.priority),
      startAt: optionalDate(dto.startAt, 'Inicio da exibicao'),
      endAt: optionalDate(dto.endAt, 'Fim da exibicao'),
    };

    if (type === 'JOB') {
      payload.position = requiredText(dto.position, 'Cargo');
      payload.company = requiredText(dto.company, 'Empresa');
      payload.contact = requiredText(dto.contact, 'Contato da vaga');
    }

    if (type === 'PROMOTION') {
      payload.employeeName = requiredText(dto.employeeName, 'Colaborador');
      payload.newRole = requiredText(dto.newRole, 'Novo cargo');
      payload.promotionDate = optionalDate(
        dto.promotionDate,
        'Data da promocao',
      );

      if (!payload.promotionDate) {
        throw new BadRequestException('Data da promocao e obrigatoria');
      }
    }

    if (payload.startAt && payload.endAt && payload.endAt < payload.startAt) {
      throw new BadRequestException('Fim da exibicao deve ser apos o inicio');
    }

    if (!isCreate) {
      return payload as Prisma.HrCommunicationUncheckedUpdateInput;
    }

    return payload;
  }

  private ensureCanManage(role?: string | null) {
    if (!canManage(role)) {
      throw new ForbiddenException('Sem permissao para gerenciar comunicados');
    }
  }
}
