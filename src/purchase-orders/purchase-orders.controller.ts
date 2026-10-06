import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PurchaseOrdersService } from './purchase-orders.service';

@UseGuards(JwtGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get('overview')
  overview(@Req() request: any, @Query() query: Record<string, unknown>) {
    return this.service.overview(query, request.user?.role);
  }

  @Get(':id')
  detail(@Req() request: any, @Param('id') id: string) {
    return this.service.detail(id, request.user?.role);
  }
}
