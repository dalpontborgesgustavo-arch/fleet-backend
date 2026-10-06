import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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

  @Get('report-summary')
  @UseGuards(JwtGuard)
  reportSummary(@Req() req: any) {
    return this.service.reportSummary(req.user);
  }

  @Get('photo-backfill/preview')
  @UseGuards(JwtGuard)
  photoBackfillPreview(@Req() req: any) {
    this.ensureAdmin(req.user?.role);
    return this.service.previewPhotoBackfill();
  }

  @Post('photo-backfill/apply')
  @UseGuards(JwtGuard)
  applyPhotoBackfill(@Req() req: any) {
    this.ensureAdmin(req.user?.role);
    return this.service.applyPhotoBackfill(req.user);
  }

  @Post()
  @UseGuards(JwtGuard)
  create(@Req() req: any, @Body() data: any) {
    this.ensureAdmin(req.user?.role);
    return this.service.create(data, req.user);
  }

  @Get(':id/history')
  @UseGuards(JwtGuard)
  history(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req.user?.role);
    return this.service.history(id);
  }

  @Put(':id')
  @UseGuards(JwtGuard)
  update(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    this.ensureAdmin(req.user?.role);
    return this.service.update(id, data, req.user);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  delete(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req.user?.role);
    return this.service.delete(id, req.user);
  }

  @UseGuards(JwtGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', imageUploadMulterOptions))
  async uploadFile(@UploadedFile(buildImageUploadPipe()) file: any) {
    return this.s3UploadService.uploadImage(file, 'vehicle');
  }

  private ensureAdmin(role?: string | null) {
    if ((role || '').trim().toLowerCase() !== 'admin') {
      throw new ForbiddenException(
        'Somente o Administrador pode alterar o cadastro de veiculos.',
      );
    }
  }
}
