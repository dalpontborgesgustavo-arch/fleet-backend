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
    return true;
  }
}
