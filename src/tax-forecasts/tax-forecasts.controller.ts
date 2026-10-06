import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { TaxForecastsService } from './tax-forecasts.service';

@UseGuards(JwtGuard)
@Controller('tax-forecasts')
export class TaxForecastsController {
  constructor(private readonly taxForecastsService: TaxForecastsService) {}

  @Get('audit')
  findAudit(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('company') company?: string,
    @Query('taxType') taxType?: string,
  ) {
    return this.taxForecastsService.findAudit(
      { year, month, company, taxType },
      req.user?.role,
    );
  }

  @Get()
  findAll(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('company') company?: string,
    @Query('taxType') taxType?: string,
  ) {
    return this.taxForecastsService.findAll(
      { year, company, taxType },
      req.user?.role,
    );
  }

  @Put()
  upsertMany(@Req() req: any, @Body() data: any) {
    return this.taxForecastsService.upsertMany(
      data,
      req.user?.role,
      req.user?.sub,
    );
  }
}
