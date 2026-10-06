import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { canAccessCostPurchases } from './cost-purchases.rules';

@Injectable()
export class CostPurchasesAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!canAccessCostPurchases(request.user?.role)) {
      throw new ForbiddenException(
        'Somente Compras e Administrador podem acessar Custos Compras',
      );
    }
    return true;
  }
}
