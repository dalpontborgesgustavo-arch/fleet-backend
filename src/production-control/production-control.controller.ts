import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import {
  assertProductionAccess,
  ProductionActor,
} from './production-control.access';
import { ProductionControlService } from './production-control.service';

interface ProductionRequest {
  user?: ProductionActor;
}

@UseGuards(JwtGuard)
@Controller('production-control')
export class ProductionControlController {
  constructor(private readonly service: ProductionControlService) {}

  @Get('catalog')
  catalog(@Req() req: ProductionRequest) {
    assertProductionAccess(req.user);
    return this.service.catalog();
  }

  @Get('works/:code')
  work(@Req() req: ProductionRequest, @Param('code') code: string) {
    assertProductionAccess(req.user);
    return this.service.findWork(code);
  }

  @Get()
  list(@Req() req: ProductionRequest, @Query('competence') competence: string) {
    assertProductionAccess(req.user);
    return this.service.list(competence);
  }

  @Post('lines')
  create(@Req() req: ProductionRequest, @Body() body: unknown) {
    return this.service.create(body, assertProductionAccess(req.user));
  }

  @Patch('lines/:lineId')
  update(
    @Req() req: ProductionRequest,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ) {
    return this.service.updateLine(
      lineId,
      body,
      assertProductionAccess(req.user),
    );
  }

  @Put('lines/:lineId/daily/:date')
  daily(
    @Req() req: ProductionRequest,
    @Param('lineId') lineId: string,
    @Param('date') date: string,
    @Body() body: unknown,
  ) {
    return this.service.setDaily(
      lineId,
      date,
      body,
      assertProductionAccess(req.user),
    );
  }

  @Put('lines/:lineId/weeks/:weekIndex')
  week(
    @Req() req: ProductionRequest,
    @Param('lineId') lineId: string,
    @Param('weekIndex') weekIndex: string,
    @Body() body: unknown,
  ) {
    return this.service.setWeek(
      lineId,
      weekIndex,
      body,
      assertProductionAccess(req.user),
    );
  }

  private admin(req: ProductionRequest) {
    const actor = assertProductionAccess(req.user);
    if (req.user?.role !== 'admin') throw new ForbiddenException('Somente administradores podem remover a obra do mês.');
    return actor;
  }

  @Get('months/:month/works/:line/archive-preview')
  previewArchive(@Req() req: ProductionRequest, @Param('month') month: string, @Param('line') line: string) {
    return this.service.archiveMonthWork(line, month, this.admin(req));
  }

  @Post('months/:month/works/:line/archive')
  archive(@Req() req: ProductionRequest, @Param('month') month: string, @Param('line') line: string, @Body() body: { signature?: string }) {
    return this.service.archiveMonthWork(line, month, this.admin(req), body?.signature ?? null);
  }

  @Get('lines/:lineId/revisions')
  revisions(@Req() req: ProductionRequest, @Param('lineId') lineId: string) {
    assertProductionAccess(req.user);
    return this.service.revisions(lineId);
  }
}
