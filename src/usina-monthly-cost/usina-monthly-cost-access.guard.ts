import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canAccessUsinaMonthlyCost } from './usina-monthly-cost.rules';

@Injectable()
export class UsinaMonthlyCostAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!canAccessUsinaMonthlyCost(request.user?.role)) {
      throw new ForbiddenException(
        'Somente Licitacao e Administrador podem acessar a configuracao mensal de custos da Usina',
      );
    }
    return true;
  }
}
