import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.vehicle.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: any) {
    return this.prisma.vehicle.create({ data });
  }

  update(id: string, data: any) {
    return this.prisma.vehicle.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.vehicle.delete({
      where: { id },
    });
  }
}
