import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.prisma.checklistTemplate.create({
      data: {
        name: body.name,
        vehicleType: body.vehicleType,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.prisma.checklistTemplate.update({
      where: { id },
      data: {
        name: body.name,
        vehicleType: body.vehicleType,
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
}
