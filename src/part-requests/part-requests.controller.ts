import { Body, Controller, Get, Post, Put, Query, Param, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PartRequestsService } from './part-requests.service';
import { CreatePartRequestDto } from './dto/create-part-request.dto';
import { ReviewPartRequestDto } from './dto/review-part-request.dto';
import { RespondPartRequestDto } from './dto/respond-part-request.dto';

@UseGuards(JwtGuard)
@Controller('part-requests')
export class PartRequestsController {
  constructor(private readonly partRequestsService: PartRequestsService) {}

  @Get()
  findAll(@Req() req: any, @Query('occurrenceId') occurrenceId?: string) {
    return this.partRequestsService.findAll(req.user?.role, req.user?.sub, occurrenceId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreatePartRequestDto) {
    return this.partRequestsService.create(dto, req.user?.sub, req.user?.role);
  }

  @Put(':id/approve-maintenance')
  approveMaintenance(@Req() req: any, @Param('id') id: string) {
    return this.partRequestsService.approveMaintenance(id, req.user?.sub, req.user?.role);
  }

  @Put(':id/reject-maintenance')
  rejectMaintenance(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewPartRequestDto) {
    return this.partRequestsService.rejectMaintenance(id, dto, req.user?.sub, req.user?.role);
  }

  @Put(':id/purchase-response')
  respondPurchase(@Req() req: any, @Param('id') id: string, @Body() dto: RespondPartRequestDto) {
    return this.partRequestsService.respondPurchase(id, dto, req.user?.sub, req.user?.role);
  }
}
