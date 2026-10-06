export class UsinaOperationalCostSyncDto {
  dataset!:
    | 'VEHICLE_EXPENSES'
    | 'PAYABLE_EXPENSES'
    | 'LABOR_COSTS'
    | 'INTERNAL_CONSUMPTION_EXPENSES'
    | 'MATERIAL_PURCHASE_EXPENSES';
  syncMode!: 'incremental' | 'full';
  syncRunId!: string;
  generatedAt!: string;
  scope!: { company: string; unit: string; dateFrom: string; dateTo: string };
  batchNumber!: number;
  isLastBatch!: boolean;
  rows!: Record<string, unknown>[];
}
