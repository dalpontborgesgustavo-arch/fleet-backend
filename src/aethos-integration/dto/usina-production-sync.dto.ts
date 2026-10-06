export class UsinaSyncScopeDto {
  company!: string;
  unit!: string;
  dateFrom!: string;
  dateTo!: string;
}

export class UsinaProductionRowDto {
  source?: string;
  sourceRecordId?: string;
  idPesagem?: string | number;
  idItem?: string | number;
  description?: string;
  occurredAt?: string;
  quantityTon?: string | number;
  aethosCompanyId?: string | number;
  originFlag?: string | null;
  personId?: string | number | null;
  entryExitFlag?: string | null;
  weighingVehicleStatus?: string;
  weighingStatus?: string;
  tareTon?: string | number | null;
  firstWeighingAt?: string | null;
  secondWeighingAt?: string | null;
  sourceUpdatedAt?: string | null;
  active?: boolean;
}

export class UsinaProductionSyncDto {
  dataset!: string;
  syncMode!: 'incremental' | 'full';
  syncRunId!: string;
  generatedAt!: string;
  scope!: UsinaSyncScopeDto;
  batchNumber!: number;
  isLastBatch!: boolean;
  rows!: UsinaProductionRowDto[];
}
