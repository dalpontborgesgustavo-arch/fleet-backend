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
import type { AuthenticatedActor } from '../common/supervisor-fleet-scope';
import { FleetResultMonthlyWorkforceService } from './fleet-result-monthly-workforce.service';

@UseGuards(JwtGuard)
@Controller('lucas-fleet-results/workforce')
export class FleetResultMonthlyWorkforceController {
  constructor(private readonly service: FleetResultMonthlyWorkforceService) {}

  @Get()
  findMonth(
    @Req() req: { user?: AuthenticatedActor },
    @Query('competence') competence?: string,
  ) {
    return this.service.findMonth(competence, req.user?.role, req.user?.sub);
  }

  @Get('employees')
  findEmployees(
    @Req() req: { user?: AuthenticatedActor },
    @Query('competence') competence?: string,
  ) {
    return this.service.findEmployees(
      competence,
      req.user?.role,
      req.user?.sub,
    );
  }

  @Put(':vehicleId')
  save(
    @Req() req: { user?: AuthenticatedActor },
    @Param('vehicleId') vehicleId: string,
    @Query('competence') competence: string,
    @Body() body: unknown,
  ) {
    return this.service.saveVehicle(
      competence,
      vehicleId,
      body,
      req.user?.sub,
      req.user?.role,
    );
  }
}
