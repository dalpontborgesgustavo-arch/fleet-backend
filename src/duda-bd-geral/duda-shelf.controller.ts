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
import { DudaShelfService } from './duda-shelf.service';

interface DudaRequest {
  user?: { sub?: string; role?: string | null };
}

@UseGuards(JwtGuard)
@Controller('duda/prateleiras')
export class DudaShelfController {
  constructor(private readonly service: DudaShelfService) {}

  @Get()
  list(
    @Req() req: DudaRequest,
    @Query('month') month?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.list({ month, status, q, page });
  }

  @Post()
  create(@Req() req: DudaRequest, @Body() body: unknown) {
    assertDudaAdmin(req.user?.role);
    return this.service.create(req.user?.sub, body);
  }

  @Put(':entryId')
  update(
    @Req() req: DudaRequest,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ) {
    assertDudaAdmin(req.user?.role);
    return this.service.update(entryId, req.user?.sub, body);
  }

  @Get(':entryId/revisions')
  revisions(@Req() req: DudaRequest, @Param('entryId') entryId: string) {
    assertDudaAdmin(req.user?.role);
    return this.service.revisions(entryId);
  }

  @Post('carry')
  carry(@Req() req: DudaRequest, @Body() body: unknown) {
    assertDudaAdmin(req.user?.role);
    return this.service.carry(req.user?.sub, body);
  }

  @Post('import')
  importSnapshot(@Req() req: DudaRequest, @Body() body: unknown) {
    assertDudaAdmin(req.user?.role);
    return this.service.importSnapshot(req.user?.sub, body);
  }
}
