import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { canAccessMonthlyChecklist } from '../common/monthly-checklist-access';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    if (user.active === false) {
      throw new UnauthorizedException(
        'Usuario inativo. Contate o administrador.',
      );
    }

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

    return this.createAuthResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      tipoFrota: user.tipoFrota,
      filial: user.filial,
      canAccessTopographyInventory: user.canAccessTopographyInventory,
      canExecuteMaintenance: user.canExecuteMaintenance,
      canAccessFleetTracking: user.canAccessFleetTracking,
      canAccessFleetOverview: user.canAccessFleetOverview,
      canAccessFleetUtilization: user.canAccessFleetUtilization,
      canAccessFleetAlerts: user.canAccessFleetAlerts,
      canAccessFleetVideo: user.canAccessFleetVideo,
      canAccessBucketActivations: user.canAccessBucketActivations,
      mustChangePassword: user.mustChangePassword,
    });
  }

  async refreshSession(refreshToken?: string) {
    const normalizedToken =
      typeof refreshToken === 'string' ? refreshToken.trim() : '';

    if (!normalizedToken) {
      throw new UnauthorizedException('Sessao expirada. Faca login novamente.');
    }

    const tokenHash = this.hashRefreshToken(normalizedToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Sessao expirada. Faca login novamente.');
    }

    if (storedToken.user.active === false) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Usuario inativo. Contate o administrador.',
      );
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { lastUsedAt: new Date() },
    });

    const role = (storedToken.user.role || '').toLowerCase();

    return this.createAuthResponse(
      {
        id: storedToken.user.id,
        email: storedToken.user.email,
        name: storedToken.user.name,
        role,
        tipoFrota: storedToken.user.tipoFrota,
        filial: storedToken.user.filial,
        canAccessTopographyInventory:
          storedToken.user.canAccessTopographyInventory,
        canExecuteMaintenance: storedToken.user.canExecuteMaintenance,
        canAccessFleetTracking: storedToken.user.canAccessFleetTracking,
        canAccessFleetOverview: storedToken.user.canAccessFleetOverview,
        canAccessFleetUtilization:
          storedToken.user.canAccessFleetUtilization,
        canAccessFleetAlerts: storedToken.user.canAccessFleetAlerts,
        canAccessFleetVideo: storedToken.user.canAccessFleetVideo,
        canAccessBucketActivations:
          storedToken.user.canAccessBucketActivations,
        mustChangePassword: storedToken.user.mustChangePassword,
      },
      normalizedToken,
      storedToken.expiresAt,
    );
  }

  async logout(refreshToken?: string) {
    const normalizedToken =
      typeof refreshToken === 'string' ? refreshToken.trim() : '';

    if (!normalizedToken) {
      return { ok: true };
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(normalizedToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  }

  private async createAuthResponse(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      tipoFrota?: string | null;
      filial?: string | null;
      canAccessTopographyInventory?: boolean | null;
      canExecuteMaintenance?: boolean | null;
      canAccessFleetTracking?: boolean | null;
      canAccessFleetOverview?: boolean | null;
      canAccessFleetUtilization?: boolean | null;
      canAccessFleetAlerts?: boolean | null;
      canAccessFleetVideo?: boolean | null;
      canAccessBucketActivations?: boolean | null;
      mustChangePassword?: boolean | null;
    },
    existingRefreshToken?: string,
    existingRefreshExpiresAt?: Date,
  ) {
    const monthlyChecklistAccess = await canAccessMonthlyChecklist(
      this.prisma,
      {
        sub: user.id,
        role: user.role,
      },
    );
    const payload = this.createTokenPayload({
      id: user.id,
      email: user.email,
      role: user.role,
      tipoFrota: user.tipoFrota,
      filial: user.filial,
      canAccessTopographyInventory: user.canAccessTopographyInventory,
      canExecuteMaintenance: user.canExecuteMaintenance,
      canAccessFleetTracking: user.canAccessFleetTracking,
      canAccessFleetOverview: user.canAccessFleetOverview,
      canAccessFleetUtilization: user.canAccessFleetUtilization,
      canAccessFleetAlerts: user.canAccessFleetAlerts,
      canAccessFleetVideo: user.canAccessFleetVideo,
      canAccessBucketActivations: user.canAccessBucketActivations,
      mustChangePassword: user.mustChangePassword,
      canAccessMonthlyChecklist: monthlyChecklistAccess,
    });
    const refreshSession =
      existingRefreshToken && existingRefreshExpiresAt
        ? {
            token: existingRefreshToken,
            expiresAt: existingRefreshExpiresAt,
          }
        : await this.issueRefreshToken(user.id);

    return {
      token: this.jwtService.sign(payload),
      refreshToken: refreshSession.token,
      refreshExpiresAt: refreshSession.expiresAt.toISOString(),
      user: this.serializeUser({
        ...user,
        canAccessMonthlyChecklist: monthlyChecklistAccess,
      }),
    };
  }

  async changeTemporaryPassword(userId: string, newPassword?: string) {
    const normalizedPassword =
      typeof newPassword === 'string' ? newPassword.trim() : '';

    if (normalizedPassword.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter pelo menos 6 caracteres.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    if (user.active === false) {
      throw new ForbiddenException('Usuario inativo. Contate o administrador.');
    }

    if (!user.mustChangePassword) {
      throw new ForbiddenException(
        'A senha deste usuario ja foi redefinida. Solicite alteracao ao administrador.',
      );
    }

    const isSamePassword =
      user.password === normalizedPassword ||
      (await bcrypt
        .compare(normalizedPassword, user.password)
        .catch(() => false));

    if (isSamePassword) {
      throw new BadRequestException(
        'Escolha uma senha diferente da senha temporaria.',
      );
    }

    const role = (user.role || '').toLowerCase();
    const hashed = await bcrypt.hash(normalizedPassword, 10);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        role,
        mustChangePassword: false,
      },
    });

    await this.revokeUserRefreshTokens(user.id);

    return this.createAuthResponse(updated);
  }

  private createTokenPayload(user: {
    id: string;
    email: string;
    role: string;
    tipoFrota?: string | null;
    filial?: string | null;
    canAccessTopographyInventory?: boolean | null;
    canExecuteMaintenance?: boolean | null;
    canAccessFleetTracking?: boolean | null;
    canAccessFleetOverview?: boolean | null;
    canAccessFleetUtilization?: boolean | null;
    canAccessFleetAlerts?: boolean | null;
    canAccessFleetVideo?: boolean | null;
    canAccessBucketActivations?: boolean | null;
    mustChangePassword?: boolean | null;
    canAccessMonthlyChecklist?: boolean | null;
  }) {
    return {
      sub: user.id,
      email: user.email,
      role: (user.role || '').toLowerCase(),
      tipoFrota: user.tipoFrota ?? null,
      filial: user.filial ?? 'MATRIZ',
      canAccessTopographyInventory: user.canAccessTopographyInventory === true,
      canExecuteMaintenance: user.canExecuteMaintenance === true,
      canAccessFleetTracking: user.canAccessFleetTracking === true,
      canAccessFleetOverview: user.canAccessFleetOverview === true,
      canAccessFleetUtilization: user.canAccessFleetUtilization === true,
      canAccessFleetAlerts: user.canAccessFleetAlerts === true,
      canAccessFleetVideo: user.canAccessFleetVideo === true,
      canAccessBucketActivations: user.canAccessBucketActivations === true,
      mustChangePassword: user.mustChangePassword === true,
      canAccessMonthlyChecklist: user.canAccessMonthlyChecklist === true,
    };
  }

  private serializeUser(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    tipoFrota?: string | null;
    filial?: string | null;
    canAccessTopographyInventory?: boolean | null;
    canExecuteMaintenance?: boolean | null;
    canAccessFleetTracking?: boolean | null;
    canAccessFleetOverview?: boolean | null;
    canAccessFleetUtilization?: boolean | null;
    canAccessFleetAlerts?: boolean | null;
    canAccessFleetVideo?: boolean | null;
    canAccessBucketActivations?: boolean | null;
    mustChangePassword?: boolean | null;
    canAccessMonthlyChecklist?: boolean | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user.role || '').toLowerCase(),
      tipoFrota: user.tipoFrota ?? null,
      filial: user.filial ?? 'MATRIZ',
      canAccessTopographyInventory: user.canAccessTopographyInventory === true,
      canExecuteMaintenance: user.canExecuteMaintenance === true,
      canAccessFleetTracking: user.canAccessFleetTracking === true,
      canAccessFleetOverview: user.canAccessFleetOverview === true,
      canAccessFleetUtilization: user.canAccessFleetUtilization === true,
      canAccessFleetAlerts: user.canAccessFleetAlerts === true,
      canAccessFleetVideo: user.canAccessFleetVideo === true,
      canAccessBucketActivations: user.canAccessBucketActivations === true,
      mustChangePassword: user.mustChangePassword === true,
      canAccessMonthlyChecklist: user.canAccessMonthlyChecklist === true,
    };
  }

  private async issueRefreshToken(userId: string) {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.getRefreshTokenDays());

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(token),
        userId,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  private async revokeUserRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenDays() {
    const configuredDays = Number(
      this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS') ?? '180',
    );

    return Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : 180;
  }
}
