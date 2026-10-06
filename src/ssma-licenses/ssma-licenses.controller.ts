import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { SsmaLicensesService } from './ssma-licenses.service';

@UseGuards(JwtGuard)
@Controller('ssma-licenses')
export class SsmaLicensesController {
  constructor(private readonly ssmaLicensesService: SsmaLicensesService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.ssmaLicensesService.findAll(req.user?.role);
  }

  @Post()
  create(@Req() req: any, @Body() data: any) {
    return this.ssmaLicensesService.create(data, req.user?.role, req.user?.sub);
  }

  @Put(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.ssmaLicensesService.update(id, data, req.user?.role);
  }

  @Patch(':id/deactivate')
  deactivate(@Req() req: any, @Param('id') id: string) {
    return this.ssmaLicensesService.deactivate(id, req.user?.role);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.ssmaLicensesService.deactivate(id, req.user?.role);
  }

  @Post(':id/renewals')
  createRenewal(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.ssmaLicensesService.createRenewal(
      id,
      data,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Put('renewals/:renewalId')
  updateRenewal(
    @Req() req: any,
    @Param('renewalId') renewalId: string,
    @Body() data: any,
  ) {
    return this.ssmaLicensesService.updateRenewal(
      renewalId,
      data,
      req.user?.role,
    );
  }

  @Post('renewals/:renewalId/attachments')
  @UseInterceptors(FileInterceptor('file', fileUploadMulterOptions))
  attachRenewalFile(
    @Req() req: any,
    @Param('renewalId') renewalId: string,
    @UploadedFile(buildFileUploadPipe()) file: any,
  ) {
    return this.ssmaLicensesService.attachRenewalFile(
      renewalId,
      file,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Delete('renewals/:renewalId')
  removeRenewal(@Req() req: any, @Param('renewalId') renewalId: string) {
    return this.ssmaLicensesService.removeRenewal(renewalId, req.user?.role);
  }
}
