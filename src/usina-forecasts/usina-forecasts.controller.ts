import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { UsinaForecastsService } from './usina-forecasts.service';

@UseGuards(JwtGuard)
@Controller('usina-forecasts')
export class UsinaForecastsController {
  constructor(private readonly service: UsinaForecastsService) {}

  @Get()
  findAnnual(@Req() req: any, @Query('year') year?: string) {
    return this.service.findAnnual(year, req.user?.role);
  }

  @Put()
  save(@Req() req: any, @Body() data: any) {
    return this.service.saveMany(data, req.user?.role, req.user?.sub);
  }
}
