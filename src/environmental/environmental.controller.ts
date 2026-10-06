import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { EnvironmentalService } from './environmental.service';

@UseGuards(JwtGuard)
@Controller('environmental')
export class EnvironmentalController {
  constructor(private readonly environmental: EnvironmentalService) {}

  @Get('dashboard')
  dashboard(@Req() req: any, @Query() query: any) {
    return this.environmental.dashboard(query, req.user?.role);
  }

  @Get('records')
  findRecords(@Req() req: any, @Query() query: any) {
    return this.environmental.findRecords(query, req.user?.role);
  }

  @Post('records')
  createRecord(@Req() req: any, @Body() data: any) {
    return this.environmental.createRecord(data, req.user?.role, req.user?.sub);
  }

  @Put('records/:id')
  updateRecord(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.environmental.updateRecord(
      id,
      data,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Delete('records/:id')
  deactivateRecord(@Req() req: any, @Param('id') id: string) {
    return this.environmental.deactivateRecord(
      id,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Post('records/:id/attachments')
  @UseInterceptors(FileInterceptor('file', fileUploadMulterOptions))
  attachFile(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile(buildFileUploadPipe()) file: any,
  ) {
    return this.environmental.attachFile(
      id,
      file,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Get('emission-factors')
  factors(@Req() req: any) {
    return this.environmental.factors(req.user?.role);
  }

  @Post('emission-factors')
  createFactor(@Req() req: any, @Body() data: any) {
    return this.environmental.createFactor(data, req.user?.role, req.user?.sub);
  }

  @Delete('emission-factors/:id')
  deactivateFactor(@Req() req: any, @Param('id') id: string) {
    return this.environmental.deactivateFactor(id, req.user?.role);
  }
}
