import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  canAccessUsinaAsphaltTeamSettings,
  canAccessUsinaAsphaltTeams,
} from './usina-asphalt-teams.rules';

@Injectable()
export class UsinaAsphaltTeamsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (
      !canAccessUsinaAsphaltTeams(request.user?.role) &&
      !canAccessUsinaAsphaltTeamSettings(request.user?.role)
    ) {
      throw new ForbiddenException(
        'Sem permissao para acessar as equipes de asfalto',
      );
    }
    if (
      String(request.user?.role ?? '').trim().toLowerCase() === 'ceo' &&
      request.method !== 'GET'
    ) {
      throw new ForbiddenException('Perfil CEO pode consultar, mas nao alterar equipes de asfalto');
    }
    return true;
  }
}
