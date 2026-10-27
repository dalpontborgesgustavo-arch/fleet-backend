import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedActor } from './supervisor-fleet-scope';

const FULL_MONTHLY_ACCESS_ROLE = 'supervisor_apoio';
const FULL_ASSISTANCE_ACCESS_ROLES = new Set([FULL_MONTHLY_ACCESS_ROLE, 'admin']);

export type MonthlyChecklistAccessMode = 'OWN' | 'ASSISTANCE';

export async function resolveMonthlyChecklistVehicleWhere(
  prisma: PrismaService,
  actor?: AuthenticatedActor | null,
  mode: MonthlyChecklistAccessMode = 'OWN',
): Promise<Prisma.VehicleWhereInput | null> {
  if (!actor?.sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: { id: true, role: true, active: true },
  });

  if (!user || user.active === false) return null;

  const role = (user.role || actor.role || '').trim().toLowerCase();
  if (mode === 'ASSISTANCE') {
    const hasMonthlyAccess =
      FULL_ASSISTANCE_ACCESS_ROLES.has(role) ||
      (await prisma.vehicle.count({
        where: {
          active: true,
          checklistEnabled: true,
          monthlyChecklistResponsibleId: user.id,
        },
      })) > 0;

    if (!hasMonthlyAccess) return null;

    return {
      active: true,
      checklistEnabled: true,
      monthlyChecklistResponsibleId: {
        not: null,
        notIn: [user.id],
      },
    };
  }

  if (role === FULL_MONTHLY_ACCESS_ROLE) {
    return { active: true, checklistEnabled: true };
  }

  return {
    active: true,
    checklistEnabled: true,
    monthlyChecklistResponsibleId: user.id,
  };
}

export async function canAccessMonthlyChecklist(
  prisma: PrismaService,
  actor?: AuthenticatedActor | null,
) {
  const where = await resolveMonthlyChecklistVehicleWhere(prisma, actor);
  if (!where) return false;

  if ((actor?.role || '').trim().toLowerCase() === FULL_MONTHLY_ACCESS_ROLE) {
    return true;
  }

  if ((await prisma.vehicle.count({ where })) > 0) return true;

  const assistanceWhere = await resolveMonthlyChecklistVehicleWhere(
    prisma,
    actor,
    'ASSISTANCE',
  );
  return assistanceWhere
    ? (await prisma.vehicle.count({ where: assistanceWhere })) > 0
    : false;
}
