import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COST_PURCHASE_EXPENSE_DATASET,
  COST_PURCHASE_FUEL_DATASET,
  COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
  COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
  COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
} from './cost-purchases.rules';
import { hashCanonicalValue } from '../aethos-integration/usina-production-sync.rules';

function object(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${field} deve ser objeto`);
  }
  return value as Record<string, any>;
}

function scalarText(value: unknown) {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}

function text(value: unknown, field: string, max = 200) {
  const result = scalarText(value).trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max)
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}

function optionalText(value: unknown, max = 200) {
  const input = scalarText(value).trim();
  if (!input) return null;
  const result = input;
  if (result.length > max)
    throw new BadRequestException(`Texto excede ${max} caracteres`);
  return result;
}

function dateOnly(value: unknown, field: string) {
  const input = text(value, field, 40).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException(`${field} invalida`);
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input
  ) {
    throw new BadRequestException(`${field} invalida`);
  }
  return date;
}

function instant(value: unknown, field: string) {
  const date = new Date(text(value, field, 60));
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`${field} invalida`);
  return date;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  return positiveInteger(value, field);
}

function optionalInstant(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  return instant(value, field);
}

function optionalBoolean(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = scalarText(value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (['1', 'TRUE', 'T', 'S', 'SIM', 'Y', 'YES'].includes(normalized)) {
    return true;
  }
  if (['0', 'FALSE', 'F', 'N', 'NAO', 'NO'].includes(normalized)) {
    return false;
  }
  throw new BadRequestException(`${field} deve ser booleano`);
}

function sha256(value: unknown, field: string) {
  const result = text(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new BadRequestException(`${field} deve ser SHA-256 hexadecimal`);
  }
  return result;
}

function decimal(value: unknown, field: string, nullable = false) {
  if (nullable && (value === undefined || value === null || value === ''))
    return null;
  try {
    const result = new Prisma.Decimal(value as any);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new BadRequestException(`${field} deve ser decimal`);
  }
}

function nonNegativeDecimal(value: unknown, field: string, nullable = false) {
  const result = decimal(value, field, nullable);
  if (result?.isNegative())
    throw new BadRequestException(`${field} nao pode ser negativo`);
  return result;
}

export type CostPurchaseSyncDataset =
  | typeof COST_PURCHASE_EXPENSE_DATASET
  | typeof COST_PURCHASE_FUEL_DATASET
  | typeof COST_PURCHASE_MANAGERIAL_ENTRY_DATASET
  | typeof COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET
  | typeof COST_PURCHASE_PREVENTIVE_ORDER_DATASET;

export function normalizeCostPurchaseEnvelope(
  body: unknown,
  expectedDataset: CostPurchaseSyncDataset,
) {
  const input = object(body, 'payload');
  if (input.dataset !== expectedDataset) {
    throw new BadRequestException(`dataset deve ser ${expectedDataset}`);
  }
  const syncMode = text(input.syncMode, 'syncMode', 20).toLowerCase();
  if (!['full', 'incremental'].includes(syncMode)) {
    throw new BadRequestException('syncMode deve ser full ou incremental');
  }
  const scope = object(input.scope, 'scope');
  const company = text(scope.company, 'scope.company', 80);
  const unit = text(scope.unit, 'scope.unit', 80);
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateTo < dateFrom)
    throw new BadRequestException('scope.dateTo anterior a dateFrom');
  const aethosVehicleIds =
    scope.aethosVehicleIds === undefined
      ? []
      : Array.from(
          new Set(
            (Array.isArray(scope.aethosVehicleIds)
              ? scope.aethosVehicleIds
              : []
            ).map((value) => positiveInteger(value, 'scope.aethosVehicleIds')),
          ),
        );
  if (
    scope.aethosVehicleIds !== undefined &&
    !Array.isArray(scope.aethosVehicleIds)
  ) {
    throw new BadRequestException('scope.aethosVehicleIds deve ser array');
  }
  if (!Array.isArray(input.rows))
    throw new BadRequestException('rows deve ser array');
  if (
    [
      COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
      COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
    ].includes(expectedDataset as any) &&
    aethosVehicleIds.length
  ) {
    throw new BadRequestException(
      'scope.aethosVehicleIds deve ser omitido para este dataset',
    );
  }
  return {
    dataset: expectedDataset,
    syncMode: syncMode as 'full' | 'incremental',
    syncRunId: text(input.syncRunId, 'syncRunId', 160),
    generatedAt: instant(input.generatedAt, 'generatedAt'),
    scope: { company, unit, dateFrom, dateTo, aethosVehicleIds },
    batchNumber: positiveInteger(input.batchNumber, 'batchNumber'),
    isLastBatch: Boolean(input.isLastBatch),
    rows: input.rows,
  };
}

type Scope = ReturnType<typeof normalizeCostPurchaseEnvelope>['scope'];

function scopedRow(value: unknown, scope: Scope) {
  const row = object(value, 'row');
  const companyId = text(
    row.companyId ?? row.ID_EMPRESA ?? scope.company,
    'companyId',
    80,
  );
  const unitId = text(
    row.unitId ?? row.ID_FILIAL ?? row.ID_UNIDADE ?? scope.unit,
    'unitId',
    80,
  );
  if (companyId !== scope.company) {
    throw new BadRequestException('companyId fora do scope');
  }
  if (unitId !== scope.unit) {
    throw new BadRequestException('unitId fora do scope');
  }
  return { row, companyId, unitId };
}

function competenceForDate(
  row: Record<string, any>,
  documentDate: Date,
  scope: Scope,
) {
  if (documentDate < scope.dateFrom || documentDate > scope.dateTo) {
    throw new BadRequestException('documentDate fora do scope');
  }
  const competence = new Date(
    Date.UTC(documentDate.getUTCFullYear(), documentDate.getUTCMonth(), 1),
  );
  if (row.competence !== undefined && row.competence !== null) {
    const informed = dateOnly(row.competence, 'competence');
    if (informed.getTime() !== competence.getTime()) {
      throw new BadRequestException(
        'competence deve ser o primeiro dia do mes de documentDate',
      );
    }
  }
  return competence;
}

function commonRow(value: unknown, scope: Scope, sourceIdFields: string[]) {
  const row = object(value, 'row');
  const sourceRecordId = text(
    sourceIdFields
      .map((field) => row[field])
      .find((value) => value !== undefined),
    'sourceRecordId',
    220,
  );
  const documentDate = dateOnly(
    row.documentDate ?? row.DT_LANCAMENTO ?? row.DATA,
    'documentDate',
  );
  if (documentDate < scope.dateFrom || documentDate > scope.dateTo) {
    throw new BadRequestException('documentDate fora do scope');
  }
  const aethosVehicleId = positiveInteger(
    row.aethosVehicleId ?? row.ID_VEICULO,
    'aethosVehicleId',
  );
  if (
    scope.aethosVehicleIds.length &&
    !scope.aethosVehicleIds.includes(aethosVehicleId)
  ) {
    throw new BadRequestException('aethosVehicleId fora do scope');
  }
  return {
    row,
    sourceRecordId,
    documentDate,
    competence: new Date(
      Date.UTC(documentDate.getUTCFullYear(), documentDate.getUTCMonth(), 1),
    ),
    aethosVehicleId,
    active: row.active === undefined ? true : Boolean(row.active),
  };
}

export type NormalizedCostPurchaseExpenseRow = ReturnType<
  typeof normalizeExpenseRow
>;
export type NormalizedCostPurchaseFuelRow = ReturnType<typeof normalizeFuelRow>;
export type NormalizedCostPurchaseManagerialEntryRow = ReturnType<
  typeof normalizeManagerialEntryRow
>;
export type NormalizedCostPurchaseInternalConsumptionRow = ReturnType<
  typeof normalizeInternalConsumptionRow
>;
export type NormalizedCostPurchasePreventiveOrderRow = ReturnType<
  typeof normalizePreventiveOrderRow
>;

function normalizeExpenseRow(value: unknown, scope: Scope) {
  const common = commonRow(value, scope, [
    'sourceRecordId',
    'SOURCE_RECORD_ID',
    'ID_DESPESA',
  ]);
  const amount = decimal(common.row.amount ?? common.row.VL_TOTAL, 'VL_TOTAL')!;
  const desiredAverage = nonNegativeDecimal(
    common.row.desiredAverage ?? common.row.MEDIA_DESEJADA,
    'MEDIA_DESEJADA',
    true,
  );
  const raw = JSON.parse(JSON.stringify(common.row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    sourceRecordId: common.sourceRecordId,
    competence: common.competence,
    aethosVehicleId: common.aethosVehicleId,
    documentDate: common.documentDate,
    documentNumber: optionalText(
      common.row.documentNumber ?? common.row.NR_DOCUMENTO,
      100,
    ),
    amount,
    desiredAverage,
    raw,
    active: common.active,
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      competence: normalized.competence.toISOString().slice(0, 10),
      documentDate: normalized.documentDate.toISOString().slice(0, 10),
      amount: amount.toFixed(12),
      desiredAverage: desiredAverage?.toFixed(12) ?? null,
      raw: undefined,
    }),
  };
}

function normalizeFuelRow(value: unknown, scope: Scope) {
  const common = commonRow(value, scope, [
    'sourceRecordId',
    'SOURCE_RECORD_ID',
    'ID_ABASTECIMENTO',
  ]);
  const fuelAmount = nonNegativeDecimal(
    common.row.fuelAmount ?? common.row.VL_ABASTECIMENTO,
    'VL_ABASTECIMENTO',
  )!;
  const liters = nonNegativeDecimal(
    common.row.liters ?? common.row.QT_LITROS,
    'QT_LITROS',
  )!;
  const initialKm = nonNegativeDecimal(
    common.row.initialKm ?? common.row.NR_KMINICIAL,
    'NR_KMINICIAL',
    true,
  );
  const currentKm = nonNegativeDecimal(
    common.row.currentKm ?? common.row.NR_KMATUAL,
    'NR_KMATUAL',
    true,
  );
  const usesHourMeter = optionalBoolean(
    common.row.usesHourMeter ?? common.row.FL_TRABALHAHORIMETRO,
    'FL_TRABALHAHORIMETRO',
  );
  const sourceAverage = nonNegativeDecimal(
    common.row.sourceAverage ?? common.row.VL_MEDIA,
    'VL_MEDIA',
    true,
  );
  const desiredAverage = nonNegativeDecimal(
    common.row.desiredAverage ?? common.row.MEDIA_DESEJADA,
    'MEDIA_DESEJADA',
    true,
  );
  const planAccountValue =
    common.row.planAccountId ?? common.row.ID_PLANO_CONTA;
  const planAccountId =
    planAccountValue === undefined ||
    planAccountValue === null ||
    planAccountValue === ''
      ? null
      : positiveInteger(planAccountValue, 'planAccountId');
  const raw = JSON.parse(JSON.stringify(common.row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    sourceRecordId: common.sourceRecordId,
    competence: common.competence,
    aethosVehicleId: common.aethosVehicleId,
    documentDate: common.documentDate,
    fuelAmount,
    liters,
    initialKm,
    currentKm,
    usesHourMeter,
    sourceAverage,
    desiredAverage,
    planAccountId,
    raw,
    active: common.active,
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      competence: normalized.competence.toISOString().slice(0, 10),
      documentDate: normalized.documentDate.toISOString().slice(0, 10),
      fuelAmount: fuelAmount.toFixed(12),
      liters: liters.toFixed(12),
      initialKm: initialKm?.toFixed(12) ?? null,
      currentKm: currentKm?.toFixed(12) ?? null,
      usesHourMeter,
      sourceAverage: sourceAverage?.toFixed(12) ?? null,
      desiredAverage: desiredAverage?.toFixed(12) ?? null,
      planAccountId,
      raw: undefined,
    }),
  };
}

function normalizeManagerialEntryRow(value: unknown, scope: Scope) {
  const row = object(value, 'row');
  const sourceRecordId = text(
    row.sourceRecordId ?? row.SOURCE_RECORD_ID,
    'sourceRecordId',
    220,
  );
  const sourceHeaderId = text(
    row.sourceHeaderId ?? row.ID_NFENTRADA,
    'sourceHeaderId',
    120,
  );
  const sourceItemId = text(
    row.sourceItemId ?? row.ID_NFENTRADAITEM,
    'sourceItemId',
    120,
  );
  const documentDate = dateOnly(
    row.documentDate ?? row.DT_EMISSAO,
    'documentDate',
  );
  if (documentDate < scope.dateFrom || documentDate > scope.dateTo) {
    throw new BadRequestException('documentDate fora do scope');
  }
  const companyId = text(
    row.companyId ?? row.ID_EMPRESA ?? scope.company,
    'companyId',
    80,
  );
  if (companyId !== scope.company) {
    throw new BadRequestException('companyId fora do scope');
  }
  const sourceStatus = text(
    row.status ?? row.FL_STATUS,
    'status',
    10,
  ).toUpperCase();
  if (sourceStatus !== 'F' && sourceStatus !== 'C') {
    throw new BadRequestException('status deve ser F ou C');
  }
  if (sourceStatus === 'C' && row.active === undefined) {
    throw new BadRequestException('active=false e obrigatorio para status C');
  }
  const active =
    row.active === undefined ? true : optionalBoolean(row.active, 'active');
  if (active !== (sourceStatus === 'F')) {
    throw new BadRequestException('active diverge do status da nota');
  }
  const sourceOrderId = optionalText(
    row.orderId ?? row.sourceOrderId ?? row.ID_ORDEMCOMPRA,
    120,
  );
  const sourceOrderItemId = optionalText(
    row.orderItemId ?? row.sourceOrderItemId ?? row.ID_ORDEMCOMPRAITEM,
    120,
  );
  const sourceOrderStatus =
    optionalText(
      row.orderStatus ?? row.sourceOrderStatus ?? row.ORDEMCOMPRA_FL_STATUS,
      10,
    )?.toUpperCase() ?? null;
  if (sourceOrderStatus && (!sourceOrderId || !sourceOrderItemId)) {
    throw new BadRequestException(
      'orderStatus exige ID_ORDEMCOMPRA e ID_ORDEMCOMPRAITEM oficiais',
    );
  }
  const aethosItemId = positiveInteger(
    row.aethosItemId ?? row.ID_ITEM,
    'aethosItemId',
  );
  const quantity = nonNegativeDecimal(
    row.quantity ?? row.QT_QUANTIDADE,
    'quantity',
    true,
  );
  const totalValue = decimal(row.totalValue ?? row.VL_TOTALITEM, 'totalValue')!;
  const raw = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    sourceRecordId,
    sourceHeaderId,
    sourceItemId,
    documentDate,
    competence: new Date(
      Date.UTC(documentDate.getUTCFullYear(), documentDate.getUTCMonth(), 1),
    ),
    documentNumber: optionalText(row.documentNumber ?? row.NR_NOTA, 100),
    sourceStatus,
    sourceOrderId,
    sourceOrderItemId,
    sourceOrderStatus,
    aethosItemId,
    unit: optionalText(row.unit ?? row.UNIDADE, 40),
    quantity,
    totalValue,
    raw,
    active,
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      documentDate: documentDate.toISOString().slice(0, 10),
      competence: normalized.competence.toISOString().slice(0, 10),
      quantity: quantity?.toFixed(12) ?? null,
      totalValue: totalValue.toFixed(12),
      raw: undefined,
    }),
  };
}

function normalizeInternalConsumptionRow(value: unknown, scope: Scope) {
  const scoped = scopedRow(value, scope);
  const row = scoped.row;
  const source = text(row.source ?? 'AETHOS', 'source', 40).toUpperCase();
  if (source !== 'AETHOS') {
    throw new BadRequestException('source deve ser AETHOS');
  }
  const sourceRecordId = text(
    row.sourceRecordId ?? row.SOURCE_RECORD_ID,
    'sourceRecordId',
    220,
  );
  const sourceHeaderId = text(
    row.sourceHeaderId ?? row.ID_CONSUMOINTERNO,
    'sourceHeaderId',
    120,
  );
  const sourceItemId = text(
    row.sourceItemId ?? row.ID_CONSUMOINTERNOITEM,
    'sourceItemId',
    120,
  );
  const documentDate = dateOnly(
    row.documentDate ?? row.DT_LANCAMENTO ?? row.DATA,
    'documentDate',
  );
  const competence = competenceForDate(row, documentDate, scope);
  const planAccountId = positiveInteger(
    row.planAccountId ?? row.ID_PLANO_CONTA,
    'planAccountId',
  );
  const categoryId = positiveInteger(
    row.categoryId ?? row.ID_CATEGORIA,
    'categoryId',
  );
  const aethosItemId = positiveInteger(
    row.itemId ?? row.aethosItemId ?? row.ID_ITEM,
    'itemId',
  );
  const aethosVehicleId = optionalPositiveInteger(
    row.aethosVehicleId ?? row.ID_VEICULO,
    'aethosVehicleId',
  );
  const quantity = nonNegativeDecimal(
    row.quantity ?? row.QT_QUANTIDADE,
    'quantity',
    true,
  );
  const amount = nonNegativeDecimal(
    row.amount ?? row.VL_TOTALITEM ?? row.VL_TOTAL,
    'amount',
  )!;
  const sourceUpdatedAt = optionalInstant(
    row.sourceUpdatedAt ?? row.DT_ATUALIZACAO,
    'sourceUpdatedAt',
  );
  const sourceContentHash = sha256(
    row.contentHash ?? row.CONTENT_HASH,
    'contentHash',
  );
  const raw = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    sourceRecordId,
    sourceHeaderId,
    sourceItemId,
    documentDate,
    competence,
    documentNumber: optionalText(row.documentNumber ?? row.NR_DOCUMENTO, 100),
    planAccountId,
    categoryId,
    aethosItemId,
    aethosVehicleId,
    assetCode: optionalText(row.assetCode ?? row.CD_ATIVO, 120),
    quantity,
    unit: optionalText(row.unit ?? row.UNIDADE, 40),
    amount,
    sourceUpdatedAt,
    sourceContentHash,
    raw,
    active: row.active === undefined ? true : Boolean(row.active),
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      documentDate: documentDate.toISOString().slice(0, 10),
      competence: competence.toISOString().slice(0, 10),
      quantity: quantity?.toFixed(12) ?? null,
      amount: amount.toFixed(12),
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      raw: undefined,
    }),
  };
}

function normalizePreventiveOrderRow(value: unknown, scope: Scope) {
  const scoped = scopedRow(value, scope);
  const row = scoped.row;
  const source = text(row.source ?? 'AETHOS', 'source', 40).toUpperCase();
  if (source !== 'AETHOS') {
    throw new BadRequestException('source deve ser AETHOS');
  }
  const sourceRecordId = text(
    row.sourceRecordId ?? row.SOURCE_RECORD_ID,
    'sourceRecordId',
    220,
  );
  const orderId = text(row.orderId ?? row.ID_TOS, 'orderId', 120);
  const documentDate = dateOnly(
    row.documentDate ?? row.DT_ORDEM ?? row.DATA,
    'documentDate',
  );
  const competence = competenceForDate(row, documentDate, scope);
  const aethosVehicleId = optionalPositiveInteger(
    row.aethosVehicleId ?? row.ID_VEICULO,
    'aethosVehicleId',
  );
  const amount = nonNegativeDecimal(
    row.amount ?? row.VL_DESPESA_ORDEM ?? row.VL_TOTAL,
    'amount',
  )!;
  if (!Array.isArray(row.preventiveLinkIds)) {
    throw new BadRequestException('preventiveLinkIds deve ser array');
  }
  const preventiveLinkIds = Array.from(
    new Set(
      row.preventiveLinkIds.map((entry: unknown) =>
        text(entry, 'preventiveLinkIds', 120),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));
  if (!preventiveLinkIds.length) {
    throw new BadRequestException('preventiveLinkIds nao pode ser vazio');
  }
  const sourceUpdatedAt = optionalInstant(
    row.sourceUpdatedAt ?? row.DT_ATUALIZACAO,
    'sourceUpdatedAt',
  );
  const sourceContentHash = sha256(
    row.contentHash ?? row.CONTENT_HASH,
    'contentHash',
  );
  const raw = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    sourceRecordId,
    orderId,
    documentDate,
    competence,
    documentNumber: optionalText(row.documentNumber ?? row.NR_ORDEM, 100),
    aethosVehicleId,
    assetCode: optionalText(row.assetCode ?? row.CD_ATIVO, 120),
    amount,
    preventiveLinkIds: preventiveLinkIds as unknown as Prisma.InputJsonValue,
    sourceUpdatedAt,
    sourceContentHash,
    raw,
    active: row.active === undefined ? true : Boolean(row.active),
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      documentDate: documentDate.toISOString().slice(0, 10),
      competence: competence.toISOString().slice(0, 10),
      amount: amount.toFixed(12),
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      raw: undefined,
    }),
  };
}

export function normalizeCostPurchaseRows(
  dataset: CostPurchaseSyncDataset,
  rows: unknown[],
  scope: Scope,
) {
  const accepted: Array<
    | NormalizedCostPurchaseExpenseRow
    | NormalizedCostPurchaseFuelRow
    | NormalizedCostPurchaseManagerialEntryRow
    | NormalizedCostPurchaseInternalConsumptionRow
    | NormalizedCostPurchasePreventiveOrderRow
  > = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    try {
      const normalized =
        dataset === COST_PURCHASE_EXPENSE_DATASET
          ? normalizeExpenseRow(row, scope)
          : dataset === COST_PURCHASE_FUEL_DATASET
            ? normalizeFuelRow(row, scope)
            : dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET
              ? normalizeManagerialEntryRow(row, scope)
              : dataset === COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET
                ? normalizeInternalConsumptionRow(row, scope)
                : normalizePreventiveOrderRow(row, scope);
      const naturalKey =
        dataset === COST_PURCHASE_PREVENTIVE_ORDER_DATASET
          ? `ORDER:${(normalized as NormalizedCostPurchasePreventiveOrderRow).orderId}`
          : normalized.sourceRecordId;
      if (keys.has(naturalKey)) {
        throw new BadRequestException('chave natural duplicada no lote');
      }
      keys.add(naturalKey);
      accepted.push(normalized);
    } catch (error) {
      rejected.push({
        index,
        reason: error instanceof Error ? error.message : 'Linha invalida',
      });
    }
  });
  return { accepted, rejected };
}
