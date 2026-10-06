import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ChecklistTemplateBody = {
  name?: unknown;
  vehicleType?: unknown;
  fleetNumbers?: unknown;
};

@Controller('checklist-templates')
export class ChecklistTemplateController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.checklistTemplate.findMany({
      include: {
        questions: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  @Post()
  async create(@Body() body: any) {
    const data = this.normalizeTemplateBody(body);
    await this.ensureScopeIsAvailable(data.vehicleType, data.fleetNumbers);

    return this.prisma.checklistTemplate.create({
      data: {
        name: data.name,
        vehicleType: data.vehicleType,
        fleetNumbers: data.fleetNumbers,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const data = this.normalizeTemplateBody(body);
    await this.ensureScopeIsAvailable(data.vehicleType, data.fleetNumbers, id);

    return this.prisma.checklistTemplate.update({
      where: { id },
      data: {
        name: data.name,
        vehicleType: data.vehicleType,
        fleetNumbers: data.fleetNumbers,
      },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.prisma.checklistTemplate.delete({
      where: { id },
    });
  }

  @Post(':id/questions')
  async createQuestion(@Param('id') id: string, @Body() body: any) {
    return this.prisma.checklistQuestion.create({
      data: {
        templateId: id,
        question: body.question,
        critical: !!body.critical,
      },
    });
  }

  @Put(':templateId/questions/:questionId')
  async updateQuestion(
    @Param('templateId') templateId: string,
    @Param('questionId') questionId: string,
    @Body() body: any,
  ) {
    return this.prisma.checklistQuestion.update({
      where: { id: questionId },
      data: {
        question: body.question,
        critical: !!body.critical,
      },
    });
  }

  @Delete(':templateId/questions/:questionId')
  async deleteQuestion(
    @Param('templateId') templateId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.prisma.checklistQuestion.delete({
      where: { id: questionId },
    });
  }

  private normalizeTemplateBody(body: ChecklistTemplateBody) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const vehicleType =
      typeof body.vehicleType === 'string' ? body.vehicleType.trim() : '';
    const fleetNumbers = this.normalizeFleetNumbers(body.fleetNumbers);

    if (!name) {
      throw new BadRequestException('Nome do checklist é obrigatório.');
    }

    if (!vehicleType) {
      throw new BadRequestException('Tipo de veículo é obrigatório.');
    }

    return { name, vehicleType, fleetNumbers };
  }

  private normalizeFleetNumbers(value: unknown): string[] {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[\n,;]+/)
        : [];

    const unique = new Map<string, string>();

    rawItems.forEach((item) => {
      const trimmed = String(item).trim();
      const key = this.normalizeFleetNumber(trimmed);

      if (key && !unique.has(key)) {
        unique.set(key, trimmed);
      }
    });

    return Array.from(unique.values());
  }

  private async ensureScopeIsAvailable(
    vehicleType: string,
    fleetNumbers: string[],
    currentId?: string,
  ) {
    const sameTypeTemplates = await this.prisma.checklistTemplate.findMany({
      where: {
        vehicleType,
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
      select: {
        name: true,
        fleetNumbers: true,
      },
    });

    if (fleetNumbers.length === 0) {
      const genericConflict = sameTypeTemplates.find(
        (template) => template.fleetNumbers.length === 0,
      );

      if (genericConflict) {
        throw new BadRequestException(
          `Já existe um checklist genérico para este tipo de veículo: ${genericConflict.name}.`,
        );
      }

      return;
    }

    const normalizedFleetNumbers = fleetNumbers.map((fleet) =>
      this.normalizeFleetNumber(fleet),
    );
    const specificConflict = sameTypeTemplates.find((template) =>
      template.fleetNumbers.some((fleet) =>
        normalizedFleetNumbers.includes(this.normalizeFleetNumber(fleet)),
      ),
    );

    if (specificConflict) {
      const conflictFleet = fleetNumbers.find((fleet) =>
        specificConflict.fleetNumbers.some(
          (existingFleet) =>
            this.normalizeFleetNumber(existingFleet) ===
            this.normalizeFleetNumber(fleet),
        ),
      );

      throw new BadRequestException(
        `A frota ${conflictFleet ?? ''} já está vinculada ao checklist ${specificConflict.name}.`,
      );
    }
  }

  private normalizeFleetNumber(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (/^\d+$/.test(normalized)) {
      return normalized.replace(/^0+/, '') || '0';
    }

    return normalized;
  }
}
