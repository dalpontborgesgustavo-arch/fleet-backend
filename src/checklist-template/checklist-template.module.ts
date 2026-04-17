import { Module } from '@nestjs/common';
import { ChecklistTemplateController } from './checklist-template.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ChecklistTemplateController],
  providers: [PrismaService],
})
export class ChecklistTemplateModule {}
