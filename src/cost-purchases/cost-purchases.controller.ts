import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { CostPurchasesAccessGuard } from './cost-purchases-access.guard';
import { CostPurchasesPresentationService } from './cost-purchases-presentation.service';
import { CostPurchasesService } from './cost-purchases.service';

@UseGuards(JwtGuard, CostPurchasesAccessGuard)
@Controller('cost-purchases')
export class CostPurchasesController {
  constructor(
    private readonly service: CostPurchasesService,
    private readonly presentationService: CostPurchasesPresentationService,
  ) {}

  @Get('competences')
  competences() {
    return this.service.competences();
  }

  @Get('vehicle-settings')
  vehicleSettings() {
    return this.service.vehicleSettings();
  }

  @Put('vehicle-settings/:id')
  updateVehicleSettings(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateVehicleSettings(id, body, {
      id: request.user?.sub,
      name: request.user?.name,
      email: request.user?.email,
    });
  }

  @Get('managerial-accounts')
  managerialAccounts(@Query('year') year?: string) {
    return this.service.managerialAccounts({ year });
  }

  @Get('managerial-accounts/summary')
  managerialSummary(@Query('year') year?: string) {
    return this.service.managerialSummary({ year });
  }

  @Get('managerial-accounts/memory')
  managerialMemory(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('code') code?: string,
  ) {
    return this.service.managerialMemory({ year, month, code });
  }

  @Get('managerial-accounts/pending')
  managerialPending(
    @Query('year') year?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.managerialPending({ year, page, pageSize });
  }

  @Get('managerial-presentation')
  managerialPresentation(
    @Req() request: any,
    @Query('startCompetence') startCompetence?: string,
    @Query('endCompetence') endCompetence?: string,
  ) {
    return this.presentationService.managerialPresentation(
      {
        startCompetence,
        endCompetence,
      },
      {
        id: request.user?.sub,
        name: request.user?.name || request.user?.email,
      },
    );
  }

  @Get('managerial-presentation/export')
  async managerialPresentationExport(
    @Req() request: any,
    @Query('startCompetence') startCompetence: string | undefined,
    @Query('endCompetence') endCompetence: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const exported =
      await this.presentationService.exportManagerialPresentation(
        {
          startCompetence,
          endCompetence,
        },
        {
          id: request.user?.sub,
          name: request.user?.name || request.user?.email,
        },
      );
    response.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exported.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(exported.buffer);
  }

  @Get('competence-expenses')
  competenceExpenses(
    @Query('competence') competence?: string,
    @Query('lineNumber') lineNumber?: string,
  ) {
    return this.service.competenceExpenses({ competence, lineNumber });
  }

  @Get('competence-expenses/memory')
  competenceExpenseMemory(
    @Query('competence') competence?: string,
    @Query('lineNumber') lineNumber?: string,
  ) {
    return this.service.competenceExpenses({ competence, lineNumber });
  }

  @Get('report')
  report(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.report({
      competence,
      search,
      type,
      vehicleType,
      page,
      pageSize,
    });
  }

  @Get('vehicle-expenses')
  vehicleExpenses(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.report({
      competence,
      search,
      type,
      vehicleType,
      page,
      pageSize,
    });
  }

  @Get('vehicle-launches')
  vehicleLaunches(
    @Query('competence') competence?: string,
    @Query('aethosVehicleId') aethosVehicleId?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.vehicleLaunches({
      competence,
      aethosVehicleId,
      kind,
      page,
      pageSize,
    });
  }

  @Get('filters')
  filters(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    return this.service.filters({ competence, search, type, vehicleType });
  }

  @Get('vehicle-expenses/summary')
  summary(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    return this.service.summary({ competence, search, type, vehicleType });
  }

  @Get('vehicle-expenses/allocation-memory')
  allocationMemory(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    return this.service.allocationMemory({
      competence,
      search,
      type,
      vehicleType,
    });
  }
}
