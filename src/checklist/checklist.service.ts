import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChecklistDto, userId: string) {
    const now = new Date();

    return this.prisma.checklist.create({
      data: {
        title: dto.title,
        vehicleId: dto.vehicleId,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        status: 'aberto',
        createdBy: userId,
        items: {
          create: dto.items.map((item) => ({
            label: item.label,
            ok: item.ok,
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }

  async findAll() {
    return this.prisma.checklist.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
      },
    });
  }
}