import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { USERS } from './users.seed';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async login(dto: LoginDto) {
    const user = USERS.find(
      (u) => u.email === dto.email && u.password === dto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tipoFrota: ('tipoFrota' in user ? (user as any).tipoFrota : null),
    };

    const token = this.jwtService.sign(payload);

    const { password, ...safeUser } = user as any;

    return { token, user: safeUser };
  }
}