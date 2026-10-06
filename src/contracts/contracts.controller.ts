import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { ContractsService } from './contracts.service';

@UseGuards(JwtGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get()
  findAll(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.findAll(query, req.user?.role);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user?.role);
  }

  @Put(':id/workflow')
  updateWorkflow(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateWorkflow(id, body, req.user?.role, {
      id: req.user?.sub,
      name: req.user?.name || req.user?.email,
    });
  }
}
