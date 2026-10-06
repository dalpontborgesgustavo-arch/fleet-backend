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
import { UsinaBomAccessGuard } from './usina-bom-access.guard';
import { UsinaBomService } from './usina-bom.service';

@UseGuards(JwtGuard, UsinaBomAccessGuard)
@Controller('usina-boms')
export class UsinaBomController {
  constructor(private readonly service: UsinaBomService) {}

  @Get()
  findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll({ search, status }, req.user?.role);
  }

  @Get('aethos-items')
  searchActiveAethosItems(
    @Req() req: any,
    @Query('search') search?: string,
  ) {
    return this.service.searchActiveAethosItems(search, req.user?.role);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user?.role);
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.service.create(body, req.user?.sub, req.user?.role);
  }

  @Post(':id/versions')
  createVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createVersion(id, body, req.user?.sub, req.user?.role);
  }

  @Put(':id/status')
  setStatus(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.setStatus(id, body, req.user?.sub, req.user?.role);
  }

  @Delete(':id')
  softDelete(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.softDelete(id, body, req.user?.sub, req.user?.role);
  }
}
