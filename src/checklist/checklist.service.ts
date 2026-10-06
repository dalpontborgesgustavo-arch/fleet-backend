import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { ChecklistConsentService } from './checklist-consent.service';
import { EmailService } from '../email/email.service';
import {
  AuthenticatedActor,
  resolveSupervisorFleetScope,
} from '../common/supervisor-fleet-scope';
import { resolveMonthlyChecklistVehicleWhere } from '../common/monthly-checklist-access';
import { setVehicleAuditContext } from '../vehicles/vehicle-audit-context';
import { USINA_ASPHALT_TEAM_CONTEXT } from '../usina-asphalt-teams/usina-asphalt-teams.rules';
import {
  isSelectableTotvsEmployee,
  parseMonthlyLaborAssignments,
} from './monthly-workforce.rules';
import { resolveMonthlyPeriod } from './monthly-offline-period.rules';

@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checklistConsentService: ChecklistConsentService,
    private readonly emailService: EmailService,
  ) {}

  async create(
    dto: CreateChecklistDto,
    actorInput: AuthenticatedActor | string,
  ) {
    const actor: AuthenticatedActor =
      typeof actorInput === 'string'
        ? { sub: actorInput, role: 'supervisor_apoio' }
        : actorInput;
    const userId = actor?.sub || '';
    if (!userId) {
      throw new ForbiddenException('Usuario nao autorizado.');
    }
    const now = new Date();
    const type = dto.type === 'MONTHLY' ? 'MONTHLY' : 'DAILY';
    const inMaintenance = dto.inMaintenance === true;
    if (inMaintenance && type !== 'MONTHLY') {
      throw new BadRequestException('Frota em manutencao so se aplica ao checklist mensal.');
    }
    if (
      inMaintenance &&
      (dto.items.length > 0 || dto.photoUrl || dto.fleetPhotos?.length ||
        hasMonthlyAssignmentPayload(dto))
    ) {
      throw new BadRequestException(
        'Frota em manutencao deve ser registrada sem respostas, fotos ou alteracao de vinculos.',
      );
    }
    const fleetPhotos = normalizeFleetPhotos(dto.fleetPhotos);
    const frontFleetPhotoUrl =
      type === 'MONTHLY' ? getFrontFleetPhotoUrl(fleetPhotos) : null;
    const monthlyPeriod = type === 'MONTHLY' ? resolveMonthlyPeriod(dto, now) : null;
    const month = monthlyPeriod?.month ?? now.getMonth() + 1;
    const year = monthlyPeriod?.year ?? now.getFullYear();

    if (type === 'DAILY') {
      await this.ensureVehicleChecklistEnabled(dto.vehicleId);
    }

    let monthlyAssignment: MonthlyAssignment | null = null;
    let monthlyWorkforce: Awaited<ReturnType<ChecklistService['resolveMonthlyWorkforce']>> | null = null;
    let monthlyResponsibility: {
      id: string;
      name: string;
    } | null = null;

    if (type === 'MONTHLY') {
      const monthlyWhere = await resolveMonthlyChecklistVehicleWhere(
        this.prisma,
        actor,
        dto.executionMode === 'ASSISTANCE' ? 'ASSISTANCE' : 'OWN',
      );
      const allowedVehicle = monthlyWhere
        ? await this.prisma.vehicle.findFirst({
            where: { AND: [monthlyWhere, { id: dto.vehicleId }] },
            select: {
              id: true,
              monthlyChecklistResponsible: {
                select: { id: true, name: true },
              },
            },
          })
        : null;

      if (!allowedVehicle) {
        await this.throwIfVehicleChecklistDisabled(dto.vehicleId);
        throw new ForbiddenException(
          dto.executionMode === 'ASSISTANCE'
            ? 'Este veiculo nao esta disponivel para checklist por ajuda.'
            : 'Este veiculo nao esta atribuido a voce para o Checklist Mensal.',
        );
      }

      monthlyResponsibility = allowedVehicle.monthlyChecklistResponsible;

      const existingChecklist = await this.findExistingMonthlyChecklist(
        dto.vehicleId,
        month,
        year,
      );

      if (existingChecklist) {
        return existingChecklist;
      }

      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: {
          id: true,
          fleet: true,
          plate: true,
          name: true,
          model: true,
          hasTimeClockDevice: true,
          subgroup: true,
          currentDriverName: true,
          currentResponsibleName: true,
        },
      });

      if (!vehicle) {
        throw new BadRequestException('Veiculo nao encontrado.');
      }

      if (!inMaintenance) {
        assertCompleteMonthlyFleetPhotos(
          fleetPhotos,
          vehicle.hasTimeClockDevice === true,
        );
        monthlyWorkforce = await this.resolveMonthlyWorkforce(dto, vehicle.subgroup, { month, year });
      }

      // Mantem compatibilidade temporaria com versoes antigas do aplicativo que
      // ainda podem ter checklists offline na fila sem os novos campos.
      monthlyAssignment = !inMaintenance && hasMonthlyAssignmentPayload(dto)
        ? resolveMonthlyAssignment({
            ...dto,
            driverName: monthlyWorkforce?.driverName ?? dto.driverName,
            responsibleName: monthlyWorkforce?.responsibleName ?? dto.responsibleName,
          }, vehicle)
        : null;
    }

    let checklist;
    const auditActor =
      monthlyAssignment || frontFleetPhotoUrl
        ? await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, email: true },
          })
        : null;

    try {
      checklist = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.vehicleId}, 0))::text AS lock_result`;
        const pendingValidation = process.env.REQUIRE_CHECKLIST_VALIDATION_PHOTO === 'true'
          ? await transaction.occurrence.findFirst({
          where: {
            vehicleId: dto.vehicleId,
            status: 'REJECTED_SUPERVISOR',
            responsavelUserId: { not: null },
            dataConclusao: { not: null },
          },
          select: { id: true },
          })
          : null;
        if (pendingValidation) {
          throw new ConflictException({
            code: 'VEHICLE_VALIDATION_REQUIRED',
            message: 'Valide a manutencao pendente deste veiculo com foto antes do checklist.',
          });
        }
        if (monthlyAssignment || frontFleetPhotoUrl) {
          await setVehicleAuditContext(transaction, {
            source: 'CHECKLIST_MENSAL',
            userId,
            name: auditActor?.name || actor.name,
            email: auditActor?.email || actor.email,
          });
        }

        const createdChecklist = await transaction.checklist.create({
          data: {
            title: dto.title,
            vehicleId: dto.vehicleId,
            photoUrl:
              dto.photoUrl ??
              getRepresentativeFleetPhotoUrl(fleetPhotos) ??
              null,
            fleetPhotos,
            driverName: monthlyAssignment?.checklistDriverName ?? null,
            responsibleName: monthlyAssignment?.responsibleName ?? null,
            driverEmployeeKey: monthlyWorkforce?.driverEmployeeKey ?? null,
            responsibleEmployeeKey: monthlyWorkforce?.responsibleEmployeeKey ?? null,
            ...(monthlyWorkforce
              ? { laborAssignments: monthlyWorkforce.laborAssignments }
              : {}),
            vehicleStopped: monthlyAssignment?.vehicleStopped ?? false,
            month,
            year,
            capturedAt: monthlyPeriod?.capturedAt ?? null,
            status: inMaintenance ? 'em_manutencao' : 'aberto',
            type,
            createdBy: userId,
            monthlyResponsibleUserId: monthlyResponsibility?.id ?? null,
            monthlyResponsibleName: monthlyResponsibility?.name ?? null,
            assistedExecution:
              !!monthlyResponsibility && monthlyResponsibility.id !== userId,
            items: {
              create: dto.items.map((item) => {
                const answer = normalizeChecklistAnswer(item);

                return {
                  label: item.label,
                  answer,
                  ok: answer !== 'NC',
                };
              }),
            },
          },
          include: {
            items: true,
          },
        });

        if (frontFleetPhotoUrl) {
          await transaction.vehicle.updateMany({
            where: {
              id: dto.vehicleId,
              OR: [{ photoUrl: null }, { photoUrl: '' }],
            },
            data: { photoUrl: frontFleetPhotoUrl },
          });
        }

        if (monthlyAssignment) {
          await transaction.vehicle.update({
            where: { id: dto.vehicleId },
            data: {
              currentDriverName: monthlyAssignment.currentDriverName,
              currentResponsibleName: monthlyAssignment.responsibleName,
              ...(monthlyWorkforce?.driverEmployeeKey
                ? { currentDriverEmployeeKey: monthlyWorkforce.driverEmployeeKey }
                : monthlyAssignment.driverChanged
                  ? { currentDriverEmployeeKey: null }
                  : {}),
              ...(monthlyWorkforce?.responsibleEmployeeKey
                ? { currentResponsibleEmployeeKey: monthlyWorkforce.responsibleEmployeeKey }
                : monthlyAssignment.responsibleChanged
                  ? { currentResponsibleEmployeeKey: null }
                  : {}),
            },
          });

          await transaction.vehicleAssignmentHistory.create({
            data: {
              vehicleId: dto.vehicleId,
              checklistId: createdChecklist.id,
              previousDriverName: monthlyAssignment.previousDriverName,
              driverName: monthlyAssignment.currentDriverName,
              previousResponsibleName:
                monthlyAssignment.previousResponsibleName,
              responsibleName: monthlyAssignment.responsibleName,
              vehicleStopped: monthlyAssignment.vehicleStopped,
              driverChanged: monthlyAssignment.driverChanged,
              responsibleChanged: monthlyAssignment.responsibleChanged,
              notificationRecipients: ASSIGNMENT_NOTIFICATION_RECIPIENTS,
              changedBy: userId,
            },
          });
        }

        return createdChecklist;
      });
    } catch (error) {
      if (type === 'MONTHLY' && isUniqueConstraintError(error)) {
        const existingChecklist = await this.findExistingMonthlyChecklist(
          dto.vehicleId,
          month,
          year,
        );

        if (existingChecklist) {
          return existingChecklist;
        }
      }

      throw error;
    }

    if (!inMaintenance) {
      await this.checklistConsentService.createForChecklistIfNeeded(checklist.id);
    }

    if (
      monthlyAssignment &&
      (monthlyAssignment.driverChanged || monthlyAssignment.responsibleChanged)
    ) {
      await this.sendAssignmentNotification(
        checklist.id,
        monthlyAssignment,
        userId,
      );
    }

    return checklist;
  }

  private async ensureVehicleChecklistEnabled(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, active: true, checklistEnabled: true },
    });

    if (!vehicle) {
      throw new BadRequestException('Veiculo nao encontrado.');
    }
    if (vehicle.checklistEnabled === false) {
      this.throwChecklistDisabled();
    }
    if (vehicle.active === false) {
      throw new ConflictException('Este veiculo esta inativo.');
    }
  }

  private async throwIfVehicleChecklistDisabled(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { checklistEnabled: true },
    });
    if (vehicle?.checklistEnabled === false) {
      this.throwChecklistDisabled();
    }
  }

  private throwChecklistDisabled(): never {
    throw new ConflictException({
      code: 'VEHICLE_CHECKLIST_DISABLED',
      message:
        'Este veiculo foi configurado para nao realizar checklist diario nem mensal.',
    });
  }

  async findMonthlyVehicles(
    actor?: AuthenticatedActor | null,
    requestedMode?: string,
  ) {
    const mode = requestedMode === 'ASSISTANCE' ? 'ASSISTANCE' : 'OWN';
    const where = await resolveMonthlyChecklistVehicleWhere(
      this.prisma,
      actor,
      mode,
    );
    if (!where) return [];

    return this.prisma.vehicle.findMany({
      where,
      orderBy: [{ fleet: 'asc' }, { name: 'asc' }],
      include: {
        monthlyChecklistResponsible: {
          select: { id: true, name: true, email: true, active: true },
        },
      },
    });
  }

  async findMonthlyWorkforce(
    actor?: AuthenticatedActor | null,
    competenceInput?: string,
    searchInput?: string,
  ) {
    const monthlyWhere = await resolveMonthlyChecklistVehicleWhere(this.prisma, actor);
    if (!monthlyWhere) throw new ForbiddenException('Sem acesso ao checklist mensal.');
    const competence = String(competenceInput || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) {
      throw new BadRequestException('Competencia deve estar no formato AAAA-MM.');
    }
    const search = String(searchInput || '').trim().slice(0, 80);
    const month = new Date(`${competence}-01T00:00:00.000Z`);
    const rows = await this.prisma.totvsEmployeeSnapshot.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: month,
        isCurrent: true,
        active: true,
        ...(search ? { OR: [
          { displayName: { contains: search, mode: 'insensitive' } },
          { employeeNumber: { contains: search, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ displayName: 'asc' }, { employeeKey: 'asc' }, { period: 'asc' }],
      take: 2000,
      select: {
        employeeKey: true,
        displayName: true,
        jobName: true,
        employmentStatus: true,
      },
    });
    const employees = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      if (isSelectableTotvsEmployee(row.employmentStatus) && !employees.has(row.employeeKey)) {
        employees.set(row.employeeKey, row);
      }
    }
    return {
      competence,
      source: 'TOTVS_RM_IND.BI.0025',
      snapshotAvailable: rows.length > 0,
      employees: [...employees.values()].slice(0, search ? 60 : 600).map((row) => ({
        employeeKey: row.employeeKey,
        displayName: row.displayName,
        jobName: row.jobName,
        employmentStatus: row.employmentStatus,
      })),
    };
  }

  private async resolveMonthlyWorkforce(dto: CreateChecklistDto, subgroup: string | null, period: { month: number; year: number }) {
    const laborAssignments = parseMonthlyLaborAssignments(dto.laborAssignments, subgroup);
    if (dto.vehicleStopped && laborAssignments.length) {
      throw new BadRequestException('Veiculo parado nao pode receber equipe de operacao.');
    }
    const driverEmployeeKey = String(dto.driverEmployeeKey || '').trim() || null;
    const responsibleEmployeeKey = String(dto.responsibleEmployeeKey || '').trim() || null;
    if (dto.vehicleStopped && driverEmployeeKey) {
      throw new BadRequestException('Veiculo parado nao pode receber motorista/operador.');
    }
    const keys = [...new Set([
      driverEmployeeKey,
      responsibleEmployeeKey,
      ...laborAssignments.map((item) => item.employeeKey),
    ].filter((key): key is string => !!key))];
    if (!keys.length) {
      return {
        driverEmployeeKey: null,
        responsibleEmployeeKey: null,
        driverName: null,
        responsibleName: null,
        laborAssignments: [] as Array<{ role: string; employeeKey: string; displayName: string }>,
      };
    }
    const month = new Date(Date.UTC(period.year, period.month - 1, 1));
    const rows = await this.prisma.totvsEmployeeSnapshot.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: month,
        employeeKey: { in: keys },
        isCurrent: true,
        active: true,
      },
      select: { employeeKey: true, displayName: true, employmentStatus: true },
    });
    const people = new Map(rows.filter((row) => isSelectableTotvsEmployee(row.employmentStatus))
      .map((row) => [row.employeeKey, row.displayName]));
    if (keys.some((key) => !people.has(key))) {
      throw new BadRequestException('Selecione colaboradores ativos do snapshot TOTVS deste mes.');
    }
    return {
      driverEmployeeKey,
      responsibleEmployeeKey,
      driverName: driverEmployeeKey ? people.get(driverEmployeeKey)! : null,
      responsibleName: responsibleEmployeeKey ? people.get(responsibleEmployeeKey)! : null,
      laborAssignments: laborAssignments.map((item) => ({
        ...item,
        displayName: people.get(item.employeeKey)!,
      })),
    };
  }

  private async sendAssignmentNotification(
    checklistId: string,
    assignment: MonthlyAssignment,
    userId: string,
  ) {
    try {
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      const firstRegistration =
        !assignment.previousDriverName && !assignment.previousResponsibleName;
      const subject = firstRegistration
        ? `Sistema JR - primeiro cadastro da frota ${assignment.vehicleFleet || assignment.vehiclePlate}`
        : `Sistema JR - troca de vinculo na frota ${assignment.vehicleFleet || assignment.vehiclePlate}`;
      const vehicleLabel = [
        assignment.vehicleFleet ? `Frota ${assignment.vehicleFleet}` : null,
        assignment.vehiclePlate,
        assignment.vehicleName,
        assignment.vehicleModel,
      ]
        .filter(Boolean)
        .join(' - ');
      const driverChange = describeAssignmentChange(
        'Motorista/operador',
        assignment.previousDriverName,
        assignment.currentDriverName,
        assignment.vehicleStopped,
      );
      const responsibleChange = describeAssignmentChange(
        'Responsavel',
        assignment.previousResponsibleName,
        assignment.responsibleName,
        false,
      );
      const actorLabel = actor?.name || actor?.email || userId;
      const text = [
        firstRegistration
          ? 'Primeiro cadastro operacional realizado pelo Checklist Mensal.'
          : 'Alteracao de vinculo operacional realizada pelo Checklist Mensal.',
        `Veiculo: ${vehicleLabel}`,
        driverChange,
        responsibleChange,
        `Veiculo parado: ${assignment.vehicleStopped ? 'Sim' : 'Nao'}`,
        `Registrado por: ${actorLabel}`,
      ].join('\n');
      const result = await this.emailService.sendMail({
        to: ASSIGNMENT_NOTIFICATION_RECIPIENTS.join(', '),
        subject,
        text,
        html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
      });

      await this.prisma.vehicleAssignmentHistory.update({
        where: { checklistId },
        data: result.sent
          ? { notificationSentAt: new Date(), notificationError: null }
          : { notificationError: result.error || 'Falha no envio do e-mail.' },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida.';
      console.warn(
        `[checklist-assignment] Checklist ${checklistId} foi salvo, mas o aviso nao foi concluido: ${message}`,
      );

      await this.prisma.vehicleAssignmentHistory
        .update({
          where: { checklistId },
          data: { notificationError: message },
        })
        .catch(() => undefined);
    }
  }

  private findExistingMonthlyChecklist(
    vehicleId: string,
    month: number,
    year: number,
  ) {
    return this.prisma.checklist.findFirst({
      where: {
        vehicleId,
        type: 'MONTHLY',
        month,
        year,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        items: true,
      },
    });
  }

  async findAll(
    actor?: AuthenticatedActor | null,
    query: Record<string, unknown> = {},
  ) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return [];
    }

    const vehicleIds = scope
      ? (
          await this.prisma.vehicle.findMany({
            where: scope,
            select: { id: true },
          })
        ).map((vehicle) => vehicle.id)
      : null;

    const filters: Prisma.ChecklistWhereInput[] = [];
    if (vehicleIds) {
      filters.push({ vehicleId: { in: vehicleIds } });
    }

    const requestedType = cleanQueryText(query.type).toUpperCase();
    if (requestedType === 'DAILY' || requestedType === 'MONTHLY') {
      filters.push({ type: requestedType });
    }

    const requestedMonth = Number(query.month);
    if (
      Number.isInteger(requestedMonth) &&
      requestedMonth >= 1 &&
      requestedMonth <= 12
    ) {
      filters.push({ month: requestedMonth });
    }

    const requestedYear = Number(query.year);
    if (Number.isInteger(requestedYear) && requestedYear >= 2000) {
      filters.push({ year: requestedYear });
    }

    return this.prisma.checklist.findMany({
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
        monthlyResponsible: {
          select: { id: true, name: true, email: true },
        },
        consent: {
          select: {
            id: true,
            status: true,
            responsibleName: true,
            responsibleEmail: true,
            sentAt: true,
            lastEmailError: true,
            lastReminderAt: true,
            lastReminderError: true,
            reminderCount: true,
            consentedAt: true,
            rejectedAt: true,
            note: true,
            responseIp: true,
            responseUserAgent: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async findHistory(
    query: Record<string, unknown>,
    actor?: AuthenticatedActor | null,
  ) {
    const page = positiveInteger(query.page, 1);
    const pageSize = Math.min(positiveInteger(query.pageSize, 50), 100);
    const search = cleanQueryText(query.search).slice(0, 120);
    const vehicleId = cleanQueryText(query.vehicleId);
    const actorRole = cleanQueryText(actor?.role).toLowerCase();
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);

    if (scope === null) {
      return emptyHistoryPage(page, pageSize);
    }

    if ((actorRole === 'motorista' || actorRole === 'operador') && !actor?.sub) {
      return emptyHistoryPage(page, pageSize);
    }

    const scopedVehicleIds = scope
      ? (
          await this.prisma.vehicle.findMany({
            where: scope,
            select: { id: true },
          })
        ).map((vehicle) => vehicle.id)
      : null;

    if (
      vehicleId &&
      scopedVehicleIds &&
      !scopedVehicleIds.includes(vehicleId)
    ) {
      return emptyHistoryPage(page, pageSize);
    }

    const allowedVehicleIds = vehicleId ? [vehicleId] : scopedVehicleIds;
    const filters: Prisma.ChecklistWhereInput[] = [];

    if ((actorRole === 'motorista' || actorRole === 'operador') && actor?.sub) {
      filters.push({ createdBy: actor.sub });
    }

    if (allowedVehicleIds) {
      filters.push({ vehicleId: { in: allowedVehicleIds } });
    }

    if (search) {
      const matchingVehicles = await this.prisma.vehicle.findMany({
        where: {
          ...(scope || {}),
          ...(vehicleId ? { id: vehicleId } : {}),
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { plate: { contains: search, mode: 'insensitive' } },
            { fleet: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { tipoFrota: { contains: search, mode: 'insensitive' } },
            { vehicleType: { contains: search, mode: 'insensitive' } },
            { responsibleName: { contains: search, mode: 'insensitive' } },
            { responsibleEmail: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      const searchOptions: Prisma.ChecklistWhereInput[] = [
        { id: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { status: { contains: search, mode: 'insensitive' } },
        { createdBy: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        {
          consent: {
            responsibleName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          consent: {
            responsibleEmail: { contains: search, mode: 'insensitive' },
          },
        },
        {
          items: { some: { label: { contains: search, mode: 'insensitive' } } },
        },
        { vehicleId: { in: matchingVehicles.map((vehicle) => vehicle.id) } },
      ];

      const normalizedSearch = normalizeSearchText(search);
      if (normalizedSearch.includes('mensal')) {
        searchOptions.push({ type: 'MONTHLY' });
      }
      if (
        normalizedSearch.includes('diario') ||
        normalizedSearch.includes('diaria')
      ) {
        searchOptions.push({ type: 'DAILY' });
      }
      if (
        normalizedSearch.includes('nao conforme') ||
        normalizedSearch === 'nc' ||
        normalizedSearch.includes('problema') ||
        normalizedSearch.includes('atencao')
      ) {
        searchOptions.push({ items: { some: { answer: 'NC' } } });
      }

      filters.push({ OR: searchOptions });
    }

    const where: Prisma.ChecklistWhereInput = filters.length
      ? { AND: filters }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.checklist.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: true,
          user: { select: { id: true, name: true, email: true } },
          consent: {
            select: {
              id: true,
              status: true,
              responsibleName: true,
              responsibleEmail: true,
              sentAt: true,
              lastEmailError: true,
              lastReminderAt: true,
              lastReminderError: true,
              reminderCount: true,
              consentedAt: true,
              rejectedAt: true,
              note: true,
              responseIp: true,
              responseUserAgent: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.prisma.checklist.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async findHistoryDetail(id: string, actor?: AuthenticatedActor | null) {
    const scope = await resolveSupervisorFleetScope(this.prisma, actor);
    if (scope === null) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    const role = cleanQueryText(actor?.role).toLowerCase();
    const ownOnly = role === 'motorista' || role === 'operador';
    if (ownOnly && !actor?.sub) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    const checklist = await this.prisma.checklist.findFirst({
      where: {
        id,
        ...(ownOnly ? { createdBy: actor!.sub! } : {}),
      },
      include: {
        items: true,
        user: { select: { id: true, name: true } },
        occurrences: {
          select: {
            id: true,
            questionLabel: true,
            description: true,
            status: true,
            photos: { select: { id: true, url: true } },
          },
        },
      },
    });

    if (!checklist || !checklist.vehicleId) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    if (scope) {
      const permittedVehicle = await this.prisma.vehicle.findFirst({
        where: { id: checklist.vehicleId, ...scope },
        select: { id: true },
      });
      if (!permittedVehicle) {
        throw new NotFoundException('Checklist não encontrado.');
      }
    }

    return checklist;
  }

  async findTiReport() {
    const [checklists, vehicles] = await this.prisma.$transaction([
      this.prisma.checklist.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          items: true,
          user: { select: { id: true, name: true, email: true } },
          consent: true,
          occurrences: {
            orderBy: { createdAt: 'asc' },
            include: {
              photos: {
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.vehicle.findMany({
        orderBy: [{ active: 'desc' }, { fleet: 'asc' }],
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      checklists,
      vehicles,
    };
  }
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanQueryText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function emptyHistoryPage(page: number, pageSize: number) {
  return {
    items: [],
    pagination: { page, pageSize, total: 0, totalPages: 1 },
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function normalizeChecklistAnswer(
  item: CreateChecklistDto['items'][number],
): 'OK' | 'NC' | 'NA' {
  if (item.answer === 'OK' || item.answer === 'NC' || item.answer === 'NA') {
    return item.answer;
  }

  if (typeof item.ok === 'boolean') {
    return item.ok ? 'OK' : 'NC';
  }

  throw new BadRequestException(
    'Cada item do checklist precisa de uma resposta valida.',
  );
}

function normalizeFleetPhotos(
  photos: CreateChecklistDto['fleetPhotos'],
): Prisma.InputJsonArray | undefined {
  if (!Array.isArray(photos) || photos.length === 0) {
    return undefined;
  }

  const entries = photos
    .map((photo) => ({
      slot: photo.slot?.trim(),
      label: photo.label?.trim() || 'Foto da frota',
      photoUrl: photo.photoUrl?.trim() || null,
    }))
    .filter((photo) => photo.slot && photo.photoUrl);

  return entries.length ? entries : undefined;
}

const MONTHLY_FLEET_PHOTO_SLOTS = [
  'front',
  'rear',
  'interior',
  'left',
  'right',
];
const TIME_CLOCK_DEVICE_PHOTO_SLOT = 'timeClockDevice';

function assertCompleteMonthlyFleetPhotos(
  photos: Prisma.InputJsonArray | undefined,
  requiresTimeClockDevicePhoto: boolean,
) {
  const requiredSlots = requiresTimeClockDevicePhoto
    ? [...MONTHLY_FLEET_PHOTO_SLOTS, TIME_CLOCK_DEVICE_PHOTO_SLOT]
    : MONTHLY_FLEET_PHOTO_SLOTS;

  if (!Array.isArray(photos)) {
    throw new BadRequestException(
      requiresTimeClockDevicePhoto
        ? 'As fotos obrigatorias da frota, incluindo o dispositivo de ponto, precisam ser enviadas no checklist mensal.'
        : 'As 5 fotos obrigatorias da frota precisam ser enviadas no checklist mensal.',
    );
  }

  const availableSlots = new Set(
    photos
      .map((photo) => {
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
          return null;
        }

        const entry = photo as Record<string, unknown>;
        return typeof entry.slot === 'string' &&
          typeof entry.photoUrl === 'string'
          ? entry.slot
          : null;
      })
      .filter((slot): slot is string => Boolean(slot)),
  );

  const missingSlots = requiredSlots.filter(
    (slot) => !availableSlots.has(slot),
  );

  if (missingSlots.length > 0) {
    throw new BadRequestException(
      missingSlots.includes(TIME_CLOCK_DEVICE_PHOTO_SLOT)
        ? 'A foto do dispositivo de ponto e obrigatoria para este veiculo.'
        : 'As fotos obrigatorias da frota precisam ser enviadas no checklist mensal.',
    );
  }
}

function getRepresentativeFleetPhotoUrl(
  photos: Prisma.InputJsonArray | undefined,
) {
  const frontPhotoUrl = getFrontFleetPhotoUrl(photos);
  if (frontPhotoUrl) {
    return frontPhotoUrl;
  }

  if (!Array.isArray(photos)) {
    return null;
  }

  const representative = photos[0];

  if (
    !representative ||
    typeof representative !== 'object' ||
    Array.isArray(representative)
  ) {
    return null;
  }

  const photoUrl = (representative as Record<string, unknown>).photoUrl;

  return typeof photoUrl === 'string' ? photoUrl : null;
}

function getFrontFleetPhotoUrl(photos: Prisma.InputJsonArray | undefined) {
  if (!Array.isArray(photos)) {
    return null;
  }

  const frontPhoto = photos.find((photo) => {
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

  const photoUrl = (frontPhoto as Record<string, unknown>).photoUrl;
  return typeof photoUrl === 'string' && photoUrl.trim()
    ? photoUrl.trim()
    : null;
}

const ASSIGNMENT_NOTIFICATION_RECIPIENTS = [
  'daniela.silva@jrmc.com.br',
  'dalpontborgesgustavo@gmail.com',
];

type MonthlyAssignmentVehicle = {
  fleet: string | null;
  plate: string;
  name: string | null;
  model: string | null;
  currentDriverName: string | null;
  currentResponsibleName: string | null;
};

type MonthlyAssignment = {
  vehicleFleet: string | null;
  vehiclePlate: string;
  vehicleName: string | null;
  vehicleModel: string | null;
  previousDriverName: string | null;
  previousResponsibleName: string | null;
  checklistDriverName: string | null;
  currentDriverName: string | null;
  responsibleName: string;
  vehicleStopped: boolean;
  driverChanged: boolean;
  responsibleChanged: boolean;
};

function resolveMonthlyAssignment(
  dto: CreateChecklistDto,
  vehicle: MonthlyAssignmentVehicle,
): MonthlyAssignment {
  const responsibleName = cleanAssignmentName(dto.responsibleName);
  const submittedDriverName = dto.vehicleStopped === true
    ? null
    : cleanAssignmentName(dto.driverName);
  const previousDriverName = cleanAssignmentName(vehicle.currentDriverName);
  const previousResponsibleName = cleanAssignmentName(
    vehicle.currentResponsibleName,
  );
  const vehicleStopped = dto.vehicleStopped === true;

  if (!responsibleName) {
    throw new BadRequestException(
      'Informe o nome do responsavel atual do veiculo.',
    );
  }

  if (!vehicleStopped && !submittedDriverName) {
    throw new BadRequestException(
      'Informe o motorista/operador ou marque que o veiculo esta parado.',
    );
  }

  const currentDriverName =
    submittedDriverName || (vehicleStopped ? previousDriverName : null);

  return {
    vehicleFleet: vehicle.fleet,
    vehiclePlate: vehicle.plate,
    vehicleName: vehicle.name,
    vehicleModel: vehicle.model,
    previousDriverName,
    previousResponsibleName,
    checklistDriverName: submittedDriverName,
    currentDriverName,
    responsibleName,
    vehicleStopped,
    driverChanged:
      !!submittedDriverName &&
      !sameAssignmentName(previousDriverName, submittedDriverName),
    responsibleChanged: !sameAssignmentName(
      previousResponsibleName,
      responsibleName,
    ),
  };
}

function hasMonthlyAssignmentPayload(dto: CreateChecklistDto) {
  return (
    typeof dto.driverName === 'string' ||
    typeof dto.responsibleName === 'string' ||
    typeof dto.vehicleStopped === 'boolean'
  );
}

function cleanAssignmentName(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned || null;
}

function sameAssignmentName(left: string | null, right: string | null) {
  return normalizeSearchText(left || '') === normalizeSearchText(right || '');
}

function describeAssignmentChange(
  label: string,
  previous: string | null,
  current: string | null,
  vehicleStopped: boolean,
) {
  const previousLabel = previous || 'Nao cadastrado';
  const currentLabel =
    current ||
    (vehicleStopped ? 'Nao informado - veiculo parado' : 'Nao informado');
  return `${label}: ${previousLabel} -> ${currentLabel}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
