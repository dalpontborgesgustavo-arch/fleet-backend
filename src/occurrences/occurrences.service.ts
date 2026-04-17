import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OccurrenceSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';
import { ProgramOccurrenceDto } from './dto/program-occurrence.dto';

const includeOccurrenceRelations = {
  vehicle: true,
  user: true,
  checklist: true,
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

@Injectable()
export class OccurrencesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.occurrence.findMany({
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

    return this.prisma.occurrence.create({
      data: {
        vehicleId: dto.vehicleId,
        checklistId: dto.checklistId ?? undefined,
        questionId: dto.questionId ?? undefined,
        questionLabel: dto.questionLabel ?? '',
        description: dto.description ?? '',
        status: 'PENDING_SUPERVISOR',
        severity: toSeverity(dto.severity),
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
      dto.dataInicioExecucao !== undefined && toDate(dto.dataInicioExecucao);

    if (isAwaitingDriverValidation(occurrence) && requestedStartExecution) {
      throw new BadRequestException('Ocorrência aguarda validação do motorista');
    }

    const next: OccurrenceSnapshot = {
      status: occurrence.status,
      localExecucao: dto.localExecucao === undefined ? occurrence.localExecucao : dto.localExecucao,
      responsavelUserId:
        dto.responsavelUserId === undefined ? occurrence.responsavelUserId : dto.responsavelUserId,
      dataEntrada: dto.dataEntrada === undefined ? occurrence.dataEntrada : toDate(dto.dataEntrada),
      dataPrevistaSaida:
        dto.dataPrevistaSaida === undefined ? occurrence.dataPrevistaSaida : toDate(dto.dataPrevistaSaida),
      entregaLimiteEm:
        dto.entregaLimiteEm === undefined ? occurrence.entregaLimiteEm : toDate(dto.entregaLimiteEm),
      entregueEm: dto.entregueEm === undefined ? occurrence.entregueEm : toDate(dto.entregueEm),
      entreguePorUserId:
        dto.entreguePorUserId === undefined ? occurrence.entreguePorUserId : dto.entreguePorUserId,
      dataInicioExecucao:
        dto.dataInicioExecucao === undefined ? occurrence.dataInicioExecucao : toDate(dto.dataInicioExecucao),
      dataConclusao:
        dto.dataConclusao === undefined ? occurrence.dataConclusao : toDate(dto.dataConclusao),
    };

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

  private resolveProgramStatus(current: OccurrenceSnapshot, next: OccurrenceSnapshot) {
    if (current.status === 'CANCELLED' || current.status === 'RESOLVED') {
      return current.status;
    }

    if (next.dataInicioExecucao) {
      return 'IN_PROGRESS';
    }

    if (current.status === 'REJECTED_SUPERVISOR' && !next.responsavelUserId && hasPlanning(next)) {
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
}
