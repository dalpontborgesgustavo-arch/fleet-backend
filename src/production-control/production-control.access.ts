import { ForbiddenException } from '@nestjs/common';

export interface ProductionActor {
  sub?: string;
  role?: string | null;
  canManageProductionControl?: boolean;
}

export function assertProductionAccess(actor?: ProductionActor): string {
  if (
    !actor?.sub ||
    (actor.role !== 'admin' && actor.canManageProductionControl !== true)
  ) {
    throw new ForbiddenException('Acesso restrito ao Controle de Produção.');
  }
  return actor.sub;
}
