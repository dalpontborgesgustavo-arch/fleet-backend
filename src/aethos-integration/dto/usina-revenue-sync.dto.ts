export class UsinaRevenueSyncScopeDto {
  company!: string;
  unit!: string;
  dateFrom!: string;
  dateTo!: string;
}

export class UsinaRevenueRowDto {
  sourceRecordId?: string;
  ID_PEDIDO?: string | number;
  ID_PEDIDOITEM?: string | number;
  ID_DOCUMENTO?: string | number;
  ID_PESAGEM?: string | number;
  ID_ITEM!: number;
  ID_LINHA?: string | number;
  DS_ITEM!: string;
  DT_PRI_PESAGEM?: string;
  DT_FATURAMENTO?: string;
  VL_PESO?: string | number;
  QT_VENDA?: string | number;
  SG_UNIDADEMEDIDA?: string;
  VL_TOTAL?: string | number;
  VL_VENDA_SEM_FRETE?: string | number;
  VL_FRETE?: string | number | null;
  VL_FRETEPEDIDO?: string | number | null;
  VL_CUSTOITEM?: string | number | null;
  active?: boolean;
}

export class UsinaRevenueSyncDto {
  dataset!: 'INTERNAL_REVENUE' | 'EXTERNAL_REVENUE';
  syncMode!: 'incremental' | 'full';
  syncRunId!: string;
  generatedAt!: string;
  scope!: UsinaRevenueSyncScopeDto;
  batchNumber!: number;
  isLastBatch!: boolean;
  rows!: UsinaRevenueRowDto[];
}
