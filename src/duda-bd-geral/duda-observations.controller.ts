import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { assertDudaAdmin } from './duda-bd-geral.access';
import { DudaObservationsService } from './duda-observations.service';

interface DudaRequest {
  user?: { sub?: string; role?: string | null };
}

interface ObservationBody {
  kind?: unknown;
  referenceMonth?: unknown;
  targetMonth?: unknown;
  note?: unknown;
  status?: unknown;
  expectedVersion?: unknown;
}

@UseGuards(JwtGuard)
@Controller('duda/bd-geral/imports/:importId')
export class DudaObservationsController {
  constructor(private readonly service: DudaObservationsService) {}

  @Get('observations')
  list(
    @Req() req: DudaRequest,
    @Param('importId') importId: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('month') month?: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.list(importId, { page, status, kind, month });
  }

  @Get('rows/:rowId/observations')
  listForRow(
    @Req() req: DudaRequest,
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.listForRow(importId, rowId);
  }

  @Post('rows/:rowId/observations')
  create(
    @Req() req: DudaRequest,
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
    @Body() body: ObservationBody,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.create(importId, rowId, req.user?.sub, body);
  }

  @Put('observations/:observationId')
  update(
    @Req() req: DudaRequest,
    @Param('importId') importId: string,
    @Param('observationId') observationId: string,
    @Body() body: ObservationBody,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.update(importId, observationId, req.user?.sub, body);
  }

  @Get('observations/:observationId/revisions')
  revisions(
    @Req() req: DudaRequest,
    @Param('importId') importId: string,
    @Param('observationId') observationId: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.revisions(importId, observationId);
  }
}
