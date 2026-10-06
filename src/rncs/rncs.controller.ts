import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../auth/jwt.guard';
import {
  buildFileUploadPipe,
  fileUploadMulterOptions,
} from '../storage/file-upload.util';
import { CreateRncDto } from './dto/create-rnc.dto';
import { CompleteRncCorrectiveActionDto } from './dto/complete-rnc-corrective-action.dto';
import { CancelRncDto } from './dto/cancel-rnc.dto';
import { UpdateRncCorrectiveActionDto } from './dto/update-rnc-corrective-action.dto';
import { AnswerRncAssignmentDto } from './dto/answer-rnc-assignment.dto';
import { DirectRncDto } from './dto/direct-rnc.dto';
import { ReviewRncEffectivenessDto } from './dto/review-rnc-effectiveness.dto';
import { ReviewRncDto } from './dto/review-rnc.dto';
import { RncProfileAccessGuard } from './rnc-profile-access.guard';
import {
  SubmitRncCauseAnalysisDto,
  SubmitRncResponsibleActionDto,
} from './dto/submit-rnc-responsible-action.dto';
import { UpdateRncInvestigationDto } from './dto/update-rnc-investigation.dto';
import { UpdateRncProgressDto } from './dto/update-rnc-progress.dto';
import { RncsService } from './rncs.service';

@UseGuards(JwtGuard, RncProfileAccessGuard)
@Controller('rncs')
export class RncsController {
  constructor(private readonly rncsService: RncsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.rncsService.findAll(req.user?.role, req.user?.sub);
  }

  @Get('aethos-items/:code')
  findAethosItem(@Req() req: any, @Param('code') code: string) {
    return this.rncsService.findAethosItemByCode(code);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.rncsService.findOne(id, req.user?.role, req.user?.sub);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateRncDto) {
    return this.rncsService.create(dto, req.user?.sub, req.user?.role);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', fileUploadMulterOptions))
  attachFile(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile(buildFileUploadPipe()) file: any,
  ) {
    return this.rncsService.attachFile(id, file, req.user?.sub, req.user?.role);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.rncsService.deleteAttachment(
      id,
      attachmentId,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Post(':id/corrective-actions/:actionId/evidence')
  @UseInterceptors(FileInterceptor('file', fileUploadMulterOptions))
  attachCorrectiveActionEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @UploadedFile(buildFileUploadPipe()) file: any,
  ) {
    return this.rncsService.attachCorrectiveActionEvidence(
      id,
      actionId,
      file,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Delete(':id/corrective-actions/:actionId/evidence/:attachmentId')
  deleteCorrectiveActionEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.rncsService.deleteCorrectiveActionEvidence(
      id,
      actionId,
      attachmentId,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/corrective-actions/:actionId/complete')
  completeCorrectiveAction(
    @Req() req: any,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() dto: CompleteRncCorrectiveActionDto,
  ) {
    return this.rncsService.completeCorrectiveAction(
      id,
      actionId,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/corrective-actions/:actionId')
  updateCorrectiveAction(
    @Req() req: any,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() dto: UpdateRncCorrectiveActionDto,
  ) {
    return this.rncsService.updateCorrectiveAction(
      id,
      actionId,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/resubmit')
  resubmit(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateRncDto,
  ) {
    return this.rncsService.resubmit(id, dto, req.user?.sub, req.user?.role);
  }

  @Put(':id/edit')
  editBeforeManagerAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateRncDto,
  ) {
    return this.rncsService.editBeforeManagerAction(id, dto, req.user?.sub);
  }

  @Put(':id/internal-opening')
  updateInternalOpening(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateRncDto,
  ) {
    return this.rncsService.updateInternalOpening(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/cancel')
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CancelRncDto,
  ) {
    return this.rncsService.cancel(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/progress')
  updateProgress(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateRncProgressDto,
  ) {
    return this.rncsService.updateProgress(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.rncsService.approve(id, req.user?.sub, req.user?.role);
  }

  @Put(':id/direct')
  direct(@Req() req: any, @Param('id') id: string, @Body() dto: DirectRncDto) {
    return this.rncsService.direct(id, dto, req.user?.sub, req.user?.role);
  }

  @Put(':id/investigation')
  updateInvestigation(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateRncInvestigationDto,
  ) {
    return this.rncsService.updateInvestigation(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/responsible-action')
  submitResponsibleAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitRncResponsibleActionDto,
  ) {
    return this.rncsService.submitResponsibleAction(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/cause-analysis')
  submitCauseAnalysis(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitRncCauseAnalysisDto,
  ) {
    return this.rncsService.submitCauseAnalysis(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/effectiveness-review')
  reviewEffectiveness(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewRncEffectivenessDto,
  ) {
    return this.rncsService.reviewEffectiveness(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/respond-assignment')
  respondAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AnswerRncAssignmentDto,
  ) {
    return this.rncsService.respondAssignment(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/system-item/included')
  markSystemItemIncluded(@Req() req: any, @Param('id') id: string) {
    return this.rncsService.markSystemItemIncluded(
      id,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/system-items/:itemId/included')
  markSystemItemIncludedByItem(
    @Req() req: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.rncsService.markSystemItemIncluded(
      id,
      req.user?.sub,
      req.user?.role,
      itemId,
    );
  }

  @Put(':id/finalize')
  finalize(@Req() req: any, @Param('id') id: string) {
    return this.rncsService.finalize(id, req.user?.sub, req.user?.role);
  }

  @Put(':id/reject')
  reject(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewRncDto) {
    return this.rncsService.reject(id, dto, req.user?.sub, req.user?.role);
  }

  @Put(':id/return')
  returnForAdjustment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewRncDto,
  ) {
    return this.rncsService.returnForAdjustment(
      id,
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }
}
