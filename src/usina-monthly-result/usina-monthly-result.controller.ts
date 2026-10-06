import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { UsinaMonthlyResultService } from './usina-monthly-result.service';

@UseGuards(JwtGuard)
@Controller('usina-monthly-results')
export class UsinaMonthlyResultController {
  constructor(private readonly service: UsinaMonthlyResultService) {}

  @Get()
  findAnnual(@Req() req: any, @Query('year') year?: string) {
    return this.service.findAnnual(year, req.user?.role);
  }
}
