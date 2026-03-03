import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    try {
      const payload = this.jwtService.verify(token);
      req.user = payload; // aqui salvamos o usuário na requisição
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}