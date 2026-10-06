import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RevenueForecastsService } from './revenue-forecasts.service';

@UseGuards(JwtGuard)
@Controller('revenue-forecasts')
export class RevenueForecastsController {
  constructor(
    private readonly revenueForecastsService: RevenueForecastsService,
  ) {}

  @Get()
  findAll(@Req() req: any) {
    return this.revenueForecastsService.findAll(req.user?.role);
  }

  @Post()
  create(@Req() req: any, @Body() data: any) {
    return this.revenueForecastsService.create(
      data,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Post('postpone')
  postponePending(@Req() req: any, @Body() data: any) {
    return this.revenueForecastsService.postponePending(
      data?.mes,
      data?.ano,
      req.user?.role,
    );
  }

  @Patch(':id/status')
  updateStatus(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.revenueForecastsService.updateStatus(
      id,
      data?.status,
      req.user?.role,
    );
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.revenueForecastsService.remove(id, req.user?.role);
  }
}
