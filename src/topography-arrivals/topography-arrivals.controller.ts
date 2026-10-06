import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { TopographyArrivalsService } from './topography-arrivals.service';

@UseGuards(JwtGuard)
@Controller('topography-arrivals')
export class TopographyArrivalsController {
  constructor(
    private readonly topographyArrivalsService: TopographyArrivalsService,
  ) {}

  @Get()
  findAll(@Req() req: any) {
    return this.topographyArrivalsService.findAll(
      req.user?.role,
      req.user?.sub,
    );
  }

  @Post()
  saveToday(@Req() req: any, @Body() data: any) {
    return this.topographyArrivalsService.saveToday(
      data,
      req.user?.role,
      req.user?.sub,
    );
  }
}
