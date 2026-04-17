import { Injectable, NotFoundException } from '@nestjs/common';
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
  dataInicioExecucao: Date | null;
  dataConclusao: Date | null;
};

function hasPlanning(occurrence: OccurrenceSnapshot) {
  return !!(
    occurrence.localExecucao ||
    occurrence.responsavelUserId ||
    occurrence.dataEntrada ||
    occurrence.dataPrevistaSaida
  );
}

function toDate(value?: string | null) {
  return value ? new Date(value) : null;
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
    return this.prisma.occurrence.create({
      data: {
        vehicleId: dto.vehicleId ?? null,
        checklistId: dto.checklistId ?? null,
        questionId: dto.questionId ?? null,
        questionLabel: dto.questionLabel ?? null,
        description: dto.description ?? null,
        status: 'PENDING_SUPERVISOR',
        severity: dto.severity ?? null,
        createdBy: userId ?? null,
        photos: dto.photos ?? [],
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

    const next: OccurrenceSnapshot = {
      status: occurrence.status,
      localExecucao: dto.localExecucao === undefined ? occurrence.localExecucao : dto.localExecucao,
      responsavelUserId:
        dto.responsavelUserId === undefined ? occurrence.responsavelUserId : dto.responsavelUserId,
      dataEntrada: dto.dataEntrada === undefined ? occurrence.dataEntrada : toDate(dto.dataEntrada),
      dataPrevistaSaida:
        dto.dataPrevistaSaida === undefined ? occurrence.dataPrevistaSaida : toDate(dto.dataPrevistaSaida),
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
