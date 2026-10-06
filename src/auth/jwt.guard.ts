import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Token invalido');
    }

    const userId = typeof payload?.sub === 'string' ? payload.sub : '';
    let user;
    try {
      user = userId
        ? await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              tipoFrota: true,
              filial: true,
              canAccessTopographyInventory: true,
              canExecuteMaintenance: true,
              canAccessFleetTracking: true,
              canAccessFleetOverview: true,
              canAccessFleetUtilization: true,
              canAccessFleetAlerts: true,
              canAccessFleetVideo: true,
              canAccessBucketActivations: true,
              active: true,
              mustChangePassword: true,
            },
          })
        : null;
    } catch (error) {
      console.error('Falha temporaria ao validar a sessao no banco:', error);
      throw new ServiceUnavailableException(
        'Servico temporariamente indisponivel. Tente novamente em instantes.',
      );
    }

    if (!user || user.active === false) {
      throw new UnauthorizedException('Usuario inativo ou nao encontrado.');
    }

    req.user = {
      ...payload,
      sub: user.id,
      email: user.email,
      name: user.name,
      role: (user.role || '').toLowerCase(),
      tipoFrota: user.tipoFrota ?? null,
      filial: user.filial,
      canAccessTopographyInventory: user.canAccessTopographyInventory === true,
      canExecuteMaintenance: user.canExecuteMaintenance === true,
      canAccessFleetTracking: user.canAccessFleetTracking === true,
      canAccessFleetOverview: user.canAccessFleetOverview === true,
      canAccessFleetUtilization: user.canAccessFleetUtilization === true,
      canAccessFleetAlerts: user.canAccessFleetAlerts === true,
      canAccessFleetVideo: user.canAccessFleetVideo === true,
      canAccessBucketActivations: user.canAccessBucketActivations === true,
      mustChangePassword: user.mustChangePassword === true,
      canAccessMonthlyChecklist: payload.canAccessMonthlyChecklist === true,
    };

    const path = String(req.path || req.url || '');
    const isPasswordChangeRoute = path.startsWith('/auth/change-password');

    if (req.user.mustChangePassword === true && !isPasswordChangeRoute) {
      throw new ForbiddenException('Redefina sua senha para continuar.');
    }

    return true;
  }
}
