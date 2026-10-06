import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsinaMonthlyCostAccessGuard } from './usina-monthly-cost-access.guard';
import { UsinaMonthlyCostController } from './usina-monthly-cost.controller';
import { UsinaMonthlyCostService } from './usina-monthly-cost.service';
import { UsinaAnnualDepreciationController } from './usina-annual-depreciation.controller';
import { UsinaAnnualDepreciationService } from './usina-annual-depreciation.service';
import { UsinaMonthlyResultTargetController } from './usina-monthly-result-target.controller';
import { UsinaMonthlyResultTargetService } from './usina-monthly-result-target.service';
import { UsinaMonthlyStonePowderFreightController } from './usina-monthly-stone-powder-freight.controller';
import { UsinaMonthlyStonePowderFreightService } from './usina-monthly-stone-powder-freight.service';
import { FleetResultMonthlySettingsController } from './fleet-result-monthly-settings.controller';
import { FleetResultMonthlySettingsService } from './fleet-result-monthly-settings.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    UsinaMonthlyCostController,
    UsinaAnnualDepreciationController,
    UsinaMonthlyResultTargetController,
    UsinaMonthlyStonePowderFreightController,
    FleetResultMonthlySettingsController,
  ],
  providers: [
    UsinaMonthlyCostService,
    UsinaAnnualDepreciationService,
    UsinaMonthlyResultTargetService,
    UsinaMonthlyStonePowderFreightService,
    FleetResultMonthlySettingsService,
    UsinaMonthlyCostAccessGuard,
  ],
})
export class UsinaMonthlyCostModule {}
