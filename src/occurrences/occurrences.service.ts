import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OccurrenceSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';
import { ProgramOccurrenceDto } from './dto/program-occurrence.dto';
import { AddOccurrenceCommentDto } from './dto/add-occurrence-comment.dto';
import { CancelOccurrenceDto } from './dto/cancel-occurrence.dto';
import {
  AuthenticatedActor,
  resolveSupervisorFleetScope,
} from '../common/supervisor-fleet-scope';

const includeOccurrenceRelations = {
  vehicle: true,
  user: true,
  checklist: true,
  photos: true,
  comments: {
    orderBy: {
      createdAt: 'desc' as const,
    },
  },
};

type OccurrenceSnapshot = {
  status: string;
  localExecucao: string | null;
  responsavelUserId: string | null;
  dataEntrada: Date | null;
  dataPrevistaSaida: Date | null;
  entregaLimiteEm: Date | null;
  entregueEm: Date | null;
  entreguePorUserId: string | null;
  dataInicioExecucao: Date | null;
  dataConclusao: Date | null;
};

function hasPlanning(occurrence: OccurrenceSnapshot) {
  return !!(
    occurrence.localExecucao ||
    occurrence.responsavelUserId ||
    occurrence.dataEntrada ||
    occurrence.dataPrevistaSaida ||
    occurrence.entregaLimiteEm
  );
}

function isAwaitingDriverValidation(occurrence: OccurrenceSnapshot) {
  return (
    occurrence.status === 'REJECTED_SUPERVISOR' &&
    hasPlanning(occurrence) &&
    !!occurrence.responsavelUserId &&
    !!occurrence.dataConclusao
  );
}

function hasExecutionStarted(occurrence: OccurrenceSnapshot) {
  return (
    occurrence.status === 'IN_PROGRESS' ||
    !!occurrence.dataInicioExecucao ||
    !!occurrence.dataConclusao
  );
}

function toDate(value?: string | null) {
  return value ? new Date(value) : null;
}

function toSeverity(value?: string | null) {
  if (!value) {
    return undefined;
  }

  return Object.values(OccurrenceSeverity).includes(value as OccurrenceSeverity)
    ? (value as OccurrenceSeverity)
    : undefined;
}

function normalizeRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

function requiredText(value: string | null | undefined, field: string) {
  const normalized = (value || '').trim();
  if (!normalized) {
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  return normalized;
}

@Injectable()
export class OccurrencesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return [];
    }

    return this.prisma.occurrence.findMany({
      where: scope ? { vehicle: { is: scope } } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
      include: includeOccurrenceRelations,
    });
  }

  create(dto: CreateOccurrenceDto, userId?: string) {
    if (!dto.vehicleId) {
      throw new BadRequestException('vehicleId é obrigatório');
    }

    if (!userId) {
      throw new BadRequestException('Usuário autenticado não encontrado');
    }

    const isEmergency = dto.isEmergency === true;

    return this.prisma.occurrence.create({
      data: {
        vehicleId: dto.vehicleId,
        checklistId: dto.checklistId ?? undefined,
        questionId: dto.questionId ?? undefined,
        questionLabel:
          dto.questionLabel ?? (isEmergency ? 'Chamada de emergencia' : ''),
        description: dto.description ?? '',
        status: isEmergency ? 'APPROVED_SUPERVISOR' : 'PENDING_SUPERVISOR',
        severity:
          toSeverity(dto.severity) ?? (isEmergency ? 'HIGH' : undefined),
        isEmergency,
        // Emergencia define apenas o roteamento/aviso; a manutencao escolhe o executor depois.
        responsavelUserId: isEmergency ? null : (dto.responsavelUserId ?? null),
        maintenanceTargetUserId: isEmergency
          ? (dto.maintenanceTargetUserId ?? dto.responsavelUserId ?? null)
          : null,
        createdBy: userId,
        photos: dto.photos?.length
          ? {
              create: dto.photos.map((url) => ({
                url,
              })),
            }
          : undefined,
      },
      include: includeOccurrenceRelations,
    });
  }

  async approve(id: string) {
    const occurrence = await this.ensureExists(id);

    const nextStatus =
      occurrence.status === 'REJECTED_SUPERVISOR' && !!occurrence.dataConclusao
        ? 'RESOLVED'
        : 'APPROVED_SUPERVISOR';

    return this.prisma.occurrence.update({
      where: { id },
      data: {
        status: nextStatus,
      },
      include: includeOccurrenceRelations,
    });
  }

  async reject(id: string) {
    await this.ensureExists(id);

    return this.prisma.occurrence.update({
      where: { id },
      data: {
        status: 'REJECTED_SUPERVISOR',
      },
      include: includeOccurrenceRelations,
    });
  }

  async program(id: string, dto: ProgramOccurrenceDto) {
    const occurrence = await this.ensureExists(id);
    const requestedStartExecution =
      dto.dataInicioExecucao !== undefined
        ? toDate(dto.dataInicioExecucao)
        : undefined;
    const requestedDeliveredAt =
      dto.entregueEm !== undefined ? toDate(dto.entregueEm) : undefined;
    const requestedDeliveredBy =
      dto.entreguePorUserId !== undefined ? dto.entreguePorUserId : undefined;

    if (isAwaitingDriverValidation(occurrence) && requestedStartExecution) {
      throw new BadRequestException(
        'Ocorrência aguarda validação do motorista',
      );
    }

    const next: OccurrenceSnapshot = {
      status: occurrence.status,
      localExecucao:
        dto.localExecucao === undefined
          ? occurrence.localExecucao
          : dto.localExecucao,
      responsavelUserId:
        dto.responsavelUserId === undefined
          ? occurrence.responsavelUserId
          : dto.responsavelUserId,
      dataEntrada:
        dto.dataEntrada === undefined
          ? occurrence.dataEntrada
          : toDate(dto.dataEntrada),
      dataPrevistaSaida:
        dto.dataPrevistaSaida === undefined
          ? occurrence.dataPrevistaSaida
          : toDate(dto.dataPrevistaSaida),
      entregaLimiteEm:
        dto.entregaLimiteEm === undefined
          ? occurrence.entregaLimiteEm
          : toDate(dto.entregaLimiteEm),
      entregueEm:
        dto.entregueEm === undefined
          ? occurrence.entregueEm
          : toDate(dto.entregueEm),
      entreguePorUserId:
        dto.entreguePorUserId === undefined
          ? occurrence.entreguePorUserId
          : dto.entreguePorUserId,
      dataInicioExecucao:
        dto.dataInicioExecucao === undefined
          ? occurrence.dataInicioExecucao
          : toDate(dto.dataInicioExecucao),
      dataConclusao:
        dto.dataConclusao === undefined
          ? occurrence.dataConclusao
          : toDate(dto.dataConclusao),
    };

    if (hasExecutionStarted(occurrence) && !requestedStartExecution) {
      const isTryingToRegisterDelivery =
        requestedDeliveredAt !== undefined && requestedDeliveredAt !== null;
      const isTryingToAssignDeliveryUser =
        requestedDeliveredBy !== undefined && requestedDeliveredBy !== null;

      if (isTryingToRegisterDelivery || isTryingToAssignDeliveryUser) {
        throw new BadRequestException(
          'Entrega nao pode ser registrada apos o inicio da manutencao',
        );
      }
    }

    if (requestedStartExecution && !next.entregueEm) {
      next.entregueEm = requestedStartExecution;
    }

    const nextStatus = this.resolveProgramStatus(occurrence, next);

    return this.prisma.occurrence.update({
      where: { id },
      data: {
        localExecucao: next.localExecucao,
        responsavelUserId: next.responsavelUserId,
        dataEntrada: next.dataEntrada,
        dataPrevistaSaida: next.dataPrevistaSaida,
        entregaLimiteEm: next.entregaLimiteEm,
        entregueEm: next.entregueEm,
        entreguePorUserId: next.entreguePorUserId,
        dataInicioExecucao: next.dataInicioExecucao,
        dataConclusao: next.dataConclusao,
        status: nextStatus,
      },
      include: includeOccurrenceRelations,
    });
  }

  async addComment(
    id: string,
    dto: AddOccurrenceCommentDto,
    actor?: AuthenticatedActor | null,
  ) {
    const occurrence = await this.ensureExists(id);
    const user = await this.ensureMaintenanceActor(actor);
    const role = normalizeRole(actor?.role);

    if (
      role === 'manutentor' &&
      occurrence.responsavelUserId !== user.id
    ) {
      throw new ForbiddenException(
        'Somente o manutentor responsavel pode comentar esta ocorrencia',
      );
    }

    await this.prisma.occurrenceComment.create({
      data: {
        occurrenceId: id,
        authorId: user.id,
        authorName: user.name,
        text: requiredText(dto.text, 'Comentario'),
      },
    });

    return this.prisma.occurrence.findUnique({
      where: { id },
      include: includeOccurrenceRelations,
    });
  }

  async cancel(
    id: string,
    dto: CancelOccurrenceDto,
    actor?: AuthenticatedActor | null,
  ) {
    const occurrence = await this.ensureExists(id);
    const user = await this.ensureMaintenanceManager(actor);

    if (occurrence.status === 'CANCELLED') {
      throw new BadRequestException('Esta ocorrencia ja foi cancelada');
    }
    if (occurrence.status === 'RESOLVED') {
      throw new BadRequestException(
        'Uma ocorrencia encerrada nao pode ser cancelada',
      );
    }

    return this.prisma.occurrence.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelledByName: user.name,
        cancellationReason: requiredText(dto.reason, 'Motivo'),
      },
      include: includeOccurrenceRelations,
    });
  }

  private resolveProgramStatus(
    current: OccurrenceSnapshot,
    next: OccurrenceSnapshot,
  ) {
    if (current.status === 'CANCELLED' || current.status === 'RESOLVED') {
      return current.status;
    }

    if (next.dataInicioExecucao) {
      return 'IN_PROGRESS';
    }

    if (
      current.status === 'REJECTED_SUPERVISOR' &&
      !next.responsavelUserId &&
      hasPlanning(next)
    ) {
      return 'REJECTED_SUPERVISOR';
    }

    if (hasPlanning(next) && next.responsavelUserId) {
      return 'APPROVED_SUPERVISOR';
    }

    if (current.status === 'REJECTED_SUPERVISOR' && !hasPlanning(next)) {
      return 'REJECTED_SUPERVISOR';
    }

    if (current.status === 'PENDING_SUPERVISOR') {
      return 'PENDING_SUPERVISOR';
    }

    return 'APPROVED_SUPERVISOR';
  }

  private async ensureExists(id: string) {
    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id },
    });

    if (!occurrence) {
      throw new NotFoundException('Ocorrência não encontrada');
    }

    return occurrence;
  }

  private async ensureMaintenanceActor(actor?: AuthenticatedActor | null) {
    const role = normalizeRole(actor?.role);
    if (!['admin', 'administrador', 'manutencao', 'manutentor'].includes(role)) {
      throw new ForbiddenException(
        'Somente a equipe de manutencao pode comentar ocorrencias',
      );
    }
    if (!actor?.sub) {
      throw new ForbiddenException('Usuario autenticado nao encontrado');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { id: true, name: true, active: true },
    });
    if (!user?.active) {
      throw new ForbiddenException('Usuario ativo nao encontrado');
    }
    return user;
  }

  private async ensureMaintenanceManager(actor?: AuthenticatedActor | null) {
    const role = normalizeRole(actor?.role);
    if (!['admin', 'administrador', 'manutencao'].includes(role)) {
      throw new ForbiddenException(
        'Somente o responsavel pela manutencao pode cancelar ocorrencias',
      );
    }
    return this.ensureMaintenanceActor(actor);
  }
}
