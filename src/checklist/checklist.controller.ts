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
    const userId = req.user.sub;
    return this.checklistService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtGuard)
  findAll(@Req() req: any) {
    return this.checklistService.findAll(req.user);
  }

  @Get('history')
  @UseGuards(JwtGuard)
  findHistory(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.checklistService.findHistory(query, req.user);
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
