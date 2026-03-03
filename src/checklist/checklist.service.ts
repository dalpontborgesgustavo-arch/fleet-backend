import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createdBy: string, dto: CreateChecklistDto) {
    const now = new Date();

    return this.prisma.checklist.create({
      data: {
        title: dto.title,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        createdBy,
        items: dto.items?.length
          ? {
              create: dto.items.map((i) => ({
                label: i.label,
                ok: i.ok,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  }

  async list() {
    return this.prisma.checklist.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }
}