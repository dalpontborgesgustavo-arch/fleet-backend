import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CopyUsinaMonthlyStonePowderFreightDto,
  DeleteUsinaMonthlyStonePowderFreightDto,
  SaveUsinaMonthlyStonePowderFreightDto,
} from './dto/save-usina-monthly-stone-powder-freight.dto';
import { UsinaMonthlyCostAccessGuard } from './usina-monthly-cost-access.guard';
import { UsinaMonthlyStonePowderFreightService } from './usina-monthly-stone-powder-freight.service';

@UseGuards(JwtGuard, UsinaMonthlyCostAccessGuard)
@Controller('usina-monthly-stone-powder-freights')
export class UsinaMonthlyStonePowderFreightController {
  constructor(
    private readonly service: UsinaMonthlyStonePowderFreightService,
  ) {}

  @Get()
  findAnnual(@Req() req: any, @Query('year') year?: string) {
    return this.service.findAnnual(year, req.user?.role);
  }

  @Get(':id/history')
  history(@Req() req: any, @Param('id') id: string) {
    return this.service.history(id, req.user?.role);
  }

  @Post()
  saveDraft(
    @Req() req: any,
    @Body() body: SaveUsinaMonthlyStonePowderFreightDto,
  ) {
    return this.service.saveDraft(body, req.user?.sub, req.user?.role);
  }

  @Post('copy-previous')
  copyPrevious(
    @Req() req: any,
    @Body() body: CopyUsinaMonthlyStonePowderFreightDto,
  ) {
    return this.service.copyPrevious(body, req.user?.sub, req.user?.role);
  }

  @Post(':id/versions')
  createVersion(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SaveUsinaMonthlyStonePowderFreightDto,
  ) {
    return this.service.createVersion(id, body, req.user?.sub, req.user?.role);
  }

  @Put(':id')
  updateDraft(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SaveUsinaMonthlyStonePowderFreightDto,
  ) {
    return this.service.updateDraft(id, body, req.user?.sub, req.user?.role);
  }

  @Post(':id/confirm')
  confirm(@Req() req: any, @Param('id') id: string) {
    return this.service.confirm(id, req.user?.sub, req.user?.role);
  }

  @Delete(':id')
  softDelete(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: DeleteUsinaMonthlyStonePowderFreightDto,
  ) {
    return this.service.softDelete(id, body, req.user?.sub, req.user?.role);
  }
}
