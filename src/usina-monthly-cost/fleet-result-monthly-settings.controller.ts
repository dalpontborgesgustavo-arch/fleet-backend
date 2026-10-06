import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { FleetResultMonthlySettingsService } from './fleet-result-monthly-settings.service';

@UseGuards(JwtGuard)
@Controller('lucas-fleet-results/forecasts')
export class FleetResultMonthlySettingsController {
  constructor(private readonly service: FleetResultMonthlySettingsService) {}

  @Get()
  findMonth(@Req() req: any, @Query('competence') competence?: string) {
    return this.service.findMonth(competence, req.user?.role);
  }

  @Put()
  save(
    @Req() req: any,
    @Query('competence') competence: string,
    @Body() body: unknown,
  ) {
    return this.service.saveMonth(competence, body, req.user?.sub, req.user?.role);
  }
}
