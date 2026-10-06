import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { HrCommunicationsService } from './hr-communications.service';

@Controller('hr-communications')
export class HrCommunicationsController {
  constructor(
    private readonly hrCommunicationsService: HrCommunicationsService,
  ) {}

  @Get('public')
  findPublic() {
    return this.hrCommunicationsService.findPublic();
  }

  @UseGuards(JwtGuard)
  @Get()
  findAll(@Req() req: any) {
    return this.hrCommunicationsService.findAll(req.user?.role);
  }

  @UseGuards(JwtGuard)
  @Post()
  create(@Req() req: any, @Body() dto: Record<string, unknown>) {
    return this.hrCommunicationsService.create(
      dto,
      req.user?.sub,
      req.user?.role,
    );
  }

  @UseGuards(JwtGuard)
  @Put(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.hrCommunicationsService.update(id, dto, req.user?.role);
  }

  @UseGuards(JwtGuard)
  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.hrCommunicationsService.delete(id, req.user?.role);
  }
}
