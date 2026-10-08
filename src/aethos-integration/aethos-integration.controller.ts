import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  buildFileUploadPipe,
  MAX_FILE_UPLOAD_SIZE_BYTES,
} from '../storage/file-upload.util';
import { AethosIntegrationService } from './aethos-integration.service';
import { AethosVehicleSyncService } from './aethos-vehicle-sync.service';
import { ThirdPartyMeasurementsService } from '../third-party-measurements/third-party-measurements.service';
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
import { TotvsFleetMaintenanceReferenceQueryDto } from './dto/totvs-fleet-maintenance-reference.dto';
import { CostPurchasesSyncService } from '../cost-purchases/cost-purchases-sync.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { LucasFleetRevenueSyncService } from './lucas-fleet-revenue-sync.service';

@Controller('integrations/aethos')
export class AethosIntegrationController {
  constructor(
    private readonly service: AethosIntegrationService,
    private readonly vehicleSyncService: AethosVehicleSyncService,
    private readonly thirdPartyMeasurementsService: ThirdPartyMeasurementsService,
    private readonly usinaProductionSyncService: UsinaProductionSyncService,
    private readonly usinaRevenueSyncService: UsinaRevenueSyncService,
    private readonly usinaMaterialReceiptSyncService: UsinaMaterialReceiptSyncService,
    private readonly usinaOperationalCostSyncService: UsinaOperationalCostSyncService,
    private readonly usinaMaterialReceiptExceptionSyncService: UsinaMaterialReceiptExceptionSyncService,
    private readonly usinaMaterialStockValuationSyncService: UsinaMaterialStockValuationSyncService,
    private readonly usinaPhysicalMaterialMovementSyncService: UsinaPhysicalMaterialMovementSyncService,
    private readonly usinaFleetMaintenanceLaborAllocationSyncService: UsinaFleetMaintenanceLaborAllocationSyncService,
    private readonly usinaAsphaltFleetFreightSyncService: UsinaAsphaltFleetFreightSyncService,
    private readonly usinaAsphaltEquipmentHourSyncService: UsinaAsphaltEquipmentHourSyncService,
    private readonly totvsFleetMaintenanceReferenceService: TotvsFleetMaintenanceReferenceService,
    private readonly costPurchasesSyncService: CostPurchasesSyncService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly lucasFleetRevenueSyncService: LucasFleetRevenueSyncService,
  ) {}

  @Get('status')
  status(
    @Headers('x-aethos-sync-token') token?: string | string[],
    @Headers('authorization') authorization?: string,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.status();
  }

  @Post('items/sync')
  syncItems(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncItems(body);
  }

  @Post('purchase-orders/sync')
  syncPurchaseOrders(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.purchaseOrdersService.sync(body);
  }

  @Post('lucas-fleet/revenues/sync')
  syncLucasFleetRevenues(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.lucasFleetRevenueSyncService.sync(body);
  }

  @Post('lucas-fleet/revenues/runs/:runId/finalize')
  finalizeLucasFleetRevenues(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.lucasFleetRevenueSyncService.finalize(runId, body);
  }

  @Get('lucas-fleet/revenues/runs/:runId')
  readLucasFleetRevenueRun(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    this.service.assertToken(token, authorization);
    return this.lucasFleetRevenueSyncService.readback(runId);
  }

  @Post('veiculos/sync')
  syncVehicles(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.vehicleSyncService.sync(body);
  }

  @Post('cost-purchases/vehicle-expenses/sync')
  syncCostPurchaseVehicleExpenses(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.syncExpenses(body);
  }

  @Post('cost-purchases/vehicle-fuel/sync')
  syncCostPurchaseVehicleFuel(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.syncFuel(body);
  }

  @Post('cost-purchases/managerial-entry-items/sync')
  syncCostPurchaseManagerialEntries(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.syncManagerialEntries(body);
  }

  @Get('cost-purchases/managerial-entry-items/reconciliation')
  async managerialEntryReconciliation(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ) {
    this.service.assertToken(token, authorization);
    const payload =
      await this.costPurchasesSyncService.managerialEntryReconciliation();
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    if (bytes.length > 16 * 1024 * 1024) {
      throw new PayloadTooLargeException('Inventario gerencial excede 16 MiB');
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader(
      'X-Content-SHA256',
      createHash('sha256').update(bytes).digest('hex'),
    );
    response.send(bytes);
  }

  @Post('cost-purchases/internal-consumption/sync')
  syncCostPurchaseInternalConsumption(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.syncInternalConsumption(body);
  }

  @Post('cost-purchases/preventive-orders/sync')
  syncCostPurchasePreventiveOrders(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.syncPreventiveOrders(body);
  }

  @Get('cost-purchases/status')
  costPurchasesStatus(
    @Headers('x-aethos-sync-token') token?: string | string[],
    @Headers('authorization') authorization?: string,
  ) {
    this.service.assertToken(token, authorization);
    return this.costPurchasesSyncService.status();
  }

  @Post('obras/sync')
  syncObras(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncObras(body);
  }

  @Post('obras-custos/sync')
  syncObrasCustos(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncObrasCustos(body);
  }

  @Post('subgrupos-custos/sync')
  syncSubgroupCosts(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncSubgroupCosts(body);
  }

  @Post('custos-plano-conta/sync')
  syncPlanAccountCosts(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncPlanAccountCosts(body);
  }

  @Post('custos-plano-conta/reparcelamentos/reconcile')
  reconcilePlanAccountCostReparcelments(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.reconcilePlanAccountCostReparcelments(body);
  }

  @Post('contratos/sync')
  syncContracts(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.syncContracts(body);
  }

  @Post('medicoes-terceiro/sync')
  syncThirdPartyMeasurements(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.thirdPartyMeasurementsService.syncFromAethos(body);
  }

  @Get('usina/status')
  usinaStatus(
    @Headers('x-aethos-sync-token') token?: string | string[],
    @Headers('authorization') authorization?: string,
  ) {
    this.service.assertToken(token, authorization);
    return Promise.all([
      this.usinaProductionSyncService.status(),
      this.usinaRevenueSyncService.status(),
      this.usinaMaterialReceiptSyncService.status(),
      this.usinaOperationalCostSyncService.status(),
      this.usinaMaterialReceiptExceptionSyncService.status(),
      this.usinaMaterialStockValuationSyncService.status(),
      this.usinaPhysicalMaterialMovementSyncService.status(),
      this.usinaFleetMaintenanceLaborAllocationSyncService.status(),
      this.usinaAsphaltFleetFreightSyncService.status(),
      this.usinaAsphaltEquipmentHourSyncService.status(),
    ]).then(
      ([
        production,
        revenues,
        materialReceipts,
        operationalCosts,
        materialReceiptExceptions,
        materialStockValuations,
        physicalMaterialMovements,
        fleetMaintenanceLaborAllocations,
        asphaltTeamFleetFreights,
        asphaltEquipmentHours,
      ]) => ({
        ...production,
        ...revenues,
        ...materialReceipts,
        ...operationalCosts,
        ...materialReceiptExceptions,
        ...materialStockValuations,
        ...physicalMaterialMovements,
        ...fleetMaintenanceLaborAllocations,
        ...asphaltTeamFleetFreights,
        ...asphaltEquipmentHours,
      }),
    );
  }

  @Post('usina/asphalt-equipment-hours/sync')
  syncUsinaAsphaltEquipmentHours(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaAsphaltEquipmentHourSyncService.sync(body);
  }

  @Post('usina/asphalt-team-fleet-freights/sync')
  syncUsinaAsphaltTeamFleetFreights(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaAsphaltFleetFreightSyncService.sync(body);
  }

  @Post('usina/fleet-maintenance-labor-allocations/sync')
  syncUsinaFleetMaintenanceLaborAllocations(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaFleetMaintenanceLaborAllocationSyncService.sync(body);
  }

  @Get('usina/fleet-maintenance-labor-reference')
  fleetMaintenanceLaborReference(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: TotvsFleetMaintenanceReferenceQueryDto,
  ) {
    this.service.assertToken(token, authorization);
    return this.totvsFleetMaintenanceReferenceService.reference(
      query.dateFrom,
      query.dateTo,
    );
  }

  @Post('usina/physical-material-movements/sync')
  syncUsinaPhysicalMaterialMovements(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaPhysicalMaterialMovementSyncService.sync(body);
  }

  @Post('usina/material-stock-valuations/sync')
  syncUsinaMaterialStockValuations(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaMaterialStockValuationSyncService.sync(body);
  }

  @Post('usina/material-receipt-exceptions/sync')
  syncUsinaMaterialReceiptExceptions(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaMaterialReceiptExceptionSyncService.sync(body);
  }

  @Post('usina/operational-costs/sync')
  syncUsinaOperationalCosts(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaOperationalCostSyncService.sync(body);
  }

  @Post('usina/material-receipts/sync')
  syncUsinaMaterialReceipts(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaMaterialReceiptSyncService.sync(body);
  }

  @Post('usina/revenues/sync')
  syncUsinaRevenues(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaRevenueSyncService.sync(body);
  }

  @Post('usina/production/sync')
  syncUsinaProduction(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.service.assertToken(token, authorization);
    return this.usinaProductionSyncService.sync(body);
  }

  @Post('contratos/anexos/:idAnexoAethos/arquivo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_UPLOAD_SIZE_BYTES },
    }),
  )
  uploadContractAttachment(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Param('idAnexoAethos') idAnexoAethos: string,
    @UploadedFile(buildFileUploadPipe()) file: Express.Multer.File,
  ) {
    this.service.assertToken(token, authorization);
    return this.service.uploadContractAttachmentFile(idAnexoAethos, file);
  }
}

