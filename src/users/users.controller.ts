import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function getManageableRoles(role?: string | null): string[] {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'admin') {
    return ['motorista', 'manutencao', 'manutentor', 'supervisor', 'gestor', 'compras', 'admin'];
  }

  if (normalizedRole === 'manutencao') {
    return ['manutentor'];
  }

  if (normalizedRole === 'supervisor') {
    return ['motorista'];
  }

  return [];
}

@UseGuards(JwtGuard)
@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private ensureCanManageRole(actorRole?: string | null, targetRole?: string | null) {
    const manageableRoles = getManageableRoles(actorRole);
    const normalizedTargetRole = normalizeRole(targetRole);

    if (!manageableRoles.includes(normalizedTargetRole)) {
      throw new ForbiddenException('Sem permissao para gerenciar esse perfil');
    }
  }

  @Get()
  async findAll(@Req() req: any, @Query('scope') scope?: string) {
    const actorRole = normalizeRole(req.user?.role);

    if (scope === 'manageable') {
      const manageableRoles = getManageableRoles(actorRole);
      return this.prisma.user.findMany({
        where: {
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
      orderBy: {
        name: 'asc',
      },
    });
  }

  @Post()
  async create(@Req() req: any, @Body() data: any) {
    const actorRole = normalizeRole(req.user?.role);
    this.ensureCanManageRole(actorRole, data.role);

    const hashed = await bcrypt.hash(data.password, 10);
    const role = normalizeRole(data.role);

    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role,
        tipoFrota: role === 'supervisor' ? data.tipoFrota ?? null : null,
      },
    });
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

    const updateData: any = {
      email: data.email,
      name: data.name,
      role: nextRole,
      tipoFrota: nextRole === 'supervisor' ? data.tipoFrota ?? existing.tipoFrota ?? null : null,
    };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const actorRole = normalizeRole(req.user?.role);
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    this.ensureCanManageRole(actorRole, existing.role);

    return this.prisma.user.delete({
      where: { id },
    });
  }
}
