import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Readable } from 'stream';
import { JwtGuard } from '../auth/jwt.guard';
import {
  buildFileUploadPipe,
  fileUploadMulterOptions,
} from '../storage/file-upload.util';
import { LegalCasesService } from './legal-cases.service';

@UseGuards(JwtGuard)
@Controller('legal-cases')
export class LegalCasesController {
  constructor(private readonly service: LegalCasesService) {}

  @Get('dashboard')
  dashboard(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.dashboard(query, req.user?.role);
  }

  @Get()
  findAll(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.findAll(query, req.user?.role);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user?.role);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', fileUploadMulterOptions))
  attachFile(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile(buildFileUploadPipe()) file: any,
  ) {
    return this.service.attachFile(id, file, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }

  @Get(':id/attachments/:attachmentId/file')
  async openAttachment(
    @Req() req: any,
    @Param('id') id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Res() response: Response,
  ) {
    const result = await this.service.getAttachmentFile(
      id,
      attachmentId,
      req.user?.role,
    );
    const body = result.file.Body as Readable;
    response.setHeader(
      'Content-Type',
      result.attachment.mimeType ||
        result.file.ContentType ||
        'application/octet-stream',
    );
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (typeof result.file.ContentLength === 'number') {
      response.setHeader(
        'Content-Length',
        result.file.ContentLength.toString(),
      );
    }
    body.pipe(response);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req: any,
    @Param('id') id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
  ) {
    return this.service.deleteAttachment(id, attachmentId, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }

  @Post()
  create(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.service.create(body, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(id, body, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }
}
