import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ChecklistService } from './checklist.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('checklists')
export class ChecklistController {
  constructor(private readonly checklistService: ChecklistService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateChecklistDto) {
    const userId = req.user.sub;
    return this.checklistService.create(dto, userId);
  }

  @Get()
  findAll() {
    return this.checklistService.findAll();
  }
}