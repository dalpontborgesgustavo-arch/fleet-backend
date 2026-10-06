import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { UsinaMonthlyCostAccessGuard } from './usina-monthly-cost-access.guard';
import { UsinaMonthlyCostService } from './usina-monthly-cost.service';

@UseGuards(JwtGuard, UsinaMonthlyCostAccessGuard)
@Controller('usina-monthly-cost-configs')
export class UsinaMonthlyCostController {
  constructor(private readonly service: UsinaMonthlyCostService) {}

  @Get()
  findAnnual(@Req() req: any, @Query('year') year?: string) {
    return this.service.findAnnual(year, req.user?.role);
  }

  @Get('aethos-vehicles')
  searchVehicles(@Req() req: any, @Query('search') search?: string) {
    return this.service.searchActiveAethosVehicles(search, req.user?.role);
  }

  @Get(':id/history')
  history(@Req() req: any, @Param('id') id: string) {
    return this.service.history(id, req.user?.role);
  }

  @Post()
  saveDraft(@Req() req: any, @Body() body: any) {
    return this.service.saveDraft(body, req.user?.sub, req.user?.role);
  }

  @Post('copy-previous')
  copyPrevious(@Req() req: any, @Body() body: any) {
    return this.service.copyPrevious(body, req.user?.sub, req.user?.role);
  }

  @Post(':id/versions')
  createVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createVersion(id, body, req.user?.sub, req.user?.role);
  }

  @Put(':id')
  updateDraft(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateDraft(id, body, req.user?.sub, req.user?.role);
  }

  @Post(':id/confirm')
  confirm(@Req() req: any, @Param('id') id: string) {
    return this.service.confirm(id, req.user?.sub, req.user?.role);
  }

  @Delete(':id')
  softDelete(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.softDelete(id, body, req.user?.sub, req.user?.role);
  }
}
