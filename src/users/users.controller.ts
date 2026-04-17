import { Controller, Get, Post, Body, Delete, Param, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.user.findMany();
  }

  @Post()
  async create(@Body() data: any) {
    const hashed = await bcrypt.hash(data.password, 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role: data.role,
        tipoFrota: data.tipoFrota ?? null,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    const updateData: any = {
      email: data.email,
      name: data.name,
      role: data.role,
      tipoFrota: data.tipoFrota ?? null,
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
  async delete(@Param('id') id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
