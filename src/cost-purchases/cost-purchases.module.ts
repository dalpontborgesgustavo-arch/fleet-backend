import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CostPurchasesAccessGuard } from './cost-purchases-access.guard';
import { CostPurchasesController } from './cost-purchases.controller';
import { CostPurchasesPresentationService } from './cost-purchases-presentation.service';
import { CostPurchasesService } from './cost-purchases.service';
import { AethosIntegrationModule } from '../aethos-integration/aethos-integration.module';
import { LucasFleetActualsController } from './lucas-fleet-actuals.controller';
import { LucasFleetRosterController } from './lucas-fleet-roster.controller';

@Module({
  imports: [PrismaModule, AuthModule, AethosIntegrationModule],
  controllers: [CostPurchasesController, LucasFleetActualsController, LucasFleetRosterController],
  providers: [
    CostPurchasesService,
    CostPurchasesPresentationService,
    CostPurchasesAccessGuard,
  ],
})
export class CostPurchasesModule {}
