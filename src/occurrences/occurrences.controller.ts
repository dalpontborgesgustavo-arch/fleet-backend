import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { OccurrencesService } from './occurrences.service';
import { CreateOccurrenceDto } from './dto/create-occurrence.dto';
import { ProgramOccurrenceDto } from './dto/program-occurrence.dto';
import { AddOccurrenceCommentDto } from './dto/add-occurrence-comment.dto';
import { CancelOccurrenceDto } from './dto/cancel-occurrence.dto';
import { ValidateOccurrenceDto } from './dto/validate-occurrence.dto';

@UseGuards(JwtGuard)
@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly occurrencesService: OccurrencesService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.occurrencesService.findAll(req.user);
  }

  @Get('my-maintenance')
  findMyMaintenance(@Req() req: any) {
    return this.occurrencesService.findMyMaintenance(req.user);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateOccurrenceDto) {
    return this.occurrencesService.create(dto, req.user?.sub);
  }

  @Get('vehicle/:vehicleId/pending-validation')
  pendingValidation(@Req() req: any, @Param('vehicleId') vehicleId: string) {
    return this.occurrencesService.findPendingValidation(vehicleId, req.user);
  }

  @Post(':id/validation')
  validate(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ValidateOccurrenceDto,
  ) {
    return this.occurrencesService.validate(id, dto, req.user);
  }

  @Put(':id/approve')
  approve(@Param('id') id: string) {
    return this.occurrencesService.approve(id);
  }

  @Put(':id/reject')
  reject(@Param('id') id: string) {
    return this.occurrencesService.reject(id);
  }

  @Put(':id/program')
  program(@Param('id') id: string, @Body() dto: ProgramOccurrenceDto) {
    return this.occurrencesService.program(id, dto);
  }

  @Put(':id/execution')
  transitionAssignedExecution(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { action?: 'START' | 'COMPLETE' },
  ) {
    return this.occurrencesService.transitionAssignedExecution(id, body?.action, req.user);
  }

  @Put(':id/priority')
  updatePriority(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { severity?: string | null },
  ) {
    return this.occurrencesService.updatePriority(id, dto.severity, req.user);
  }

  @Post(':id/comments')
  addComment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AddOccurrenceCommentDto,
  ) {
    return this.occurrencesService.addComment(id, dto, req.user);
  }

  @Put(':id/cancel')
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CancelOccurrenceDto,
  ) {
    return this.occurrencesService.cancel(id, dto, req.user);
  }
}
