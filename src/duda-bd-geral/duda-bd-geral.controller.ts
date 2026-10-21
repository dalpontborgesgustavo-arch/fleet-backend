import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { assertDudaOwner } from './duda-bd-geral.access';
import { DudaBdGeralService } from './duda-bd-geral.service';

interface DudaAuthenticatedRequest {
  user?: { email?: string | null };
}

@UseGuards(JwtGuard)
@Controller('duda/bd-geral')
export class DudaBdGeralController {
  constructor(private readonly service: DudaBdGeralService) {}

  @Get('imports')
  listImports(@Req() req: DudaAuthenticatedRequest) {
    assertDudaOwner(req.user?.email);
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
  ) {
    assertDudaOwner(req.user?.email);
    return this.service.listRows(importId, {
      page,
      pageSize,
      classification,
      serviceMonth,
      q,
    });
  }

  @Get('imports/:importId/rows/:rowId')
  getRow(
    @Req() req: DudaAuthenticatedRequest,
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
  ) {
    assertDudaOwner(req.user?.email);
    return this.service.getRow(importId, rowId);
  }
}
