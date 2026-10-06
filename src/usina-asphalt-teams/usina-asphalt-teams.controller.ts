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
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { UsinaAsphaltTeamsAccessGuard } from './usina-asphalt-teams-access.guard';
import { UsinaAsphaltTeamsService } from './usina-asphalt-teams.service';
import { TotvsEmployeeIntegrationService } from './totvs-employee-integration.service';
import {
  DeleteUsinaAsphaltEquipmentHourlyRateDto,
  SaveUsinaAsphaltEquipmentHourlyRateDto,
} from './dto/usina-asphalt-equipment-hourly-rate.dto';

@UseGuards(JwtGuard, UsinaAsphaltTeamsAccessGuard)
@Controller('usina-asphalt-teams')
export class UsinaAsphaltTeamsController {
  constructor(
    private readonly service: UsinaAsphaltTeamsService,
    private readonly totvsEmployees: TotvsEmployeeIntegrationService,
  ) {}

  @Get()
  findAll(@Req() req: any, @Query('includeDeleted') includeDeleted?: string) {
    return this.service.findAll(req.user?.role, includeDeleted === 'true');
  }

  @Get('aethos-items')
  searchItems(@Req() req: any, @Query('search') search?: string) {
    return this.service.searchActiveAethosItems(search, req.user?.role);
  }

  @Get('aethos-vehicles')
  searchVehicles(@Req() req: any, @Query('search') search?: string) {
    return this.service.searchActiveAethosVehicles(search, req.user?.role);
  }

  @Get('fleet-assignments')
  fleetAssignments(@Req() req: any, @Query('competence') competence?: string) {
    return this.service.findFleetAssignments(competence, req.user?.role);
  }

  @Get('operators')
  operators(
    @Query('competence') competence?: string,
    @Query('search') search?: string,
  ) {
    return this.totvsEmployees.listOperators(competence, search);
  }

  @Get('operators/status')
  operatorSnapshotStatus() {
    return this.totvsEmployees.status();
  }

  @Post('operators/refresh')
  refreshOperators(@Req() req: any) {
    return this.totvsEmployees.refresh(req.user?.sub);
  }

  @Post('fleet-assignments/:assignmentId/operators')
  addFleetOperator(
    @Req() req: any,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
  ) {
    return this.totvsEmployees.createAssignment(
      assignmentId,
      body,
      req.user?.sub,
    );
  }

  @Put('fleet-assignments/:assignmentId/operators')
  replaceFleetOperators(
    @Req() req: any,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
  ) {
    return this.totvsEmployees.replaceAssignments(
      assignmentId,
      body,
      req.user?.sub,
    );
  }

  @Put('fleet-operator-assignments/:id')
  updateFleetOperator(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.totvsEmployees.updateAssignment(id, body, req.user?.sub);
  }

  @Delete('fleet-operator-assignments/:id')
  deleteFleetOperator(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @Query('reason') reason?: string,
  ) {
    return this.totvsEmployees.deleteAssignment(
      id,
      body?.reason || reason,
      req.user?.sub,
    );
  }

  @Get('equipment-hourly-rates')
  equipmentHourlyRates(@Req() req: any, @Query('year') year?: string) {
    return this.service.listEquipmentHourlyRates(year, req.user?.role);
  }

  @Get('equipment-hours')
  equipmentHours(
    @Req() req: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('includeUndated') includeUndated?: string,
    @Query('includeFacts') includeFacts?: string,
  ) {
    return this.service.equipmentHoursReadback(
      {
        dateFrom,
        dateTo,
        includeUndated: includeUndated === 'true',
        includeFacts: includeFacts === 'true',
      },
      req.user?.role,
    );
  }

  @Get('equipment-hourly-rates/history')
  equipmentHourlyRateHistory(
    @Req() req: any,
    @Query('competence') competence?: string,
    @Query('category') category?: string,
  ) {
    return this.service.equipmentHourlyRateHistory(
      competence,
      category,
      req.user?.role,
    );
  }

  @Put('equipment-hourly-rates')
  saveEquipmentHourlyRate(
    @Req() req: any,
    @Body() body: SaveUsinaAsphaltEquipmentHourlyRateDto,
  ) {
    return this.service.saveEquipmentHourlyRate(
      body,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Delete('equipment-hourly-rates')
  deleteEquipmentHourlyRate(
    @Req() req: any,
    @Query('competence') competence?: string,
    @Query('category') category?: string,
    @Query('reason') reason?: string,
    @Body() body?: DeleteUsinaAsphaltEquipmentHourlyRateDto,
  ) {
    return this.service.deleteEquipmentHourlyRate(
      competence,
      category,
      { reason: body?.reason || reason },
      req.user?.sub,
      req.user?.role,
    );
  }

  @Post('fleet-assignments/copy-previous')
  copyPreviousFleetAssignments(@Req() req: any, @Body() body: any) {
    return this.service.copyPreviousFleetAssignments(
      body,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put('fleet-assignments/:assignmentId')
  updateFleetAssignment(
    @Req() req: any,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
  ) {
    return this.service.updateFleetAssignment(
      assignmentId,
      body,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Delete('fleet-assignments/:assignmentId')
  deleteFleetAssignment(
    @Req() req: any,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
    @Query('reason') reason?: string,
  ) {
    return this.service.deleteFleetAssignment(
      assignmentId,
      { ...body, reason: body?.reason || reason },
      req.user?.sub,
      req.user?.role,
    );
  }

  @Get('dashboard')
  dashboard(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('includeFacts') includeFacts?: string,
  ) {
    return this.service.dashboard(
      year,
      req.user?.role,
      includeFacts === 'true',
    );
  }

  @Get('dashboard/memory')
  dashboardMemory(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('kind') kind?: string,
    @Query('teamId') teamId?: string,
    @Query('category') category?: string,
    @Query('costClass') costClass?: string,
    @Query('metric') metric?: string,
  ) {
    return this.service.dashboardMemory(
      { year, month, kind, teamId, category, costClass, metric },
      req.user?.role,
    );
  }

  @Get('reconciliation')
  reconciliation(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('includeFacts') includeFacts?: string,
  ) {
    return this.service.reconciliation(
      year,
      req.user?.role,
      includeFacts === 'true',
    );
  }

  @Get('snapshot-current')
  currentSnapshot(@Req() req: any, @Query('keys') keys?: string) {
    return this.service.currentSnapshot(keys, req.user?.role);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user?.role);
  }

  @Post()
  createTeam(@Req() req: any, @Body() body: any) {
    return this.service.createTeam(body, req.user?.sub, req.user?.role);
  }

  @Post(':id/versions')
  createVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createVersion(id, body, req.user?.sub, req.user?.role);
  }

  @Post(':id/assignments')
  addAssignment(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.addAssignment(id, body, req.user?.sub, req.user?.role);
  }

  @Post(':id/fleet-assignments')
  addFleetAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.createFleetAssignment(
      id,
      body,
      req.user?.sub,
      req.user?.role,
    );
  }

  @Put(':id/close')
  closeTeam(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.closeTeam(id, body, req.user?.sub, req.user?.role);
  }

  @Delete('assignments/:id')
  softDeleteAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.softDeleteAssignment(
      id,
      body,
      req.user?.sub,
      req.user?.role,
    );
  }
}
