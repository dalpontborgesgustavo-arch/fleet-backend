import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ThirdPartyMeasurementsModule } from '../third-party-measurements/third-party-measurements.module';
import { AethosIntegrationController } from './aethos-integration.controller';
import { AethosIntegrationService } from './aethos-integration.service';
import { AethosVehicleSyncService } from './aethos-vehicle-sync.service';
import { UsinaProductionSyncService } from './usina-production-sync.service';
import { UsinaRevenueSyncService } from './usina-revenue-sync.service';
import { UsinaMaterialReceiptSyncService } from './usina-material-receipt-sync.service';
import { UsinaOperationalCostSyncService } from './usina-operational-cost-sync.service';
import { UsinaMaterialReceiptExceptionSyncService } from './usina-material-receipt-exception-sync.service';
import { UsinaMaterialStockValuationSyncService } from './usina-material-stock-valuation-sync.service';
import { UsinaPhysicalMaterialMovementSyncService } from './usina-physical-material-movement-sync.service';
import { UsinaFleetMaintenanceLaborAllocationSyncService } from './usina-fleet-maintenance-labor-allocation-sync.service';
import { UsinaAsphaltFleetFreightSyncService } from './usina-asphalt-fleet-freight-sync.service';
import { UsinaAsphaltEquipmentHourSyncService } from './usina-asphalt-equipment-hour-sync.service';
import { TotvsFleetMaintenanceReferenceService } from './totvs-fleet-maintenance-reference.service';
import { CostPurchasesSyncService } from '../cost-purchases/cost-purchases-sync.service';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { LucasFleetRevenueSyncService } from './lucas-fleet-revenue-sync.service';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    ThirdPartyMeasurementsModule,
    PurchaseOrdersModule,
  ],
  controllers: [AethosIntegrationController],
  providers: [
    AethosIntegrationService,
    AethosVehicleSyncService,
    UsinaProductionSyncService,
    UsinaRevenueSyncService,
    UsinaMaterialReceiptSyncService,
    UsinaOperationalCostSyncService,
    UsinaMaterialReceiptExceptionSyncService,
    UsinaMaterialStockValuationSyncService,
    UsinaPhysicalMaterialMovementSyncService,
    UsinaFleetMaintenanceLaborAllocationSyncService,
    UsinaAsphaltFleetFreightSyncService,
    UsinaAsphaltEquipmentHourSyncService,
    TotvsFleetMaintenanceReferenceService,
    CostPurchasesSyncService,
    LucasFleetRevenueSyncService,
  ],
  exports: [
    TotvsFleetMaintenanceReferenceService,
    LucasFleetRevenueSyncService,
  ],
})
export class AethosIntegrationModule {}
