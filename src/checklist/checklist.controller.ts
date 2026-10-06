import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChecklistService } from './checklist.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { ChecklistConsentService } from './checklist-consent.service';

@Controller('checklists')
export class ChecklistController {
  constructor(
    private readonly checklistService: ChecklistService,
    private readonly checklistConsentService: ChecklistConsentService,
  ) {}

  @UseGuards(JwtGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateChecklistDto) {
    return this.checklistService.create(dto, req.user);
  }

  @Get('monthly-vehicles')
  @UseGuards(JwtGuard)
  findMonthlyVehicles(@Req() req: any, @Query('mode') mode?: string) {
    return this.checklistService.findMonthlyVehicles(req.user, mode);
  }

  @Get('monthly-workforce')
  @UseGuards(JwtGuard)
  findMonthlyWorkforce(
    @Req() req: any,
    @Query('competence') competence?: string,
    @Query('search') search?: string,
  ) {
    return this.checklistService.findMonthlyWorkforce(req.user, competence, search);
  }

  @Get()
  @UseGuards(JwtGuard)
  findAll(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.checklistService.findAll(req.user, query);
  }

  @Get('history')
  @UseGuards(JwtGuard)
  findHistory(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.checklistService.findHistory(query, req.user);
  }

  @Get('history/:id')
  @UseGuards(JwtGuard)
  findHistoryDetail(@Req() req: any, @Param('id') id: string) {
    return this.checklistService.findHistoryDetail(id, req.user);
  }

  @Get('ti-report')
  @UseGuards(JwtGuard)
  findTiReport(@Req() req: any) {
    const role = (req.user?.role || '').trim().toLowerCase();
    if (role !== 'ti' && role !== 'admin') {
      throw new ForbiddenException(
        'Relatorios exclusivos dos perfis TI e Administrador.',
      );
    }

    return this.checklistService.findTiReport();
  }

  @Get('consent/:token')
  findConsent(@Param('token') token: string) {
    return this.checklistConsentService.findByToken(token);
  }

  @Post('consent/:token/respond')
  respondConsent(
    @Param('token') token: string,
    @Body() body: { action?: unknown; note?: unknown },
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const action = body?.action === 'REJECTED' ? 'REJECTED' : 'CONFIRMED';

    return this.checklistConsentService.respondToConsent(
      token,
      action,
      body?.note,
      ip,
      userAgent,
    );
  }
}
