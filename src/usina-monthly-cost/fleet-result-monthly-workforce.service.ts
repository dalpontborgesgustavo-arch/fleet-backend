import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isSelectableTotvsEmployee,
  monthlyWorkforceKind,
  parseMonthlyLaborAssignments,
} from '../checklist/monthly-workforce.rules';
import { getLucasFleetRosterMonth } from '../cost-purchases/lucas-fleet-roster.controller';
import { USINA_ASPHALT_TEAM_CONTEXT } from '../usina-asphalt-teams/usina-asphalt-teams.rules';

const READ_ROLES = new Set(['admin', 'administrador', 'licitacao_gestor']);
const ADMIN_ROLES = new Set(['admin', 'administrador']);

function parseMonth(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    throw new BadRequestException('Competencia deve estar no formato AAAA-MM.');
  }
  return { key, date: new Date(`${key}-01T00:00:00.000Z`) };
}

function normalizedRole(role: unknown) {
  return (typeof role === 'string' ? role : '').trim().toLowerCase();
}

function ensureReadRole(role: unknown) {
  if (!READ_ROLES.has(normalizedRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para configurar a equipe mensal da frota.',
    );
  }
}

export function canEditMonthlyWorkforce(role: unknown, actorId: unknown) {
  const normalized = normalizedRole(role);
  if (ADMIN_ROLES.has(normalized)) return true;
  if (
    normalized !== 'licitacao_gestor' ||
    typeof actorId !== 'string' ||
    !actorId.trim()
  ) {
    return false;
  }
  const allowed = new Set(
    String(process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has(actorId.trim());
}

function ensureEditor(role: unknown, actorId: unknown) {
  if (!canEditMonthlyWorkforce(role, actorId)) {
    throw new ForbiddenException(
      'Sem permissao para configurar a equipe mensal da frota.',
    );
  }
}

@Injectable()
export class FleetResultMonthlyWorkforceService {
  constructor(private readonly prisma: PrismaService) {}

  async findMonth(competenceValue: unknown, role: unknown, actorId?: unknown) {
    ensureReadRole(role);
    const competence = parseMonth(competenceValue);
    const rows = await this.prisma.fleetResultMonthlyWorkforce.findMany({
      where: { competence: competence.date },
      orderBy: { vehicleId: 'asc' },
      select: { vehicleId: true, assignments: true, updatedAt: true },
    });
    return {
      competence: competence.key,
      canEdit: canEditMonthlyWorkforce(role, actorId),
      rows,
    };
  }

  async findEmployees(
    competenceValue: unknown,
    role: unknown,
    actorId?: unknown,
  ) {
    // The employee directory contains nominal payroll data. Keep the monthly
    // vehicle assignments readable to the presentation role, but expose the
    // selectable names only to the same exact actors allowed to edit them.
    ensureEditor(role, actorId);
    const competence = parseMonth(competenceValue);
    const rows = await this.prisma.totvsEmployeeSnapshot.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence: competence.date,
        isCurrent: true,
        active: true,
      },
      orderBy: [
        { displayName: 'asc' },
        { employeeKey: 'asc' },
        { period: 'asc' },
      ],
      select: {
        employeeKey: true,
        displayName: true,
        jobName: true,
        employmentStatus: true,
      },
    });
    const employees = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (
        isSelectableTotvsEmployee(row.employmentStatus) &&
        !employees.has(row.employeeKey)
      ) {
        employees.set(row.employeeKey, row);
      }
    }
    return {
      competence: competence.key,
      canEdit: canEditMonthlyWorkforce(role, actorId),
      snapshotAvailable: rows.length > 0,
      employees: [...employees.values()],
    };
  }

  async saveVehicle(
    competenceValue: unknown,
    vehicleIdValue: unknown,
    body: unknown,
    actorId: unknown,
    role: unknown,
  ) {
    ensureEditor(role, actorId);
    const competence = parseMonth(competenceValue);
    const vehicleId =
      typeof vehicleIdValue === 'string' ? vehicleIdValue.trim() : '';
    if (typeof actorId !== 'string' || !actorId.trim() || !vehicleId) {
      throw new BadRequestException('Usuario ou frota nao informado.');
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Object.prototype.hasOwnProperty.call(body, 'assignments')
    ) {
      throw new BadRequestException(
        'Informe assignments; use [] para confirmar equipe vazia.',
      );
    }
    const roster = await getLucasFleetRosterMonth(this.prisma, competence.key);
    const vehicle = roster.rows.find((row) => row.id === vehicleId);
    if (
      !vehicle ||
      !vehicle.active ||
      monthlyWorkforceKind(vehicle.subgroup) === 'STANDARD'
    ) {
      throw new BadRequestException(
        'Frota ativa de vibroacabadora ou motoniveladora nao encontrada na competencia.',
      );
    }
    const rawAssignments = (body as { assignments: unknown }).assignments;
    if (!Array.isArray(rawAssignments)) {
      throw new BadRequestException(
        'assignments deve ser uma lista; use [] para confirmar equipe vazia.',
      );
    }
    const assignments = parseMonthlyLaborAssignments(
      rawAssignments,
      vehicle.subgroup,
    );
    const employeeKeys = assignments.map((item) => item.employeeKey);
    if (employeeKeys.length) {
      const employees = await this.prisma.totvsEmployeeSnapshot.findMany({
        where: {
          companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
          competence: competence.date,
          employeeKey: { in: employeeKeys },
          isCurrent: true,
          active: true,
        },
        select: { employeeKey: true, employmentStatus: true },
      });
      const selectable = new Set(
        employees
          .filter((row) => isSelectableTotvsEmployee(row.employmentStatus))
          .map((row) => row.employeeKey),
      );
      if (employeeKeys.some((key) => !selectable.has(key))) {
        throw new BadRequestException(
          'Selecione colaboradores ativos do TOTVS desta competencia.',
        );
      }
    }
    const saved = await this.prisma.$transaction(async (tx) => {
      const where = {
        competence_vehicleId: { competence: competence.date, vehicleId },
      };
      const before = await tx.fleetResultMonthlyWorkforce.findUnique({ where });
      const row = await tx.fleetResultMonthlyWorkforce.upsert({
        where,
        create: {
          competence: competence.date,
          vehicleId,
          assignments,
          createdById: actorId,
          updatedById: actorId,
        },
        update: { assignments, updatedById: actorId },
      });
      await tx.fleetResultMonthlyWorkforceAudit.create({
        data: {
          workforceId: row.id,
          actorId,
          action: before ? 'UPDATED' : 'CREATED',
          beforeData:
            before && before.assignments !== null
              ? (before.assignments as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          afterData: assignments,
        },
      });
      return row;
    });
    return {
      competence: competence.key,
      vehicleId,
      assignments: saved.assignments,
      updatedAt: saved.updatedAt,
    };
  }
}
