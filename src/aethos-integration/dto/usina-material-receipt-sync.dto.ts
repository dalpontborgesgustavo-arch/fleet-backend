export class UsinaMaterialReceiptSyncScopeDto {
  company!: string;
  unit!: string;
  dateFrom!: string;
  dateTo!: string;
}

export class UsinaMaterialReceiptRowDto {
  ID_PESAGEM?: string | number;
  ID_PESAGEM_VEICULO?: string | number;
  ID_ENTRADA?: string | number;
  ID_ENTRADAITEM?: string | number;
  ID_ORDEMCOMPRA?: string | number;
  ID_ORDEMCOMPRAITEM?: string | number;
  ID_ITEM!: number;
  ID_TIPOFRETE?: number;
  DS_ITEM!: string;
  DT_PRI_PESAGEM?: string;
  DT_EMISSAO?: string;
  VL_PESO?: string | number;
  QT_ITEM?: string | number;
  SG_UNIDADEMEDIDA?: string;
  VL_CUSTOITEM?: string | number | null;
  QT_QUANTIDADE?: string | number | null;
  QT_USADA?: string | number | null;
  QT_SALDO?: string | number | null;
  VL_PRECOUNITARIO?: string | number | null;
  VL_DESCONTO?: string | number | null;
  VL_FRETE_UNITARIO?: string | number | null;
  VL_FRETE?: string | number | null;
  VL_TOTAL?: string | number | null;
  ID_EMPRESA?: number | null;
  ID_FORNECEDOR?: number | null;
  FL_ENTRADA_SAIDA?: string | null;
  FL_ORIGEM?: string | null;
  FL_STATUS?: string;
  PV_FL_SITUACAO?: string;
  P_FL_SITUACAO?: string;
  VL_TARA?: string | number | null;
  sourceUpdatedAt?: string | null;
  active?: boolean;
}

export class UsinaMaterialReceiptSyncDto {
  dataset!: 'CAP_MOVEMENTS' | 'AGGREGATE_RECEIPTS' | 'CAP_PURCHASE_ORDERS';
  syncMode!: 'incremental' | 'full';
  syncRunId!: string;
  generatedAt!: string;
  scope!: UsinaMaterialReceiptSyncScopeDto;
  batchNumber!: number;
  isLastBatch!: boolean;
  rows!: UsinaMaterialReceiptRowDto[];
}
