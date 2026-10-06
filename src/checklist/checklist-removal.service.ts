import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { setVehicleAuditContext } from '../vehicles/vehicle-audit-context';

type Database = PrismaService | Prisma.TransactionClient;
type VehicleField = 'photoUrl' | 'currentDriverName' | 'currentResponsibleName';
type Actor = { sub?: string; role?: string; name?: string; email?: string };

const VEHICLE_FIELDS: VehicleField[] = [
  'photoUrl',
  'currentDriverName',
  'currentResponsibleName',
];

@Injectable()
export class ChecklistRemovalService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: Record<string, unknown>) {
    const fleet = cleanText(query.fleet, 40);
    const date = cleanText(query.date, 10);
    const author = cleanText(query.author, 100);
    if (!fleet) throw new BadRequestException('Informe o numero da frota.');
    if (date && !isValidDay(date)) {
      throw new BadRequestException('Informe a data no formato AAAA-MM-DD.');
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { fleet: { equals: fleet, mode: 'insensitive' } },
      select: { id: true, fleet: true, plate: true, name: true },
    });
    if (!vehicles.length) return { items: [], truncated: false };

    const utcDay = date ? new Date(`${date}T00:00:00Z`) : null;
    const rows = await this.prisma.checklist.findMany({
      where: {
        vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
        ...(utcDay
          ? {
              createdAt: {
                gte: new Date(utcDay.getTime() - 24 * 60 * 60 * 1000),
                lt: new Date(utcDay.getTime() + 48 * 60 * 60 * 1000),
              },
            }
          : {}),
        ...(author
          ? {
              user: {
                name: { contains: author, mode: 'insensitive' as const },
              },
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        vehicleId: true,
        type: true,
        status: true,
        createdAt: true,
        month: true,
        year: true,
        user: { select: { name: true } },
        _count: { select: { items: true, occurrences: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 201,
    });

    const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const matching = rows.filter(
      (row) => !date || saoPauloDate(row.createdAt) === date,
    );
    return {
      truncated: matching.length > 200,
      items: matching.slice(0, 200).map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        createdAt: row.createdAt,
        month: row.month,
        year: row.year,
        authorName: row.user.name,
        fleet: byId.get(row.vehicleId || '')?.fleet || '',
        plate: byId.get(row.vehicleId || '')?.plate || '',
        vehicleName: byId.get(row.vehicleId || '')?.name || '',
        itemCount: row._count.items,
        occurrenceCount: row._count.occurrences,
      })),
    };
  }

  async preview(id: string) {
    const snapshot = await readSnapshot(this.prisma, id);
    return buildChecklistRemovalPreview(snapshot);
  }

  async remove(
    id: string,
    body: {
      expectedFingerprint?: unknown;
      confirmationFleet?: unknown;
      reason?: unknown;
    },
    actor: Actor,
  ) {
    const expectedFingerprint =
      typeof body?.expectedFingerprint === 'string'
        ? body.expectedFingerprint.trim()
        : '';
    const confirmationFleet = cleanText(body?.confirmationFleet, 40);
    const reason = cleanText(body?.reason, 500);
    if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
      throw new BadRequestException('Reabra a previa antes de confirmar.');
    }
    if (reason.length < 10) {
      throw new BadRequestException(
        'Descreva o motivo em pelo menos 10 caracteres.',
      );
    }
    if (actor.role?.trim().toLowerCase() !== 'admin') {
      throw new ForbiddenException(
        'Somente o perfil Administrador pode excluir checklists.',
      );
    }
    if (!actor.sub)
      throw new BadRequestException('Usuario autenticado nao identificado.');

    const target = await this.prisma.checklist.findUnique({
      where: { id },
      select: { vehicleId: true },
    });
    if (!target?.vehicleId)
      throw new NotFoundException('Checklist nao encontrado.');
    const vehicleId = target.vehicleId;

    return this.prisma.$transaction(
      async (tx) => {
        // A mesma trava por frota usada na criacao impede uma nova inspecao
        // de competir com a remocao do checklist mensal.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${vehicleId}, 0))::text AS lock_result`;
        await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" = ${vehicleId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Checklist" WHERE "id" = ${id} FOR UPDATE`;
        const snapshot = await readSnapshot(tx, id);
        const preview = buildChecklistRemovalPreview(snapshot);
        if (preview.fingerprint !== expectedFingerprint) {
          throw new ConflictException(
            'O checklist mudou. Atualize a previa e confirme novamente.',
          );
        }
        if (confirmationFleet !== preview.checklist.fleet) {
          throw new BadRequestException(
            'A frota digitada nao corresponde ao checklist.',
          );
        }
        if (!preview.canDelete) {
          throw new ConflictException({
            message:
              'Este checklist possui vinculos que exigem analise antes da exclusao.',
            blockers: preview.blockers,
          });
        }

        const occurrenceIds = snapshot.checklist.occurrences.map(
          (row) => row.id,
        );
        if (occurrenceIds.length) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Occurrence" WHERE "id" IN (${Prisma.join(occurrenceIds)}) FOR UPDATE`,
          );
        }
        await setVehicleAuditContext(tx, {
          source: 'SYSTEM',
          userId: actor.sub,
          name: actor.name,
          email: actor.email,
        });
        if (Object.keys(preview.vehicleRestore).length) {
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: preview.vehicleRestore,
          });
        }
        if (occurrenceIds.length) {
          const removed = await tx.occurrence.deleteMany({
            where: { id: { in: occurrenceIds } },
          });
          if (removed.count !== occurrenceIds.length) {
            throw new ConflictException(
              'As ocorrencias mudaram durante a exclusao.',
            );
          }
        }
        await tx.checklist.delete({ where: { id } });
        const audit = await tx.vehicleRegistrationAudit.create({
          data: {
            vehicleId,
            operation: 'DELETE_CHECKLIST',
            source: 'SYSTEM',
            changedFields: ['checklist'],
            changedByUserId: actor.sub,
            changedByName: actor.name || null,
            changedByEmail: actor.email || null,
            beforeData: {
              checklistId: id,
              fleet: preview.checklist.fleet,
              type: preview.checklist.type,
              createdAt: preview.checklist.createdAt,
              authorName: preview.checklist.authorName,
              itemCount: preview.checklist.itemCount,
              occurrenceIds,
              hadConsent: !!snapshot.checklist.consent,
              hadAssignmentChange: !!snapshot.checklist.assignmentChange,
              vehicleRestore: preview.vehicleRestore,
              previewFingerprint: expectedFingerprint,
              reason,
            },
            afterData: Prisma.JsonNull,
          },
          select: { id: true },
        });
        return {
          deleted: true,
          checklistId: id,
          removedOccurrenceCount: occurrenceIds.length,
          auditId: audit.id.toString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20_000,
      },
    );
  }
}

async function readSnapshot(db: Database, id: string) {
  const checklist = await db.checklist.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      items: { orderBy: { id: 'asc' } },
      occurrences: {
        orderBy: { id: 'asc' },
        include: {
          photos: { orderBy: { id: 'asc' } },
          partRequests: { orderBy: { id: 'asc' } },
        },
      },
      consent: { include: { tokens: { orderBy: { id: 'asc' } } } },
      assignmentChange: true,
    },
  });
  if (!checklist?.vehicleId) {
    throw new NotFoundException('Checklist nao encontrado.');
  }
  const vehicle = await db.vehicle.findUnique({
    where: { id: checklist.vehicleId },
    select: {
      id: true,
      fleet: true,
      plate: true,
      name: true,
      photoUrl: true,
      currentDriverName: true,
      currentResponsibleName: true,
    },
  });
  if (!vehicle)
    throw new NotFoundException('Frota do checklist nao encontrada.');
  const occurrenceIds = checklist.occurrences.map((row) => row.id);
  const relatedCounts = occurrenceIds.length
    ? await db.$queryRaw<Array<{ comments: bigint; validations: bigint }>>(
        Prisma.sql`SELECT
          (SELECT COUNT(*) FROM "OccurrenceComment" WHERE "occurrenceId" IN (${Prisma.join(occurrenceIds)})) AS comments,
          (SELECT COUNT(*) FROM "OccurrenceValidation" WHERE "occurrenceId" IN (${Prisma.join(occurrenceIds)})) AS validations`,
      )
    : [{ comments: 0n, validations: 0n }];
  const targetAudits = await db.vehicleRegistrationAudit.findMany({
    where: {
      vehicleId: vehicle.id,
      source: 'CHECKLIST_MENSAL',
      changedByUserId: checklist.createdBy,
      changedAt: {
        gte: new Date(checklist.createdAt.getTime() - 2_000),
        lte: new Date(checklist.createdAt.getTime() + 120_000),
      },
    },
    orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
  });
  const latestAuditByField = await Promise.all(
    VEHICLE_FIELDS.map((field) =>
      db.vehicleRegistrationAudit.findFirst({
        where: { vehicleId: vehicle.id, changedFields: { has: field } },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }),
    ),
  );
  return {
    checklist,
    vehicle,
    targetAudits,
    latestAuditByField,
    relatedCounts: relatedCounts[0],
  };
}

export function buildChecklistRemovalPreview(
  snapshot: Awaited<ReturnType<typeof readSnapshot>>,
) {
  const { checklist, vehicle, relatedCounts } = snapshot;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const vehicleRestore: Partial<Record<VehicleField, string | null>> = {};
  const commentCount = Number(relatedCounts.comments);
  const validationCount = Number(relatedCounts.validations);

  if (commentCount || validationCount) {
    blockers.push(
      'Ha comentarios ou validacoes vinculados a ocorrencias deste checklist.',
    );
  }
  for (const occurrence of checklist.occurrences) {
    if (
      occurrence.isEmergency ||
      !['PENDING_SUPERVISOR', 'APPROVED_SUPERVISOR'].includes(
        occurrence.status,
      ) ||
      occurrence.partRequests.length ||
      occurrence.localExecucao ||
      occurrence.responsavelUserId ||
      occurrence.maintenanceTargetUserId ||
      occurrence.dataEntrada ||
      occurrence.dataPrevistaSaida ||
      occurrence.entregaLimiteEm ||
      occurrence.entregueEm ||
      occurrence.dataInicioExecucao ||
      occurrence.dataConclusao ||
      occurrence.cancelledAt
    ) {
      blockers.push(
        'Ao menos uma ocorrencia ja teve tratativa ou movimentacao de manutencao.',
      );
      break;
    }
  }
  if (checklist.consent) {
    if (checklist.consent.status !== 'PENDING') {
      blockers.push('O consentimento do responsavel ja foi respondido.');
    } else if (checklist.consent.sentAt) {
      warnings.push(
        'Um e-mail de consentimento ja foi enviado. O link sera invalidado, mas o e-mail nao pode ser recolhido.',
      );
    }
  }
  if (checklist.assignmentChange?.notificationSentAt) {
    warnings.push(
      'Uma notificacao da mudanca de responsavel ja foi enviada e nao pode ser recolhida.',
    );
  }

  const frontPhoto = Array.isArray(checklist.fleetPhotos)
    ? checklist.fleetPhotos.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item.slot === 'front',
      )
    : null;
  const frontUrl =
    frontPhoto &&
    typeof frontPhoto === 'object' &&
    !Array.isArray(frontPhoto) &&
    typeof frontPhoto.photoUrl === 'string'
      ? frontPhoto.photoUrl
      : '';
  const assignment = checklist.assignmentChange;
  const desiredAfter: Partial<Record<VehicleField, string | null>> = {
    ...(frontUrl ? { photoUrl: frontUrl } : {}),
    ...(assignment
      ? {
          currentDriverName: assignment.driverName,
          currentResponsibleName: assignment.responsibleName,
        }
      : {}),
  };
  for (const [index, field] of VEHICLE_FIELDS.entries()) {
    const afterValue = desiredAfter[field];
    if (afterValue === undefined) continue;
    const candidates = snapshot.targetAudits.filter(
      (audit) =>
        audit.changedFields.includes(field) &&
        jsonField(audit.afterData, field) === afterValue,
    );
    if (candidates.length === 0) {
      const changedAssignment =
        field === 'currentDriverName'
          ? assignment &&
            assignment.previousDriverName !== assignment.driverName
          : field === 'currentResponsibleName'
            ? assignment &&
              assignment.previousResponsibleName !== assignment.responsibleName
            : false;
      if (
        changedAssignment ||
        (field === 'photoUrl' && vehicle.photoUrl === afterValue)
      ) {
        blockers.push(
          `Nao foi possivel determinar com seguranca a origem de ${field} no cadastro da frota.`,
        );
      }
      continue;
    }
    if (candidates.length !== 1) {
      blockers.push(
        `A trilha de ${field} e ambigua; nao sera revertida automaticamente.`,
      );
      continue;
    }
    const audit = candidates[0];
    if (snapshot.latestAuditByField[index]?.id !== audit.id) {
      warnings.push(
        `O campo ${field} foi alterado depois; o valor atual sera preservado.`,
      );
      continue;
    }
    if (vehicle[field] !== afterValue) {
      blockers.push(
        `O valor atual de ${field} nao confere com o registro auditado.`,
      );
      continue;
    }
    const beforeValue = jsonField(audit.beforeData, field);
    if (beforeValue === undefined) {
      blockers.push(`Falta o valor anterior auditado de ${field}.`);
      continue;
    }
    vehicleRestore[field] = beforeValue;
  }
  if (checklist.occurrences.length) {
    warnings.push(
      'As ocorrencias sem tratativa geradas por este checklist tambem serao removidas.',
    );
  }
  warnings.push(
    'Fotos ja enviadas permanecem retidas no armazenamento, mas deixam de aparecer no checklist.',
  );

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        {
          checklist,
          vehicle,
          targetAudits: snapshot.targetAudits,
          latestAuditByField: snapshot.latestAuditByField,
          relatedCounts: { commentCount, validationCount },
        },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      ),
    )
    .digest('hex');
  return {
    fingerprint,
    canDelete: blockers.length === 0,
    blockers,
    warnings,
    vehicleRestore,
    checklist: {
      id: checklist.id,
      title: checklist.title,
      type: checklist.type,
      status: checklist.status,
      createdAt: checklist.createdAt.toISOString(),
      month: checklist.month,
      year: checklist.year,
      authorName: checklist.user.name,
      fleet: vehicle.fleet || '',
      plate: vehicle.plate,
      vehicleName: vehicle.name || '',
      itemCount: checklist.items.length,
      occurrenceCount: checklist.occurrences.length,
      consentStatus: checklist.consent?.status || null,
      hasAssignmentChange: !!assignment,
    },
  };
}

function jsonField(
  value: Prisma.JsonValue | null,
  field: VehicleField,
): string | null | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const fieldValue = value[field];
  if (fieldValue === null || typeof fieldValue === 'string') return fieldValue;
  return undefined;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
  );
}

function saoPauloDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
