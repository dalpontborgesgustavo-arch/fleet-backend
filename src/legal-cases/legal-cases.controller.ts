import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
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
