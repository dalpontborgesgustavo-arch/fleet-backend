import { PrismaService } from '../prisma/prisma.service';
import { normalizeFilial, type FilialValue } from './filial';

export type AuthenticatedActor = {
  sub?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  canExecuteMaintenance?: boolean | null;
};

export type SupervisorFleetScope = {
  tipoFrota?: string;
  filial: FilialValue;
};

const ALL_FLEET_TYPES = 'todos';

/**
 * Retorna:
 * - undefined para perfis sem restricao de frota;
 * - null para supervisor sem escopo valido (acesso negado por seguranca);
 * - tipoFrota + filial para supervisor comum;
 * - somente filial quando o supervisor estiver configurado como Todos.
 *
 * O escopo e relido do banco para uma alteracao administrativa de filial ou
 * tipo de frota valer imediatamente, mesmo com um token antigo ainda ativo.
 */
export async function resolveSupervisorFleetScope(
  prisma: PrismaService,
  actor?: AuthenticatedActor | null,
): Promise<SupervisorFleetScope | null | undefined> {
  if ((actor?.role || '').trim().toLowerCase() !== 'supervisor') {
    return undefined;
  }

  if (!actor?.sub) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: { role: true, tipoFrota: true, filial: true },
  });

  if (
    !user ||
    user.role.trim().toLowerCase() !== 'supervisor' ||
    !user.tipoFrota?.trim()
  ) {
    return null;
  }

  const tipoFrota = user.tipoFrota.trim();
  const filial = normalizeFilial(user.filial);

  return tipoFrota.toLowerCase() === ALL_FLEET_TYPES
    ? { filial }
    : { tipoFrota, filial };
}
