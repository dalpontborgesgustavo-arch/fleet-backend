import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { OccurrencesService } from './occurrences.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly occurrencesService: OccurrencesService) {}

  @UseGuards(JwtGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateOccurrenceDto) {
    const userId = req.user.sub;
    return this.occurrencesService.create(dto, userId);
  }

  @Get()
  findAll(@Query('vehicleId') vehicleId?: string) {
    if (vehicleId) {
      return this.occurrencesService.findByVehicle(vehicleId);
    }

    return this.occurrencesService.findAll();
  }

  @UseGuards(JwtGuard)
  @Put(':id/approve')
  approve(@Param('id') id: string) {
    return this.occurrencesService.approve(id);
  }

  @UseGuards(JwtGuard)
  @Put(':id/reject')
  reject(@Param('id') id: string) {
    return this.occurrencesService.reject(id);
  }
  
  @UseGuards(JwtGuard)
@Put(':id/program')
program(@Param('id') id: string, @Body() body: any) {
  return this.occurrencesService.program(id, body);
}
}
