import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AethosIntegrationModule } from './aethos-integration/aethos-integration.module';
import { AuthModule } from './auth/auth.module';
import { AwsBillingModule } from './aws-billing/aws-billing.module';
import { BudgetAnalysisModule } from './budget-analysis/budget-analysis.module';
import { BucketActivationsModule } from './bucket-activations/bucket-activations.module';
import { ChecklistModule } from './checklist/checklist.module';
import { ChecklistTemplateModule } from './checklist-template/checklist-template.module';
import { CommercialIndicatorsModule } from './commercial-indicators/commercial-indicators.module';
import { ConstructionControlModule } from './construction-control/construction-control.module';
import { CostPurchasesModule } from './cost-purchases/cost-purchases.module';
import { ContractsModule } from './contracts/contracts.module';
import { EnvironmentalModule } from './environmental/environmental.module';
import { HealthController } from './health/health.controller';
import { HrCommunicationsModule } from './hr-communications/hr-communications.module';
import { LegalCasesModule } from './legal-cases/legal-cases.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OccurrencesModule } from './occurrences/occurrences.module';
import { PartRequestsModule } from './part-requests/part-requests.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrumareModule } from './prumare/prumare.module';
import { RncsModule } from './rncs/rncs.module';
import { RevenueForecastsModule } from './revenue-forecasts/revenue-forecasts.module';
import { SsmaLicensesModule } from './ssma-licenses/ssma-licenses.module';
import { StorageModule } from './storage/storage.module';
import { TaxForecastsModule } from './tax-forecasts/tax-forecasts.module';
import { UsinaForecastsModule } from './usina-forecasts/usina-forecasts.module';
import { UsinaBomModule } from './usina-bom/usina-bom.module';
import { UsinaMonthlyCostModule } from './usina-monthly-cost/usina-monthly-cost.module';
import { UsinaMonthlyResultModule } from './usina-monthly-result/usina-monthly-result.module';
import { UsinaAsphaltTeamsModule } from './usina-asphalt-teams/usina-asphalt-teams.module';
import { ThirdPartyMeasurementsModule } from './third-party-measurements/third-party-measurements.module';
import { TopographyArrivalsModule } from './topography-arrivals/topography-arrivals.module';
import { TopographyInventoryModule } from './topography-inventory/topography-inventory.module';
import { UploadController } from './upload.controller';
import { UploadsController } from './uploads.controller';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    ChecklistTemplateModule,
    CommercialIndicatorsModule,
    ConstructionControlModule,
    CostPurchasesModule,
    ContractsModule,
    AuthModule,
    AwsBillingModule,
    VehiclesModule,
    ChecklistModule,
    UsersModule,
    NotificationsModule,
    OccurrencesModule,
    PartRequestsModule,
    PurchaseOrdersModule,
    PrumareModule,
    RncsModule,
    RevenueForecastsModule,
    SsmaLicensesModule,
    HrCommunicationsModule,
    LegalCasesModule,
    TopographyArrivalsModule,
    TopographyInventoryModule,
    AethosIntegrationModule,
    BudgetAnalysisModule,
    BucketActivationsModule,
    TaxForecastsModule,
    UsinaForecastsModule,
    UsinaBomModule,
    UsinaMonthlyCostModule,
    UsinaMonthlyResultModule,
    UsinaAsphaltTeamsModule,
    EnvironmentalModule,
    ThirdPartyMeasurementsModule,
  ],
  controllers: [
    AppController,
    HealthController,
    UploadController,
    UploadsController,
  ],
  providers: [AppService],
})
export class AppModule {}
