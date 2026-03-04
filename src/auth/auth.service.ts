import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: LoginDto) {
    const { email, password } = dto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Sempre padroniza role para minúsculo
    const role = (user.role || '').toLowerCase();

    let valid = false;

    // 1️⃣ Tenta comparar como hash (bcrypt)
    try {
      valid = await bcrypt.compare(password, user.password);
    } catch {
      valid = false;
    }

    // 2️⃣ Se não for hash ainda (senha antiga em texto puro),
    // compara direto e já converte para hash automaticamente
    if (!valid && user.password === password) {
      valid = true;

      const hashed = await bcrypt.hash(password, 10);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashed,
          role, // já aproveita para padronizar no banco
        },
      });
    }

    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role,
      tipoFrota: user.tipoFrota ?? null,
    };

    return {
      token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        tipoFrota: user.tipoFrota ?? null,
      },
    };
  }
}