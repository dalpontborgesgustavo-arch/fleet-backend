import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CopyUsinaMonthlyResultTargetDto,
  DeleteUsinaMonthlyResultTargetDto,
  SaveUsinaMonthlyResultTargetDto,
} from './dto/save-usina-monthly-result-target.dto';
import { UsinaMonthlyCostAccessGuard } from './usina-monthly-cost-access.guard';
import { UsinaMonthlyResultTargetService } from './usina-monthly-result-target.service';

@UseGuards(JwtGuard, UsinaMonthlyCostAccessGuard)
@Controller('usina-monthly-result-targets')
export class UsinaMonthlyResultTargetController {
  constructor(private readonly service: UsinaMonthlyResultTargetService) {}

  @Get()
  findAnnual(@Req() req: any, @Query('year') year?: string) {
    return this.service.findAnnual(year, req.user?.role);
  }

  @Get(':id/history')
  history(@Req() req: any, @Param('id') id: string) {
    return this.service.history(id, req.user?.role);
  }

  @Post()
  saveDraft(@Req() req: any, @Body() body: SaveUsinaMonthlyResultTargetDto) {
    return this.service.saveDraft(body, req.user?.sub, req.user?.role);
  }

  @Post('copy-previous')
  copyPrevious(@Req() req: any, @Body() body: CopyUsinaMonthlyResultTargetDto) {
    return this.service.copyPrevious(body, req.user?.sub, req.user?.role);
  }

  @Post(':id/versions')
  createVersion(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SaveUsinaMonthlyResultTargetDto,
  ) {
    return this.service.createVersion(id, body, req.user?.sub, req.user?.role);
  }

  @Put(':id')
  updateDraft(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SaveUsinaMonthlyResultTargetDto,
  ) {
    return this.service.updateDraft(id, body, req.user?.sub, req.user?.role);
  }

  @Post(':id/confirm')
  confirm(@Req() req: any, @Param('id') id: string) {
    return this.service.confirm(id, req.user?.sub, req.user?.role);
  }

  @Delete(':id')
  softDelete(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: DeleteUsinaMonthlyResultTargetDto,
  ) {
    return this.service.softDelete(id, body, req.user?.sub, req.user?.role);
  }
}
