import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { EmailService } from '../email/email.service';
import { normalizeFilial } from '../common/filial';

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function getManageableRoles(role?: string | null): string[] {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'admin') {
    return [
      'motorista',
      'manutencao',
      'manutentor',
      'supervisor',
      'supervisor_apoio',
      'gestor',
      'ceo',
      'compras',
      'engenharia',
      'topografia',
      'prumare',
      'prumare_admin',
      'corretor',
      'orcamento',
      'administrativo',
      'financeiro',
      'contabilidade',
      'ti',
      'juridico',
      'consultor',
      'rh',
      'vendas',
      'ssma',
      'qualidade',
      'almoxarifado',
      'licitacao',
      'licitacao_gestor',
      'usina_icara',
      'loja_jr',
      'admin',
    ];
  }

  if (normalizedRole === 'manutencao') {
    return ['manutentor'];
  }

  if (
    normalizedRole === 'supervisor' ||
    normalizedRole === 'supervisor_apoio'
  ) {
    return ['motorista'];
  }

  if (normalizedRole === 'prumare_admin' || normalizedRole === 'ceo') {
    return ['prumare', 'corretor'];
  }

  return [];
}

@UseGuards(JwtGuard)
@Controller('users')
export class UsersController {
  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private ensureCanManageRole(
    actorRole?: string | null,
    targetRole?: string | null,
  ) {
    const manageableRoles = getManageableRoles(actorRole);
    const normalizedTargetRole = normalizeRole(targetRole);

    if (!manageableRoles.includes(normalizedTargetRole)) {
      throw new ForbiddenException('Sem permissao para gerenciar esse perfil');
    }
  }

  private async ensureSingleSharedDriverProfile(excludedUserId?: string) {
    const existingSharedProfile = await this.prisma.user.findFirst({
      where: {
        ...(excludedUserId ? { id: { not: excludedUserId } } : {}),
        active: true,
        OR: [
          { role: { equals: 'motorista', mode: 'insensitive' } },
          { role: { equals: 'operador', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (existingSharedProfile) {
      throw new BadRequestException(
        'Ja existe a conta universal de Motorista / Operador.',
      );
    }
  }

  @Get()
  async findAll(
    @Req() req: any,
    @Query('scope') scope?: string,
    @Query('status') status?: string,
  ) {
    const actorRole = normalizeRole(req.user?.role);
    const normalizedStatus = (status || 'active').trim().toLowerCase();

    if (!['active', 'inactive', 'all'].includes(normalizedStatus)) {
      throw new BadRequestException('Filtro de status invalido');
    }

    const statusWhere =
      normalizedStatus === 'all'
        ? {}
        : { active: normalizedStatus === 'active' };

    if (scope === 'manageable') {
      const manageableRoles = getManageableRoles(actorRole);
      return this.prisma.user.findMany({
        where: {
          ...statusWhere,
          role: {
            in: manageableRoles,
          },
        },
        orderBy: {
          name: 'asc',
        },
      });
    }

    return this.prisma.user.findMany({
      where: statusWhere,
      orderBy: {
        name: 'asc',
      },
    });
  }

  @Post()
  async create(@Req() req: any, @Body() data: any) {
    const actorRole = normalizeRole(req.user?.role);
    this.ensureCanManageRole(actorRole, data.role);

    const role = normalizeRole(data.role);
    if (role === 'motorista' || role === 'operador') {
      await this.ensureSingleSharedDriverProfile();
    }

    const hashed = await bcrypt.hash(data.password, 10);

    const temporaryPassword = String(data.password || '');
    const fleetAccess = normalizeFinancialFleetAccess(role, data);
    const created = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role,
        mustChangePassword: true,
        phone: normalizeOptionalText(data.phone),
        city: normalizeOptionalText(data.city),
        tipoFrota: role === 'supervisor' ? (data.tipoFrota ?? null) : null,
        filial: normalizeFilial(data.filial),
        canAccessTopographyInventory:
          role === 'topografia' && data.canAccessTopographyInventory === true,
        ...fleetAccess,
      },
    });

    const welcomeEmail = await this.emailService.sendMail(
      buildWelcomeEmail({
        name: created.name,
        email: created.email,
        temporaryPassword,
      }),
    );

    return {
      ...created,
      welcomeEmailSent: welcomeEmail.sent,
    };
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    const actorRole = normalizeRole(req.user?.role);
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    this.ensureCanManageRole(actorRole, existing.role);

    const nextRole = normalizeRole(data.role ?? existing.role);
    this.ensureCanManageRole(actorRole, nextRole);
    if (nextRole === 'motorista' || nextRole === 'operador') {
      await this.ensureSingleSharedDriverProfile(id);
    }

    const fleetAccess = normalizeFinancialFleetAccess(nextRole, data, existing);

    const updateData: any = {
      email: data.email,
      name: data.name,
      role: nextRole,
      phone:
        data.phone === undefined
          ? existing.phone
          : normalizeOptionalText(data.phone),
      city:
        data.city === undefined
          ? existing.city
          : normalizeOptionalText(data.city),
      tipoFrota:
        nextRole === 'supervisor'
          ? (data.tipoFrota ?? existing.tipoFrota ?? null)
          : null,
      filial:
        data.filial === undefined
          ? existing.filial
          : normalizeFilial(data.filial),
      canAccessTopographyInventory:
        nextRole === 'topografia'
          ? data.canAccessTopographyInventory === undefined
            ? existing.canAccessTopographyInventory
            : data.canAccessTopographyInventory === true
          : false,
      ...fleetAccess,
    };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
      updateData.mustChangePassword = true;
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  @Put(':id/status')
  async updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    if (typeof data?.active !== 'boolean') {
      throw new BadRequestException('Informe um status valido para o usuario');
    }

    return this.setActiveStatus(req, id, data.active);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.setActiveStatus(req, id, false);
  }

  private async setActiveStatus(req: any, id: string, active: boolean) {
    const actorRole = normalizeRole(req.user?.role);
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    this.ensureCanManageRole(actorRole, existing.role);

    if (!active && req.user?.sub === id) {
      throw new BadRequestException(
        'Voce nao pode inativar seu proprio usuario',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { active },
    });

    if (!active) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  }
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFinancialFleetAccess(
  role: string,
  data: any,
  existing?: {
    role?: string | null;
    canAccessFleetTracking?: boolean | null;
    canAccessFleetOverview?: boolean | null;
    canAccessFleetUtilization?: boolean | null;
    canAccessFleetAlerts?: boolean | null;
    canAccessFleetVideo?: boolean | null;
    canAccessBucketActivations?: boolean | null;
  },
) {
  if (role !== 'financeiro') {
    return {
      canAccessFleetTracking: false,
      canAccessFleetOverview: false,
      canAccessFleetUtilization: false,
      canAccessFleetAlerts: false,
      canAccessFleetVideo: false,
      canAccessBucketActivations: false,
    };
  }

  const preserved = normalizeRole(existing?.role) === 'financeiro';
  const canAccessFleetTracking =
    data.canAccessFleetTracking === undefined && preserved
      ? existing?.canAccessFleetTracking === true
      : data.canAccessFleetTracking === true;
  const canAccessFleetOverview =
    canAccessFleetTracking &&
    (data.canAccessFleetOverview === undefined && preserved
      ? existing?.canAccessFleetOverview === true
      : data.canAccessFleetOverview === true);
  const canAccessFleetUtilization =
    canAccessFleetTracking &&
    (data.canAccessFleetUtilization === undefined && preserved
      ? existing?.canAccessFleetUtilization === true
      : data.canAccessFleetUtilization === true);
  const canAccessFleetAlerts =
    canAccessFleetTracking &&
    (data.canAccessFleetAlerts === undefined && preserved
      ? existing?.canAccessFleetAlerts === true
      : data.canAccessFleetAlerts === true);
  const canAccessFleetVideo =
    canAccessFleetTracking &&
    (data.canAccessFleetVideo === undefined && preserved
      ? existing?.canAccessFleetVideo === true
      : data.canAccessFleetVideo === true);
  const canAccessBucketActivations =
    canAccessFleetTracking &&
    (data.canAccessBucketActivations === undefined && preserved
      ? existing?.canAccessBucketActivations === true
      : data.canAccessBucketActivations === true);

  if (
    canAccessFleetTracking &&
    !canAccessFleetOverview &&
    !canAccessFleetUtilization &&
    !canAccessFleetAlerts &&
    !canAccessFleetVideo &&
    !canAccessBucketActivations
  ) {
    throw new BadRequestException(
      'Selecione pelo menos uma visao do Rastreamento de Frota',
    );
  }

  return {
    canAccessFleetTracking,
    canAccessFleetOverview,
    canAccessFleetUtilization,
    canAccessFleetAlerts,
    canAccessFleetVideo,
    canAccessBucketActivations,
  };
}

function buildWelcomeEmail(input: {
  name: string;
  email: string;
  temporaryPassword: string;
}) {
  const loginUrl = (
    process.env.APP_PUBLIC_URL?.trim() || 'https://app.jrconstrucoes.net.br'
  ).replace(/\/+$/, '');
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.temporaryPassword);
  const safeLoginUrl = escapeHtml(loginUrl);

  return {
    to: input.email,
    subject: 'Seu acesso ao Sistema JR',
    text: [
      `Olá, ${input.name}.`,
      '',
      'Seu acesso ao Sistema JR foi criado.',
      `Link para o primeiro login: ${loginUrl}`,
      `Usuário: ${input.email}`,
      `Senha temporária: ${input.temporaryPassword}`,
      '',
      'No primeiro login, o sistema solicitará a criação de uma nova senha.',
    ].join('\n'),
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
          <div style="max-width:620px;margin:0 auto;padding:24px">
            <div style="overflow:hidden;border-radius:12px;background:#ffffff;box-shadow:0 8px 24px rgba(0,0,0,.08)">
              <div style="background:#b91c1c;padding:22px 28px;color:#ffffff">
                <div style="font-size:22px;font-weight:800">Sistema JR</div>
                <div style="margin-top:4px;font-size:13px;opacity:.9">Primeiro acesso</div>
              </div>
              <div style="padding:28px">
                <p style="margin:0 0 16px;font-size:16px">Olá, <strong>${name}</strong>.</p>
                <p style="margin:0 0 20px;line-height:1.6">Seu acesso ao Sistema JR foi criado. Use os dados abaixo para realizar o primeiro login:</p>
                <div style="border:1px solid #fecaca;border-radius:10px;background:#fff7f7;padding:18px">
                  <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#7f1d1d">Usuário</div>
                  <div style="margin-top:4px;font-size:16px;font-weight:700">${email}</div>
                  <div style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;color:#7f1d1d">Senha temporária</div>
                  <div style="margin-top:4px;font-size:16px;font-weight:700">${password}</div>
                </div>
                <div style="margin-top:24px;text-align:center">
                  <a href="${safeLoginUrl}" style="display:inline-block;border-radius:8px;background:#b91c1c;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:800">Fazer primeiro login</a>
                </div>
                <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#6b7280">Por segurança, o sistema solicitará a criação de uma nova senha no primeiro acesso.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
