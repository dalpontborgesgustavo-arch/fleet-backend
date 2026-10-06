import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeFilial } from '../common/filial';
import {
  AuthenticatedActor,
  resolveSupervisorFleetScope,
} from '../common/supervisor-fleet-scope';
import { setVehicleAuditContext } from './vehicle-audit-context';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlateKey(value: unknown): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeFleetKey(value: unknown): string {
  return cleanText(value)
    .replace(/^FROTA[\s-]*/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

type FleetReportOccurrence = {
  status: string;
  localExecucao: string | null;
  responsavelUserId: string | null;
  dataEntrada: Date | null;
  dataPrevistaSaida: Date | null;
  entregaLimiteEm: Date | null;
  dataConclusao: Date | null;
};

type FleetReportVehicle = {
  id: string;
  name: string | null;
  plate: string;
  model: string | null;
  fleet: string | null;
  group: string | null;
  subgroup: string | null;
  rollerType: string | null;
  company: string | null;
  vehicleType: string;
  tipoFrota: string;
  filial: string;
  active: boolean;
  checklistEnabled: boolean;
  photoUrl: string | null;
  responsibleName: string | null;
  responsibleEmail: string | null;
  currentDriverName: string | null;
  currentResponsibleName: string | null;
  monthlyChecklistResponsibleId: string | null;
  hasTimeClockDevice: boolean | null;
  veiculoManutencao: boolean;
  monthlyChecklistResponsible: {
    id: string;
    name: string;
    email: string;
    active: boolean;
  } | null;
};

type VehiclePhotoBackfillCandidate = {
  vehicleId: string;
  fleet: string | null;
  plate: string;
  name: string | null;
  frontPhotoUrl: string;
  sourceChecklistId: string;
  sourceChecklistMonth: number;
  sourceChecklistYear: number;
  sourceChecklistCreatedAt: Date;
};

function hasOccurrencePlanning(occurrence: FleetReportOccurrence) {
  return !!(
    occurrence.localExecucao ||
    occurrence.responsavelUserId ||
    occurrence.dataEntrada ||
    occurrence.dataPrevistaSaida ||
    occurrence.entregaLimiteEm
  );
}

function isOpenOccurrence(occurrence: FleetReportOccurrence) {
  if (occurrence.status === 'RESOLVED' || occurrence.status === 'CANCELLED') {
    return false;
  }

  if (occurrence.status !== 'REJECTED_SUPERVISOR') {
    return true;
  }

  const planning = hasOccurrencePlanning(occurrence);
  const awaitingDriverValidation =
    planning && !!occurrence.responsavelUserId && !!occurrence.dataConclusao;

  return planning && !awaitingDriverValidation;
}

function missingVehicleRegistrationFields(vehicle: FleetReportVehicle) {
  const missing: string[] = [];
  const requireText = (value: unknown, label: string) => {
    if (!cleanText(value)) missing.push(label);
  };

  requireText(vehicle.photoUrl, 'Foto');
  requireText(vehicle.fleet, 'Frota / prefixo');
  requireText(vehicle.plate, 'Placa');
  requireText(vehicle.name, 'Nome / apelido');
  requireText(vehicle.model, 'Modelo');
  requireText(vehicle.group, 'Grupo');
  requireText(vehicle.subgroup, 'Subgrupo');
  requireText(vehicle.company, 'Empresa');

  if (
    !cleanText(vehicle.tipoFrota) ||
    vehicle.tipoFrota === 'NAO_CLASSIFICADO' ||
    vehicle.vehicleType === 'nao_classificado'
  ) {
    missing.push('Tipo de frota');
  }
  if (!cleanText(vehicle.filial) || vehicle.filial === 'NAO_CLASSIFICADA') {
    missing.push('Filial');
  }
  if (vehicle.hasTimeClockDevice === null) {
    missing.push('Dispositivo de ponto');
  }
  if (
    vehicle.checklistEnabled &&
    (!vehicle.monthlyChecklistResponsibleId ||
      !vehicle.monthlyChecklistResponsible ||
      vehicle.monthlyChecklistResponsible.active === false)
  ) {
    missing.push('Responsável pelo Checklist Mensal');
  }

  if (vehicle.tipoFrota === 'Veiculos') {
    requireText(vehicle.responsibleName, 'Nome do responsável');
    requireText(vehicle.responsibleEmail, 'E-mail do responsável');
  }

  return missing;
}

function frontPhotoUrl(fleetPhotos: unknown) {
  if (!Array.isArray(fleetPhotos)) return null;

  const frontPhoto = fleetPhotos.find((photo) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
      return false;
    }
    return (photo as Record<string, unknown>).slot === 'front';
  });

  if (
    !frontPhoto ||
    typeof frontPhoto !== 'object' ||
    Array.isArray(frontPhoto)
  ) {
    return null;
  }

  const value = (frontPhoto as Record<string, unknown>).photoUrl;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized ||
    (!normalized.startsWith('/') && !/^https?:\/\//i.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAll(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return [];
    }

    return this.prisma.vehicle.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      include: {
        monthlyChecklistResponsible: {
          select: { id: true, name: true, email: true, active: true },
        },
      },
    });
  }

  async reportSummary(actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);
    if (scope === null) {
      return this.emptyReportSummary();
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: scope,
      select: {
        id: true,
        name: true,
        plate: true,
        model: true,
        fleet: true,
        group: true,
        subgroup: true,
        rollerType: true,
        company: true,
        vehicleType: true,
        tipoFrota: true,
        filial: true,
        active: true,
        checklistEnabled: true,
        photoUrl: true,
        responsibleName: true,
        responsibleEmail: true,
        currentDriverName: true,
        currentResponsibleName: true,
        monthlyChecklistResponsibleId: true,
        hasTimeClockDevice: true,
        veiculoManutencao: true,
        monthlyChecklistResponsible: {
          select: { id: true, name: true, email: true, active: true },
        },
      },
    });
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    if (vehicleIds.length === 0) {
      return this.emptyReportSummary();
    }

    const [checklistCounts, occurrences] = await Promise.all([
      this.prisma.checklist.groupBy({
        by: ['vehicleId', 'type'],
        where: { vehicleId: { in: vehicleIds } },
        _count: { _all: true },
      }),
      this.prisma.occurrence.findMany({
        where: { vehicleId: { in: vehicleIds } },
        select: {
          vehicleId: true,
          status: true,
          localExecucao: true,
          responsavelUserId: true,
          dataEntrada: true,
          dataPrevistaSaida: true,
          entregaLimiteEm: true,
          dataConclusao: true,
        },
      }),
    ]);

    const monthlyByVehicle = new Map<string, number>();
    const dailyByVehicle = new Map<string, number>();
    for (const count of checklistCounts) {
      if (!count.vehicleId) continue;
      const target =
        count.type === 'MONTHLY' ? monthlyByVehicle : dailyByVehicle;
      target.set(count.vehicleId, count._count._all);
    }

    const openOccurrencesByVehicle = new Map<string, number>();
    for (const occurrence of occurrences) {
      if (!isOpenOccurrence(occurrence)) continue;
      openOccurrencesByVehicle.set(
        occurrence.vehicleId,
        (openOccurrencesByVehicle.get(occurrence.vehicleId) || 0) + 1,
      );
    }

    const collator = new Intl.Collator('pt-BR', {
      numeric: true,
      sensitivity: 'base',
    });
    const rows = vehicles
      .map((vehicle) => {
        const missingFields = missingVehicleRegistrationFields(vehicle);
        return {
          vehicleId: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
          model: vehicle.model,
          fleet: vehicle.fleet,
          group: vehicle.group,
          subgroup: vehicle.subgroup,
          rollerType: vehicle.rollerType,
          company: vehicle.company,
          vehicleType: vehicle.vehicleType,
          tipoFrota: vehicle.tipoFrota,
          filial: vehicle.filial,
          active: vehicle.active,
          checklistEnabled: vehicle.checklistEnabled,
          photoUrl: vehicle.photoUrl,
          responsibleName: vehicle.responsibleName,
          responsibleEmail: vehicle.responsibleEmail,
          currentDriverName: vehicle.currentDriverName,
          currentResponsibleName: vehicle.currentResponsibleName,
          hasTimeClockDevice: vehicle.hasTimeClockDevice,
          veiculoManutencao: vehicle.veiculoManutencao,
          monthlyChecklistResponsible: vehicle.monthlyChecklistResponsible,
          registrationComplete: missingFields.length === 0,
          missingFields,
          monthlyChecklists: monthlyByVehicle.get(vehicle.id) || 0,
          dailyChecklists: dailyByVehicle.get(vehicle.id) || 0,
          openOccurrences: openOccurrencesByVehicle.get(vehicle.id) || 0,
        };
      })
      .sort(
        (left, right) =>
          collator.compare(left.fleet || '', right.fleet || '') ||
          collator.compare(left.plate, right.plate),
      );

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        vehicles: rows.length,
        completeRegistrations: rows.filter((row) => row.registrationComplete)
          .length,
        incompleteRegistrations: rows.filter((row) => !row.registrationComplete)
          .length,
        monthlyChecklists: rows.reduce(
          (total, row) => total + row.monthlyChecklists,
          0,
        ),
        dailyChecklists: rows.reduce(
          (total, row) => total + row.dailyChecklists,
          0,
        ),
        openOccurrences: rows.reduce(
          (total, row) => total + row.openOccurrences,
          0,
        ),
      },
      rows,
    };
  }

  async previewPhotoBackfill() {
    const preview = await this.photoBackfillPreview(this.prisma);
    return this.publicPhotoBackfillPreview(preview);
  }

  async applyPhotoBackfill(actor?: AuthenticatedActor | null) {
    const preview = await this.photoBackfillPreview(this.prisma);
    const storedActor = actor?.sub
      ? await this.prisma.user.findUnique({
          where: { id: actor.sub },
          select: { name: true, email: true },
        })
      : null;

    const applied = await this.prisma.$transaction(async (transaction) => {
      await setVehicleAuditContext(transaction, {
        source: 'CHECKLIST_MENSAL',
        userId: actor?.sub,
        name: storedActor?.name || actor?.name,
        email: storedActor?.email || actor?.email,
      });

      let updated = 0;
      for (const candidate of preview.candidates) {
        const result = await transaction.vehicle.updateMany({
          where: {
            id: candidate.vehicleId,
            OR: [{ photoUrl: null }, { photoUrl: '' }],
          },
          data: { photoUrl: candidate.frontPhotoUrl },
        });
        updated += result.count;
      }
      return updated;
    });

    return {
      ...this.publicPhotoBackfillPreview(preview),
      applied,
      skippedBecauseAlreadyFilled: preview.candidates.length - applied,
    };
  }

  async create(data: any, actor?: AuthenticatedActor | null) {
    const normalizedData = this.normalizeVehicleData(data, true);
    this.validateRollerClassification(normalizedData.subgroup, normalizedData.rollerType);
    this.ensureRequiredIdentity(normalizedData);
    await this.ensureUniqueIdentity(normalizedData);
    await this.ensureMonthlyChecklistResponsible(normalizedData);

    try {
      return await this.withManualAudit(actor, (transaction) =>
        transaction.vehicle.create({ data: normalizedData }),
      );
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async update(id: string, data: any, actor?: AuthenticatedActor | null) {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const normalizedData = this.normalizeVehicleData(data);
    const subgroup = normalizedData.subgroup === undefined
      ? existing.subgroup
      : normalizedData.subgroup;
    if (cleanText(subgroup).toUpperCase() !== 'ROLOS COMPACTADORES') {
      if (normalizedData.rollerType) {
        throw new BadRequestException('Tipo de rolo permitido somente para ROLOS COMPACTADORES.');
      }
      if (existing.rollerType || normalizedData.subgroup !== undefined) {
        normalizedData.rollerType = null;
      }
    }
    this.validateRollerClassification(
      subgroup,
      normalizedData.rollerType === undefined
        ? existing.rollerType
        : normalizedData.rollerType,
    );
    const checklistEnabled =
      normalizedData.checklistEnabled === undefined
        ? existing.checklistEnabled
        : normalizedData.checklistEnabled;
    if (checklistEnabled === false) {
      normalizedData.monthlyChecklistResponsibleId = null;
    }
    const identity = {
      plate:
        normalizedData.plate === undefined
          ? existing.plate
          : normalizedData.plate,
      fleet:
        normalizedData.fleet === undefined
          ? existing.fleet
          : normalizedData.fleet,
    };
    this.ensureRequiredIdentity(identity);
    await this.ensureUniqueIdentity(identity, id, existing.aethosManaged);
    await this.ensureMonthlyChecklistResponsible(normalizedData);

    try {
      return await this.withManualAudit(actor, (transaction) =>
        transaction.vehicle.update({
          where: { id },
          data: normalizedData,
        }),
      );
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  delete(id: string, actor?: AuthenticatedActor | null) {
    return this.withManualAudit(actor, (transaction) => {
      return transaction.vehicle.delete({
        where: { id },
      });
    });
  }

  async history(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const rows = await this.prisma.vehicleRegistrationAudit.findMany({
      where: { vehicleId: id },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: 250,
    });

    return rows.map((row) => ({ ...row, id: row.id.toString() }));
  }

  private emptyReportSummary() {
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        vehicles: 0,
        completeRegistrations: 0,
        incompleteRegistrations: 0,
        monthlyChecklists: 0,
        dailyChecklists: 0,
        openOccurrences: 0,
      },
      rows: [],
    };
  }

  private async photoBackfillPreview(
    client: Pick<Prisma.TransactionClient, 'vehicle' | 'checklist'>,
  ) {
    const vehicles = await client.vehicle.findMany({
      where: { OR: [{ photoUrl: null }, { photoUrl: '' }] },
      select: { id: true, fleet: true, plate: true, name: true },
      orderBy: [{ fleet: 'asc' }, { plate: 'asc' }],
    });
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    if (vehicleIds.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        missingPhotoVehicles: 0,
        monthlyChecklistsReviewed: 0,
        candidates: [] as VehiclePhotoBackfillCandidate[],
      };
    }

    const checklists = await client.checklist.findMany({
      where: {
        type: 'MONTHLY',
        vehicleId: { in: vehicleIds },
      },
      select: {
        id: true,
        vehicleId: true,
        month: true,
        year: true,
        createdAt: true,
        fleetPhotos: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const vehicleById = new Map(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const candidatesByVehicle = new Map<
      string,
      VehiclePhotoBackfillCandidate
    >();
    for (const checklist of checklists) {
      if (
        !checklist.vehicleId ||
        candidatesByVehicle.has(checklist.vehicleId)
      ) {
        continue;
      }
      const photoUrl = frontPhotoUrl(checklist.fleetPhotos);
      const vehicle = vehicleById.get(checklist.vehicleId);
      if (!photoUrl || !vehicle) continue;

      candidatesByVehicle.set(checklist.vehicleId, {
        vehicleId: vehicle.id,
        fleet: vehicle.fleet,
        plate: vehicle.plate,
        name: vehicle.name,
        frontPhotoUrl: photoUrl,
        sourceChecklistId: checklist.id,
        sourceChecklistMonth: checklist.month,
        sourceChecklistYear: checklist.year,
        sourceChecklistCreatedAt: checklist.createdAt,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      missingPhotoVehicles: vehicles.length,
      monthlyChecklistsReviewed: checklists.length,
      candidates: [...candidatesByVehicle.values()],
    };
  }

  private publicPhotoBackfillPreview(preview: {
    generatedAt: string;
    missingPhotoVehicles: number;
    monthlyChecklistsReviewed: number;
    candidates: VehiclePhotoBackfillCandidate[];
  }) {
    return {
      generatedAt: preview.generatedAt,
      missingPhotoVehicles: preview.missingPhotoVehicles,
      monthlyChecklistsReviewed: preview.monthlyChecklistsReviewed,
      candidates: preview.candidates.map((candidate) => ({
        vehicleId: candidate.vehicleId,
        fleet: candidate.fleet,
        plate: candidate.plate,
        name: candidate.name,
        sourceChecklistId: candidate.sourceChecklistId,
        sourceChecklistMonth: candidate.sourceChecklistMonth,
        sourceChecklistYear: candidate.sourceChecklistYear,
        sourceChecklistCreatedAt:
          candidate.sourceChecklistCreatedAt.toISOString(),
      })),
      withoutMonthlyFrontPhoto:
        preview.missingPhotoVehicles - preview.candidates.length,
    };
  }

  private async withManualAudit<T>(
    actor: AuthenticatedActor | null | undefined,
    action: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!actor) {
      return action(this.prisma as unknown as Prisma.TransactionClient);
    }

    const storedActor = actor.sub
      ? await this.prisma.user.findUnique({
          where: { id: actor.sub },
          select: { name: true, email: true },
        })
      : null;

    return this.prisma.$transaction(async (transaction) => {
      await setVehicleAuditContext(transaction, {
        source: 'MANUAL',
        userId: actor.sub,
        name: storedActor?.name || actor.name,
        email: storedActor?.email || actor.email,
      });
      return action(transaction);
    });
  }

  private normalizeVehicleData(data: any, defaultFilial = false) {
    const normalized = { ...data };
    delete normalized.monthlyChecklistResponsible;

    if (Object.prototype.hasOwnProperty.call(data || {}, 'plate')) {
      normalized.plate = cleanText(data.plate).toUpperCase();
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'fleet')) {
      normalized.fleet = cleanText(data.fleet) || null;
    }
    for (const field of ['group', 'subgroup', 'company'] as const) {
      if (Object.prototype.hasOwnProperty.call(data || {}, field)) {
        normalized[field] = cleanText(data[field]) || null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'rollerType')) {
      const value = cleanText(data.rollerType).toUpperCase();
      if (value && !['CHAPA', 'PNEU', 'TERRAPLANAGEM'].includes(value)) {
        throw new BadRequestException('Tipo de rolo invalido. Selecione chapa, pneu ou terraplanagem.');
      }
      normalized.rollerType = value || null;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        data || {},
        'monthlyChecklistResponsibleId',
      )
    ) {
      normalized.monthlyChecklistResponsibleId =
        cleanText(data.monthlyChecklistResponsibleId) || null;
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'checklistEnabled')) {
      if (typeof data.checklistEnabled !== 'boolean') {
        throw new BadRequestException(
          'Informe se o veiculo realiza checklist.',
        );
      }
      normalized.checklistEnabled = data.checklistEnabled;
      if (data.checklistEnabled === false) {
        normalized.monthlyChecklistResponsibleId = null;
      }
    }
    if (
      defaultFilial ||
      Object.prototype.hasOwnProperty.call(data || {}, 'filial')
    ) {
      normalized.filial = normalizeFilial(data?.filial);
    }

    return normalized;
  }

  private validateRollerClassification(subgroup: unknown, rollerType: unknown) {
    if (cleanText(subgroup).toUpperCase() === 'ROLOS COMPACTADORES') {
      if (!rollerType) {
        throw new BadRequestException('Selecione o tipo de rolo: chapa, pneu ou terraplanagem.');
      }
    } else if (rollerType) {
      throw new BadRequestException('Tipo de rolo permitido somente para ROLOS COMPACTADORES.');
    }
  }

  private ensureRequiredIdentity(data: { plate?: unknown }) {
    if (!normalizePlateKey(data.plate)) {
      throw new BadRequestException('Informe uma placa válida.');
    }
  }

  private async ensureMonthlyChecklistResponsible(data: {
    monthlyChecklistResponsibleId?: unknown;
  }) {
    if (!data.monthlyChecklistResponsibleId) return;

    const responsible = await this.prisma.user.findFirst({
      where: {
        id: cleanText(data.monthlyChecklistResponsibleId),
        active: true,
      },
      select: { id: true },
    });

    if (!responsible) {
      throw new BadRequestException(
        'Selecione um usuario ativo para o Checklist Mensal.',
      );
    }
  }

  private async ensureUniqueIdentity(
    data: { plate?: unknown; fleet?: unknown },
    excludeId?: string,
    allowDuplicateFleet = false,
  ) {
    const plateKey = normalizePlateKey(data.plate);
    const fleetKey = normalizeFleetKey(data.fleet);
    const existingVehicles = await this.prisma.vehicle.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: {
        plate: true,
        fleet: true,
      },
    });

    const plateConflict = existingVehicles.find(
      (vehicle) => normalizePlateKey(vehicle.plate) === plateKey,
    );
    const fleetConflict =
      !allowDuplicateFleet && fleetKey
        ? existingVehicles.find(
            (vehicle) => normalizeFleetKey(vehicle.fleet) === fleetKey,
          )
        : null;
    if (plateConflict && fleetConflict === plateConflict) {
      throw new ConflictException(
        `Já existe um veículo cadastrado com a frota ${cleanText(data.fleet)} e a placa ${cleanText(data.plate).toUpperCase()}.`,
      );
    }
    if (plateConflict) {
      throw new ConflictException(
        `A placa ${cleanText(data.plate).toUpperCase()} já está cadastrada em outro veículo.`,
      );
    }
    if (fleetConflict) {
      throw new ConflictException(
        `A frota ${cleanText(data.fleet)} já está cadastrada em outro veículo.`,
      );
    }
  }

  private rethrowUniqueConstraint(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Já existe outro veículo cadastrado com esta placa ou identificação oficial.',
      );
    }
  }
}
