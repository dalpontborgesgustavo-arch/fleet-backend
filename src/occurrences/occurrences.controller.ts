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

@UseGuards(JwtGuard)
@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly occurrencesService: OccurrencesService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.occurrencesService.findAll(req.user);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateOccurrenceDto) {
    return this.occurrencesService.create(dto, req.user?.sub);
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
