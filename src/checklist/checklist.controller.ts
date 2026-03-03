import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ChecklistService } from './checklist.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('checklists')
@UseGuards(JwtGuard)
export class ChecklistController {
  constructor(private readonly checklistService: ChecklistService) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateChecklistDto) {
    const userId = req.user?.sub;
    return this.checklistService.create(userId, dto);
  }

  @Get()
  async list() {
    return this.checklistService.list();
  }
}