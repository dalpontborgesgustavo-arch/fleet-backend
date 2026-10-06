import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CommercialIndicatorsService } from './commercial-indicators.service';

@UseGuards(JwtGuard)
@Controller('commercial-indicators')
export class CommercialIndicatorsController {
  constructor(private readonly service: CommercialIndicatorsService) {}

  @Get('dashboard')
  dashboard(@Req() req: any) {
    return this.service.dashboard(req.user?.role);
  }

  @Get('opportunities')
  opportunities(@Req() req: any) {
    return this.service.listOpportunities(req.user?.role);
  }

  @Post('opportunities')
  createOpportunity(@Req() req: any, @Body() body: any) {
    return this.service.createOpportunity(body, req.user?.role, req.user?.sub);
  }

  @Patch('opportunities/:id')
  updateOpportunity(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateOpportunity(
      id,
      body,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Delete('opportunities/:id')
  removeOpportunity(@Req() req: any, @Param('id') id: string) {
    return this.service.removeOpportunity(id, req.user?.role, req.user?.sub);
  }

  @Get('processes')
  processes(@Req() req: any) {
    return this.service.listProcesses(req.user?.role);
  }

  @Post('processes')
  createProcess(@Req() req: any, @Body() body: any) {
    return this.service.createProcess(body, req.user?.role, req.user?.sub);
  }

  @Patch('processes/:id')
  updateProcess(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateProcess(
      id,
      body,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Delete('processes/:id')
  removeProcess(@Req() req: any, @Param('id') id: string) {
    return this.service.removeProcess(id, req.user?.role, req.user?.sub);
  }

  @Get('audit')
  audit(@Req() req: any) {
    return this.service.listAudit(req.user?.role);
  }
}
