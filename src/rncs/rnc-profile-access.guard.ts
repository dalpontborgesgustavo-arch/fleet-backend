import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

function normalizeRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

@Injectable()
export class RncProfileAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const role = normalizeRole(request.user?.role);

    if (role === 'motorista' || role === 'operador') {
      throw new ForbiddenException(
        'O perfil Motorista / Operador nao possui acesso a RNCs',
      );
    }

    return true;
  }
}
