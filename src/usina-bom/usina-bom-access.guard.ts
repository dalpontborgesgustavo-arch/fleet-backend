import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { canAccessUsinaBom } from './usina-bom.rules';

@Injectable()
export class UsinaBomAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!canAccessUsinaBom(request.user?.role)) {
      throw new ForbiddenException(
        'Somente Qualidade e Administrador podem acessar as estruturas da Usina',
      );
    }
    return true;
  }
}
