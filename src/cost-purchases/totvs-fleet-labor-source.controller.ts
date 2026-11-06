import {
  Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { TotvsFleetLaborSourceService } from './totvs-fleet-labor-source.service';

const ADMIN_ROLES = new Set(['admin', 'administrador']);

@UseGuards(JwtGuard)
@Controller('lucas-fleet-results/labor-source')
export class TotvsFleetLaborSourceController {
  constructor(private readonly source: TotvsFleetLaborSourceService) {}

  private assertAdmin(req: any) {
    if (!ADMIN_ROLES.has(String(req.user?.role || '').trim().toLowerCase())) {
      throw new ForbiddenException('A conciliacao da fonte de custos exige administrador');
    }
  }

  @Get('status')
  status(@Req() req: any) {
    this.assertAdmin(req);
    return this.source.status();
  }

  @Post('stage')
  stage(@Req() req: any) {
    this.assertAdmin(req);
    return this.source.stage(req.user?.sub);
  }

  @Get('readback')
  readback(@Req() req: any, @Query('competence') competence: string) {
    this.assertAdmin(req);
    return this.source.readback(competence);
  }

  @Get('runs/:runId')
  preview(@Req() req: any, @Param('runId') runId: string) {
    this.assertAdmin(req);
    return this.source.preview(runId);
  }

  @Get('runs/:runId/parity')
  parity(@Req() req: any, @Param('runId') runId: string,
    @Query('competence') competence: string) {
    this.assertAdmin(req);
    return this.source.parity(runId, competence);
  }

  @Post('runs/:runId/activate')
  activate(@Req() req: any, @Param('runId') runId: string,
    @Body() body: { competence: string; sourceHash: string; rowCount: number;
      totalCost: string; evidenceRef: string }) {
    this.assertAdmin(req);
    return this.source.activate(runId, body, req.user?.sub);
  }

  @Post('approvals/:approvalId/reverse')
  reverse(@Req() req: any, @Param('approvalId') approvalId: string,
    @Body() body: { reason: string }) {
    this.assertAdmin(req);
    return this.source.reverse(approvalId, body?.reason, req.user?.sub);
  }
}
