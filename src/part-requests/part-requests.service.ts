import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PartRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartRequestDto } from './dto/create-part-request.dto';
import { ReviewPartRequestDto } from './dto/review-part-request.dto';
import { RespondPartRequestDto } from './dto/respond-part-request.dto';

const includePartRequestRelations = {
  occurrence: {
    include: {
      vehicle: true,
      checklist: true,
    },
  },
};

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

type OccurrenceSnapshot = {
  status: string;
  localExecucao: string | null;
  responsavelUserId: string | null;
  dataEntrada: Date | null;
  dataPrevistaSaida: Date | null;
  entregaLimiteEm: Date | null;
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

function canRequestPartsForOccurrence(occurrence: OccurrenceSnapshot) {
  if (occurrence.status === 'PENDING_SUPERVISOR') return false;
  if (occurrence.status === 'RESOLVED') return false;
  if (occurrence.status === 'CANCELLED') return false;
  if (isAwaitingDriverValidation(occurrence)) return false;
  return true;
}

@Injectable()
export class PartRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(actorRole?: string | null, actorId?: string | null, occurrenceId?: string) {
    const role = normalizeRole(actorRole);

    const where: any = {};

    if (occurrenceId) {
      where.occurrenceId = occurrenceId;
    }

    if (role === 'manutentor' && actorId) {
      where.OR = [
        { requestedByUserId: actorId },
        { occurrence: { responsavelUserId: actorId } },
      ];
    }

    return this.prisma.partRequest.findMany({
      where,
      orderBy: {
        requestedAt: 'desc',
      },
      include: includePartRequestRelations,
    });
  }

  async create(dto: CreatePartRequestDto, actorId?: string | null, actorRole?: string | null) {
    const role = normalizeRole(actorRole);

    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    if (role !== 'manutentor' && role !== 'admin') {
      throw new ForbiddenException('Somente manutentor pode abrir solicitacao de peca');
    }

    if (!dto.occurrenceId) {
      throw new BadRequestException('occurrenceId e obrigatorio');
    }

    if (!dto.description?.trim()) {
      throw new BadRequestException('Descricao da peca e obrigatoria');
    }

    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: dto.occurrenceId },
    });

    if (!occurrence) {
      throw new NotFoundException('Ocorrencia nao encontrada');
    }

    if (!canRequestPartsForOccurrence(occurrence)) {
      throw new BadRequestException('Esta manutencao nao aceita solicitacao de peca nesta etapa');
    }

    if (role === 'manutentor' && occurrence.responsavelUserId !== actorId) {
      throw new ForbiddenException('Somente o manutentor responsavel pode abrir esta solicitacao');
    }

    return this.prisma.partRequest.create({
      data: {
        occurrenceId: dto.occurrenceId,
        description: dto.description.trim(),
        quantity: dto.quantity && dto.quantity > 0 ? dto.quantity : 1,
        notes: dto.notes?.trim() || null,
        requestedByUserId: actorId,
        status: PartRequestStatus.PENDING_MAINTENANCE_APPROVAL,
      },
      include: includePartRequestRelations,
    });
  }

  async approveMaintenance(id: string, actorId?: string | null, actorRole?: string | null) {
    this.ensureMaintenanceRole(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const request = await this.ensureExists(id);
    if (request.status !== PartRequestStatus.PENDING_MAINTENANCE_APPROVAL) {
      throw new BadRequestException('Solicitacao nao esta pendente de aprovacao da manutencao');
    }

    return this.prisma.partRequest.update({
      where: { id },
      data: {
        status: PartRequestStatus.APPROVED_FOR_PURCHASING,
        approvedByUserId: actorId,
        approvedAt: new Date(),
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionReason: null,
      },
      include: includePartRequestRelations,
    });
  }

  async rejectMaintenance(id: string, dto: ReviewPartRequestDto, actorId?: string | null, actorRole?: string | null) {
    this.ensureMaintenanceRole(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const request = await this.ensureExists(id);
    if (request.status !== PartRequestStatus.PENDING_MAINTENANCE_APPROVAL) {
      throw new BadRequestException('Solicitacao nao esta pendente de aprovacao da manutencao');
    }

    return this.prisma.partRequest.update({
      where: { id },
      data: {
        status: PartRequestStatus.REJECTED_MAINTENANCE,
        rejectedByUserId: actorId,
        rejectedAt: new Date(),
        rejectionReason: dto.rejectionReason?.trim() || null,
      },
      include: includePartRequestRelations,
    });
  }

  async respondPurchase(id: string, dto: RespondPartRequestDto, actorId?: string | null, actorRole?: string | null) {
    const role = normalizeRole(actorRole);

    if (role !== 'compras' && role !== 'admin') {
      throw new ForbiddenException('Somente compras pode devolver a solicitacao');
    }

    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    if (!dto.purchaseOrder?.trim()) {
      throw new BadRequestException('OC e obrigatoria');
    }

    if (!dto.expectedDeliveryAt) {
      throw new BadRequestException('Data prevista de entrega e obrigatoria');
    }

    const request = await this.ensureExists(id);
    if (request.status !== PartRequestStatus.APPROVED_FOR_PURCHASING) {
      throw new BadRequestException('Solicitacao ainda nao foi liberada para compras');
    }

    return this.prisma.partRequest.update({
      where: { id },
      data: {
        status: PartRequestStatus.PURCHASED,
        purchaseOrder: dto.purchaseOrder.trim(),
        expectedDeliveryAt: new Date(dto.expectedDeliveryAt),
        purchasingNotes: dto.purchasingNotes?.trim() || null,
        purchasedByUserId: actorId,
        purchasedAt: new Date(),
      },
      include: includePartRequestRelations,
    });
  }

  private ensureMaintenanceRole(role?: string | null) {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole !== 'manutencao' && normalizedRole !== 'admin') {
      throw new ForbiddenException('Somente manutencao pode aprovar a solicitacao');
    }
  }

  private async ensureExists(id: string) {
    const request = await this.prisma.partRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Solicitacao de peca nao encontrada');
    }

    return request;
  }
}
