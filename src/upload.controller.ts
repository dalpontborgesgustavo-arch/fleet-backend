import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from './auth/jwt.guard';
import {
  buildImageUploadPipe,
  imageUploadMulterOptions,
} from './storage/image-upload.util';
import { S3UploadService } from './storage/s3-upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly s3UploadService: S3UploadService) {}

  @UseGuards(JwtGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file', imageUploadMulterOptions))
  async uploadFile(@UploadedFile(buildImageUploadPipe()) file: any) {
    return this.s3UploadService.uploadImage(file, 'upload');
  }
}
