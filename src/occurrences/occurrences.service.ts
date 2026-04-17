import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';

@Injectable()
export class OccurrencesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOccurrenceDto, userId: string) {
    return this.prisma.occurrence.create({
      data: {
        vehicleId: dto.vehicleId,
        checklistId: dto.checklistId,
        questionId: dto.questionId,
        questionLabel: dto.questionLabel,
        description: dto.description,
        status: 'PENDING_SUPERVISOR',
        severity: dto.severity ?? 'MEDIUM',
        createdBy: userId,
        photos: {
          create: (dto.photos ?? []).map((url) => ({
            url,
          })),
        },
      },
      include: {
        photos: true,
        vehicle: true,
        user: true,
      },
    });
  }

  async findAll() {
    return this.prisma.occurrence.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        photos: true,
        vehicle: true,
        user: true,
        checklist: true,
      },
    });
  }

  async findByVehicle(vehicleId: string) {
    return this.prisma.occurrence.findMany({
      where: {
        vehicleId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        photos: true,
        user: true,
        checklist: true,
        vehicle: true,
      },
    });
  }

  async approve(id: string) {
    return this.prisma.occurrence.update({
      where: { id },
      data: { status: 'APPROVED_SUPERVISOR' },
      include: {
        photos: true,
        vehicle: true,
        user: true,
        checklist: true,
      },
    });
  }

  async reject(id: string) {
    return this.prisma.occurrence.update({
      where: { id },
      data: { status: 'REJECTED_SUPERVISOR' },
      include: {
        photos: true,
        vehicle: true,
        user: true,
        checklist: true,
      },
    });
  }
  async program(id: string, data: any) {
  return this.prisma.occurrence.update({
    where: { id },
    data: {
      status: 'IN_PROGRESS',
      localExecucao: data.localExecucao ?? null,
      responsavelUserId: data.responsavelUserId ?? null,
      dataEntrada: data.dataEntrada ? new Date(data.dataEntrada) : null,
      dataPrevistaSaida: data.dataPrevistaSaida ? new Date(data.dataPrevistaSaida) : null,
    },
    include: {
      photos: true,
      vehicle: true,
      user: true,
      checklist: true,
    },
  });
}
}
