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
import { PrumareService } from './prumare.service';

@UseGuards(JwtGuard)
@Controller('prumare')
export class PrumareController {
  constructor(private readonly prumareService: PrumareService) {}

  @Get('enterprises')
  findEnterprises(@Req() req: any) {
    return this.prumareService.findEnterprises(req.user?.role);
  }

  @Post('enterprises')
  createEnterprise(@Req() req: any, @Body() data: any) {
    return this.prumareService.createEnterprise(data, req.user?.role);
  }

  @Put('enterprises/:id')
  updateEnterprise(
    @Req() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.prumareService.updateEnterprise(id, data, req.user?.role);
  }

  @Delete('enterprises/:id')
  deleteEnterprise(@Req() req: any, @Param('id') id: string) {
    return this.prumareService.deleteEnterprise(id, req.user?.role);
  }

  @Get('brokers')
  findBrokers(@Req() req: any) {
    return this.prumareService.findBrokers(req.user?.role);
  }

  @Post('brokers')
  createBroker(@Req() req: any, @Body() data: any) {
    return this.prumareService.createBroker(data, req.user?.role);
  }

  @Put('brokers/:id')
  updateBroker(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.prumareService.updateBroker(id, data, req.user?.role);
  }

  @Delete('brokers/:id')
  deleteBroker(@Req() req: any, @Param('id') id: string) {
    return this.prumareService.deleteBroker(id, req.user?.role);
  }

  @Get('ipca')
  findIpcaIndexes(@Req() req: any) {
    return this.prumareService.findIpcaIndexes(req.user?.role);
  }

  @Post('ipca')
  upsertIpcaIndex(@Req() req: any, @Body() data: any) {
    return this.prumareService.upsertIpcaIndex(data, req.user?.role);
  }

  @Delete('ipca/:id')
  deleteIpcaIndex(@Req() req: any, @Param('id') id: string) {
    return this.prumareService.deleteIpcaIndex(id, req.user?.role);
  }

  @Get('receivables')
  findReceivables(@Req() req: any, @Query() query: any) {
    return this.prumareService.findReceivables(query, req.user?.role);
  }

  @Get('price-adjustments')
  findPriceAdjustments(@Req() req: any, @Query() query: any) {
    return this.prumareService.findPriceAdjustments(query, req.user?.role);
  }

  @Get('lots')
  findAllLots(@Req() req: any) {
    return this.prumareService.findAllLots(req.user?.role);
  }

  @Get('enterprises/:enterpriseId/lots')
  findLots(@Req() req: any, @Param('enterpriseId') enterpriseId: string) {
    return this.prumareService.findLots(enterpriseId, req.user?.role);
  }

  @Post('enterprises/:enterpriseId/lots')
  createLot(
    @Req() req: any,
    @Param('enterpriseId') enterpriseId: string,
    @Body() data: any,
  ) {
    return this.prumareService.createLot(enterpriseId, data, req.user?.role);
  }

  @Post('enterprises/:enterpriseId/price-adjustments')
  applyPriceAdjustment(
    @Req() req: any,
    @Param('enterpriseId') enterpriseId: string,
    @Body() data: any,
  ) {
    return this.prumareService.applyPriceAdjustment(
      enterpriseId,
      data,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Put('lots/:lotId')
  updateLot(@Req() req: any, @Param('lotId') lotId: string, @Body() data: any) {
    return this.prumareService.updateLot(lotId, data, req.user?.role);
  }

  @Delete('lots/:lotId')
  deleteLot(@Req() req: any, @Param('lotId') lotId: string) {
    return this.prumareService.deleteLot(lotId, req.user?.role);
  }

  @Post('simulate-price')
  simulatePrice(@Req() req: any, @Body() data: any) {
    return this.prumareService.simulatePrice(
      data,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Post('enterprises/:enterpriseId/simulate-table')
  simulateTable(
    @Req() req: any,
    @Param('enterpriseId') enterpriseId: string,
    @Body() data: any,
  ) {
    return this.prumareService.simulateTable(
      enterpriseId,
      data,
      req.user?.role,
      req.user?.sub,
    );
  }
}
