import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OccurrenceSeverity, OccurrenceStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';
import { ProgramOccurrenceDto } from './dto/program-occurrence.dto';
import { AddOccurrenceCommentDto } from './dto/add-occurrence-comment.dto';
import { CancelOccurrenceDto } from './dto/cancel-occurrence.dto';
import { ValidateOccurrenceDto } from './dto/validate-occurrence.dto';
import { S3UploadService } from '../storage/s3-upload.service';
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

function normalizeChecklistQuestion(value?: string | null) {
  return (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

@Injectable()
export class OccurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3UploadService,
  ) {}

  async findPendingValidation(vehicleId: string, actor?: AuthenticatedActor | null) {
    await this.ensureActiveChecklistUser(actor, vehicleId);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, active: true, checklistEnabled: true },
      select: { id: true },
    });
    if (!vehicle) throw new NotFoundException('Veiculo indisponivel para checklist');
    return this.prisma.occurrence.findMany({
      where: {
        vehicleId,
        status: 'REJECTED_SUPERVISOR',
        responsavelUserId: { not: null },
        dataConclusao: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        vehicleId: true,
        questionLabel: true,
        description: true,
        dataConclusao: true,
        status: true,
      },
    });
  }

  async validate(id: string, dto: ValidateOccurrenceDto, actor?: AuthenticatedActor | null) {
    const candidate = await this.prisma.occurrence.findUnique({
      where: { id },
      select: { vehicleId: true },
    });
    if (!candidate) throw new NotFoundException('Ocorrencia nao encontrada');
    const user = await this.ensureActiveChecklistUser(actor, candidate.vehicleId);
    const decision = dto?.decision;
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException('Informe se a manutencao foi aprovada ou reprovada');
    }
    const photoUrl = requiredText(dto.photoUrl, 'Foto de comprovacao');
    if (!/^\/uploads\/upload-\d+-[\da-f-]+\.(jpe?g|png|webp|heic)$/i.test(photoUrl)) {
      throw new BadRequestException('Envie uma foto pelo sistema antes de validar');
    }
    if (!(await this.storage.imageExists(photoUrl.slice('/uploads/'.length)))) {
      throw new BadRequestException('A foto de comprovacao nao foi encontrada no armazenamento');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.occurrence.findUnique({
        where: { id },
        select: { vehicleId: true },
      });
      if (!current) throw new NotFoundException('Ocorrencia nao encontrada');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${current.vehicleId}, 0))::text AS lock_result`;
      const occurrence = await tx.occurrence.findUnique({ where: { id } });
      if (!occurrence || !isAwaitingDriverValidation(occurrence)) {
        throw new ConflictException('Esta ocorrencia nao aguarda validacao');
      }
      const vehicle = await tx.vehicle.findFirst({
        where: { id: occurrence.vehicleId, active: true, checklistEnabled: true },
        select: { id: true },
      });
      if (!vehicle) throw new ForbiddenException('Veiculo indisponivel para checklist');

      const updated = await tx.occurrence.updateMany({
        where: {
          id,
          status: 'REJECTED_SUPERVISOR',
          responsavelUserId: { not: null },
          dataConclusao: { not: null },
        },
        data: decision === 'APPROVED'
          ? { status: 'RESOLVED' }
          : {
              status: 'REJECTED_SUPERVISOR',
              entregueEm: null,
              entreguePorUserId: null,
              responsavelUserId: null,
              dataInicioExecucao: null,
              dataConclusao: null,
            },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Esta ocorrencia foi alterada. Atualize e tente novamente');
      }
      await tx.$executeRaw`
        INSERT INTO "OccurrenceValidation"
          ("id", "occurrenceId", "decision", "photoUrl", "validatedByUserId", "validatedByName")
        VALUES (${randomUUID()}, ${id}, ${decision}, ${photoUrl}, ${user.id}, ${user.name})
      `;
      return tx.occurrence.findUnique({
        where: { id },
        include: includeOccurrenceRelations,
      });
    });
  }

  async findAll(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);
    const assignedExecutorFilter =
      actor?.canExecuteMaintenance === true && actor.sub
        ? { responsavelUserId: actor.sub }
        : null;

    if (scope === null && !assignedExecutorFilter) {
      return [];
    }

    const where = assignedExecutorFilter
      ? scope
        ? { OR: [{ vehicle: { is: scope } }, assignedExecutorFilter] }
        : assignedExecutorFilter
      : scope
        ? { vehicle: { is: scope } }
        : undefined;

    return this.prisma.occurrence.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: includeOccurrenceRelations,
    });
  }

  async findMyMaintenance(actor?: AuthenticatedActor | null) {
    const user = await this.ensureMaintenanceActor(actor);
    if (!['admin', 'administrador', 'manutencao', 'manutentor'].includes(normalizeRole(actor?.role)) &&
      user.canExecuteMaintenance !== true) {
      throw new ForbiddenException('Acesso de execucao de manutencao revogado');
    }
    return this.prisma.occurrence.findMany({
      where: {
        responsavelUserId: user.id,
        status: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: includeOccurrenceRelations,
    });
  }

  async transitionAssignedExecution(
    id: string,
    action?: 'START' | 'COMPLETE',
    actor?: AuthenticatedActor | null,
  ) {
    const user = await this.ensureMaintenanceActor(actor);
    if (!['admin', 'administrador', 'manutencao', 'manutentor'].includes(normalizeRole(actor?.role)) &&
      user.canExecuteMaintenance !== true) {
      throw new ForbiddenException('Acesso de execucao de manutencao revogado');
    }
    if (action !== 'START' && action !== 'COMPLETE') {
      throw new BadRequestException('Informe START ou COMPLETE');
    }
    const candidate = await this.prisma.occurrence.findUnique({
      where: { id },
      select: { vehicleId: true },
    });
    if (!candidate) throw new NotFoundException('Ocorrencia nao encontrada');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.vehicleId}, 0))::text AS lock_result`;
      const occurrence = await tx.occurrence.findUnique({ where: { id } });
      if (!occurrence) throw new NotFoundException('Ocorrencia nao encontrada');
      if (occurrence.responsavelUserId !== user.id) {
        throw new ForbiddenException('Somente o responsavel designado pode alterar esta manutencao');
      }
      if (occurrence.status === 'CANCELLED' || occurrence.status === 'RESOLVED') {
        throw new ConflictException('Esta ocorrencia ja foi encerrada');
      }

      const now = new Date();
      if (action === 'START') {
        if (occurrence.dataInicioExecucao || occurrence.dataConclusao ||
          !['APPROVED_SUPERVISOR', 'REJECTED_SUPERVISOR'].includes(occurrence.status)) {
          throw new ConflictException('Esta manutencao nao esta pronta para iniciar');
        }
        const changed = await tx.occurrence.updateMany({
          where: {
            id,
            responsavelUserId: user.id,
            dataInicioExecucao: null,
            dataConclusao: null,
            status: { in: ['APPROVED_SUPERVISOR', 'REJECTED_SUPERVISOR'] },
          },
          data: {
            dataInicioExecucao: now,
            entregueEm: occurrence.entregueEm ?? now,
            status: 'IN_PROGRESS',
          },
        });
        if (changed.count !== 1) throw new ConflictException('A manutencao mudou. Atualize a lista');
      } else {
        if (!occurrence.dataInicioExecucao || occurrence.dataConclusao || occurrence.status !== 'IN_PROGRESS') {
          throw new ConflictException('Inicie a manutencao antes de marcar como resolvida');
        }
        const changed = await tx.occurrence.updateMany({
          where: {
            id,
            responsavelUserId: user.id,
            status: 'IN_PROGRESS',
            dataConclusao: null,
          },
          data: {
            dataConclusao: now,
            status: 'REJECTED_SUPERVISOR',
          },
        });
        if (changed.count !== 1) throw new ConflictException('A manutencao mudou. Atualize a lista');
      }

      return tx.occurrence.findUnique({
        where: { id },
        include: includeOccurrenceRelations,
      });
    });
  }

  async create(dto: CreateOccurrenceDto, userId?: string) {
    if (!dto.vehicleId) {
      throw new BadRequestException('vehicleId é obrigatório');
    }

    if (!userId) {
      throw new BadRequestException('Usuário autenticado não encontrado');
    }

    const vehicleId = dto.vehicleId;
    const isEmergency = dto.isEmergency === true;

    const data: Prisma.OccurrenceUncheckedCreateInput = {
        vehicleId,
        checklistId: dto.checklistId ?? undefined,
        questionId: dto.questionId ?? undefined,
        questionLabel:
          dto.questionLabel ?? (isEmergency ? 'Chamada de emergencia' : ''),
        description: dto.description ?? '',
        status: isEmergency ? OccurrenceStatus.APPROVED_SUPERVISOR : OccurrenceStatus.PENDING_SUPERVISOR,
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
    };

    if (!dto.checklistId || isEmergency) {
      return this.prisma.occurrence.create({ data, include: includeOccurrenceRelations });
    }

    return this.prisma.$transaction(async (tx) => {
      const checklist = await tx.checklist.findUnique({
        where: { id: dto.checklistId! },
        select: { type: true, vehicleId: true },
      });
      if (!checklist || checklist.vehicleId !== vehicleId) {
        throw new BadRequestException('Checklist e frota incompatíveis');
      }
      if (checklist.type !== 'MONTHLY') {
        return tx.occurrence.create({ data, include: includeOccurrenceRelations });
      }

      // Serialize submissions for the vehicle, including concurrent retries of the same checklist.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${vehicleId}, 0))::text AS lock_result`;
      const openOccurrences = await tx.occurrence.findMany({
        where: {
          vehicleId,
          isEmergency: false,
          status: { notIn: ['RESOLVED', 'CANCELLED'] },
        },
        select: { id: true, questionId: true, questionLabel: true },
      });
      const label = normalizeChecklistQuestion(dto.questionLabel);
      const existing = openOccurrences.find(
        (occurrence) =>
          (dto.questionId && occurrence.questionId === dto.questionId) ||
          (label && normalizeChecklistQuestion(occurrence.questionLabel) === label),
      );
      if (existing) {
        throw new ConflictException({
          code: 'OCCURRENCE_ALREADY_OPEN',
          occurrenceId: existing.id,
          message: 'Já existe uma ocorrência aberta para esta frota e pergunta.',
        });
      }
      return tx.occurrence.create({ data, include: includeOccurrenceRelations });
    });
  }

  async approve(id: string) {
    const occurrence = await this.ensureExists(id);

    if (process.env.REQUIRE_CHECKLIST_VALIDATION_PHOTO === 'true' && isAwaitingDriverValidation(occurrence)) {
      throw new BadRequestException('Valide a manutencao no checklist com foto de comprovacao');
    }

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

    if (process.env.REQUIRE_CHECKLIST_VALIDATION_PHOTO === 'true' && isAwaitingDriverValidation(occurrence)) {
      throw new BadRequestException('Valide a manutencao no checklist com foto de comprovacao');
    }

    if (dto.responsavelUserId) {
      const executor = await this.prisma.user.findUnique({
        where: { id: dto.responsavelUserId },
        select: {
          active: true,
          role: true,
          canExecuteMaintenance: true,
        },
      });
      const executorRole = normalizeRole(executor?.role);
      if (
        !executor?.active ||
        (!['manutentor', 'manutencao'].includes(executorRole) &&
          !executor.canExecuteMaintenance)
      ) {
        throw new BadRequestException(
          'O responsavel selecionado nao esta habilitado para executar manutencoes',
        );
      }
    }

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

  async updatePriority(
    id: string,
    value?: string | null,
    actor?: AuthenticatedActor | null,
  ) {
    const occurrence = await this.ensureExists(id);
    const user = await this.ensureMaintenanceActor(actor);
    const role = normalizeRole(actor?.role);
    const severity = toSeverity(value);

    if (!severity) {
      throw new BadRequestException('Prioridade deve ser alta, media ou baixa');
    }
    if (occurrence.status === 'RESOLVED' || occurrence.status === 'CANCELLED') {
      throw new BadRequestException(
        'Nao e possivel alterar a prioridade de uma ocorrencia encerrada',
      );
    }
    if (
      !['admin', 'administrador', 'manutencao'].includes(role) &&
      occurrence.responsavelUserId !== user.id
    ) {
      throw new ForbiddenException(
        'Somente o manutentor responsavel pode alterar esta prioridade',
      );
    }

    return this.prisma.occurrence.update({
      where: { id },
      data: { severity },
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
      (role === 'manutentor' || user.canExecuteMaintenance) &&
      occurrence.responsavelUserId !== user.id
    ) {
      throw new ForbiddenException(
        'Somente o responsavel pela execucao pode comentar esta ocorrencia',
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

  private async ensureActiveChecklistUser(actor?: AuthenticatedActor | null, vehicleId?: string) {
    if (!actor?.sub) throw new ForbiddenException('Usuario autenticado nao encontrado');
    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { id: true, name: true, role: true, active: true },
    });
    if (!user?.active) throw new ForbiddenException('Usuario ativo nao encontrado');
    if (!['admin', 'administrador', 'motorista', 'operador', 'supervisor', 'supervisor_apoio'].includes(normalizeRole(user.role))) {
      const monthlyAssignment = vehicleId && await this.prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          active: true,
          checklistEnabled: true,
          monthlyChecklistResponsibleId: user.id,
        },
        select: { id: true },
      });
      if (!monthlyAssignment) throw new ForbiddenException('Perfil sem acesso a checklist deste veiculo');
    }
    return user;
  }

  private async ensureMaintenanceActor(actor?: AuthenticatedActor | null) {
    const role = normalizeRole(actor?.role);
    if (
      !['admin', 'administrador', 'manutencao', 'manutentor'].includes(role) &&
      actor?.canExecuteMaintenance !== true
    ) {
      throw new ForbiddenException(
        'Somente a equipe de manutencao pode comentar ocorrencias',
      );
    }
    if (!actor?.sub) {
      throw new ForbiddenException('Usuario autenticado nao encontrado');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: {
        id: true,
        name: true,
        active: true,
        canExecuteMaintenance: true,
      },
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
