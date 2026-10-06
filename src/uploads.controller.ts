import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { S3UploadService } from './storage/s3-upload.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly s3UploadService: S3UploadService) {}

  @Get(':key')
  async getFile(@Param('key') key: string, @Res() response: Response) {
    if (key.startsWith('legal-case-')) {
      throw new NotFoundException('Arquivo nao encontrado');
    }
    const file = await this.s3UploadService.getObject(key);
    const body = file.Body as Readable;

    if (file.ContentType) {
      response.setHeader('Content-Type', file.ContentType);
    }

    if (typeof file.ContentLength === 'number') {
      response.setHeader('Content-Length', file.ContentLength.toString());
    }

    if (file.ETag) {
      response.setHeader('ETag', file.ETag);
    }

    body.pipe(response);
  }
}
