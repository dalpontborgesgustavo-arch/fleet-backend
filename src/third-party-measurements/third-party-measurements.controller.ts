import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { ThirdPartyMeasurementsService } from './third-party-measurements.service';

@UseGuards(JwtGuard)
@Controller('third-party-measurements')
export class ThirdPartyMeasurementsController {
  constructor(private readonly service: ThirdPartyMeasurementsService) {}

  @Get()
  findAll(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.findAll(query, req.user?.role);
  }

  @Get('slas')
  listSlas(@Req() req: any) {
    return this.service.listSlas(req.user?.role);
  }

  @Put('slas/:key')
  updateSla(
    @Req() req: any,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateSla(key, body, req.user?.role);
  }

  @Get(':id/items')
  listItems(@Req() req: any, @Param('id') id: string) {
    return this.service.listItems(id, req.user?.role);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user?.role);
  }

  @Put(':id/administrative')
  updateAdministrativeData(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateAdministrativeData(id, body, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }
}
