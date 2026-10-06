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
  buildImageUploadPipe,
  imageUploadMulterOptions,
} from '../storage/image-upload.util';
import { S3UploadService } from '../storage/s3-upload.service';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly service: VehiclesService,
    private readonly s3UploadService: S3UploadService,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  findAll(@Req() req: any) {
    return this.service.findAll(req.user);
  }

  @Post()
  create(@Body() data: any) {
    return this.service.create(data);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @UseGuards(JwtGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', imageUploadMulterOptions))
  async uploadFile(@UploadedFile(buildImageUploadPipe()) file: any) {
    return this.s3UploadService.uploadImage(file, 'vehicle');
  }
}
