import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { assertDudaAdmin } from './duda-bd-geral.access';
import { DudaBdGeralService } from './duda-bd-geral.service';

interface DudaAuthenticatedRequest {
  user?: { sub?: string; role?: string | null };
}

@UseGuards(JwtGuard)
@Controller('duda/bd-geral')
export class DudaBdGeralController {
  constructor(private readonly service: DudaBdGeralService) {}

  @Get('view-preferences')
  getViewPreferences(@Req() req: DudaAuthenticatedRequest) {
    assertDudaAdmin(req.user?.role);
    return this.service.getViewPreferences(req.user?.sub);
  }

  @Put('view-preferences')
  putViewPreferences(
    @Req() req: DudaAuthenticatedRequest,
    @Body() body: { hiddenColumns?: unknown },
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.putViewPreferences(req.user?.sub, body?.hiddenColumns);
  }

  @Get('imports')
  listImports(@Req() req: DudaAuthenticatedRequest) {
    assertDudaAdmin(req.user?.role);
    return this.service.listImports();
  }

  @Get('imports/:importId/rows')
  listRows(
    @Req() req: DudaAuthenticatedRequest,
    @Param('importId') importId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('classification') classification?: string,
    @Query('serviceMonth') serviceMonth?: string,
    @Query('q') q?: string,
    @Query('columnFilters') columnFilters?: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.listRows(importId, {
      page,
      pageSize,
      classification,
      serviceMonth,
      q,
      columnFilters,
    });
  }

  @Get('imports/:importId/rows/:rowId')
  getRow(
    @Req() req: DudaAuthenticatedRequest,
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.getRow(importId, rowId);
  }
}
