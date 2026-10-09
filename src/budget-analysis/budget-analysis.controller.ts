import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { BudgetAnalysisService } from './budget-analysis.service';

@UseGuards(JwtGuard)
@Controller('budget-analysis')
export class BudgetAnalysisController {
  constructor(private readonly service: BudgetAnalysisService) {}

  @Get('overview')
  overview(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.getOverview(query, req.user?.role);
  }

  @Get('ssma')
  ssma(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.getSsmaOverview(query, req.user?.role);
  }

  @Get('ssma/actuals')
  ssmaActuals(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.getSsmaActuals(query, req.user?.role);
  }

  @Get('actuals')
  actuals(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.getActuals(query, req.user?.role);
  }

  @Get('scenarios')
  scenarios(@Req() req: any, @Query() query: Record<string, unknown>) {
    return this.service.getScenarios(query, req.user?.role);
  }

  @Post('scenarios')
  createScenario(@Req() req: any, @Body() body: unknown) {
    return this.service.createScenario(body, req.user?.role, req.user?.sub);
  }

  @Put('monthly-budgets/:lineId')
  updateMonthlyBudget(
    @Req() req: any,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ) {
    return this.service.updateMonthlyBudget(
      lineId,
      body,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Put('responsibles')
  updateResponsible(@Req() req: any, @Body() body: unknown) {
    return this.service.updateResponsible(body, req.user?.role);
  }
}
