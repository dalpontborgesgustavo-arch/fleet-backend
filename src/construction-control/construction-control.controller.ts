import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { ConstructionControlService } from './construction-control.service';

@UseGuards(JwtGuard)
@Controller('construction-control')
export class ConstructionControlController {
  constructor(private readonly service: ConstructionControlService) {}

  @Get('state')
  findState(@Req() req: any) {
    return this.service.findState(req.user?.role);
  }

  @Get('aethos-obras/:code')
  findAethosObraByCode(@Req() req: any, @Param('code') code: string) {
    return this.service.findAethosObraByCode(code, req.user?.role);
  }

  @Get('aethos-obras/:code/custos')
  findAethosObraCostsByCode(@Req() req: any, @Param('code') code: string) {
    return this.service.findAethosObraCostsByCode(code, req.user?.role);
  }

  @Put('state')
  saveState(@Req() req: any, @Body() data: any) {
    return this.service.saveState(
      data,
      req.user?.role,
      req.user?.name || req.user?.email,
    );
  }

  @Put('works/:id/schedule-release')
  releaseSchedule(@Req() req: any, @Param('id') id: string) {
    return this.service.releaseSchedule(
      id,
      req.user?.role,
      req.user?.name || req.user?.email,
    );
  }

  @Put('works/:id/schedule-reopen')
  reopenSchedule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.service.reopenSchedule(
      id,
      data?.reason,
      req.user?.role,
      req.user?.name || req.user?.email,
    );
  }

  @Put('works/:id/administrative-fields')
  updateLimitedCadastralFields(
    @Req() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.service.updateLimitedCadastralFields(
      id,
      data,
      req.user?.role,
      req.user?.name || req.user?.email || req.user?.role || 'Sistema',
    );
  }

  @Delete('works/:id')
  deleteWork(@Req() req: any, @Param('id') id: string) {
    return this.service.deleteWork(id, req.user?.role);
  }
}
