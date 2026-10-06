import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_ASPHALT_EQUIPMENT_HOUR_DATASET =
  'ASPHALT_EQUIPMENT_HOURS' as const;

const BRANCHES = [
  'ENTRADASIMPLESITEM',
  'NFENTRADAITEM',
  'ENTRADASIMPLESFRETE',
  'NFENTRADAFRETE',
  'FRETE',
] as const;
const CATEGORIES = ['VIBROACABADORA', 'ROLO_LISO', 'ROLO_PNEUS'] as const;
const HOUR_TYPES = ['PRODUTIVA', 'IMPRODUTIVA'] as const;
const CLASSIFIER_KINDS = ['ID_ITEM', 'ID_TIPOFRETE'] as const;

type SourceBranch = (typeof BRANCHES)[number];
type Category = (typeof CATEGORIES)[number];
type HourType = (typeof HOUR_TYPES)[number];
type ClassifierKind = (typeof CLASSIFIER_KINDS)[number];
type ClassificationStatus =
  | 'ELIGIBLE'
  | 'SEM_DATA_COMPETENCIA'
  | 'SEM_ID_VEICULO'
  | 'CONFLITO_CATEGORIA';

function object(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${field} deve ser um objeto`);
  }
  return value as Record<string, any>;
}

function text(value: unknown, field: string, max = 200) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max)
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}

function optionalText(value: unknown, max = 200) {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const result = String(value).trim();
  if (result.length > max)
    throw new BadRequestException(`Texto excede ${max} caracteres`);
  return result;
}

function integer(value: unknown, field: string, nullable = false) {
  if (nullable && (value === null || value === undefined || value === ''))
    return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  return result;
}

function dateOnly(value: unknown, field: string) {
  const input = text(value, field, 40).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input))
    throw new BadRequestException(`${field} invalida`);
  const result = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== input)
    throw new BadRequestException(`${field} invalida`);
  return result;
}

function instant(value: unknown, field: string) {
  const result = new Date(text(value, field, 60));
  if (Number.isNaN(result.getTime()))
    throw new BadRequestException(`${field} invalida`);
  return result;
}

function optionalInstant(value: unknown, field: string) {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  return instant(value, field);
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

function booleanValue(value: unknown, defaultValue: boolean) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || String(value).toLowerCase() === 'true')
    return true;
  if (value === false || value === 0 || String(value).toLowerCase() === 'false')
    return false;
  throw new BadRequestException('Valor booleano invalido');
}

function member<T extends readonly string[]>(
  value: unknown,
  field: string,
  options: T,
) {
  const result = text(value, field, 80).toUpperCase();
  if (!options.includes(result as T[number]))
    throw new BadRequestException(`${field} invalido`);
  return result as T[number];
}

const CLASSIFIERS: Record<Category, Record<HourType, number[]>> = {
  VIBROACABADORA: {
    PRODUTIVA: [1135, 1154, 1748, 3749, 3750],
    IMPRODUTIVA: [5246, 5244, 7783, 14393, 14394],
  },
  ROLO_LISO: { PRODUTIVA: [366], IMPRODUTIVA: [4733] },
  ROLO_PNEUS: { PRODUTIVA: [365], IMPRODUTIVA: [2191] },
};

export type NormalizedAsphaltEquipmentHourRow = {
  source: 'AETHOS';
  dataset: typeof USINA_ASPHALT_EQUIPMENT_HOUR_DATASET;
  sourceRecordId: string;
  sourceBranch: SourceBranch;
  sourceCompanyId: number;
  sourceDocumentId: string;
  sourceLineId: string | null;
  documentDate: Date | null;
  sourceDate: Date | null;
  competence: Date | null;
  aethosVehicleId: number | null;
  fleetNumber: string | null;
  plate: string | null;
  category: Category;
  hourType: HourType;
  classifierKind: ClassifierKind;
  classifierId: number;
  quantityHours: Prisma.Decimal;
  sourceAmount: Prisma.Decimal | null;
  sourceStatus: 'F';
  cancelReasonPresent: boolean;
  cancelReason: string | null;
  classificationStatus: ClassificationStatus;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  contentHash: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

export function normalizeUsinaAsphaltEquipmentHourEnvelope(body: unknown) {
  const input = object(body, 'payload');
  if (
    text(input.dataset, 'dataset', 80).toUpperCase() !==
    USINA_ASPHALT_EQUIPMENT_HOUR_DATASET
  ) {
    throw new BadRequestException(
      `dataset deve ser ${USINA_ASPHALT_EQUIPMENT_HOUR_DATASET}`,
    );
  }
  const syncMode = text(input.syncMode, 'syncMode', 20).toLowerCase();
  if (!['full', 'incremental'].includes(syncMode))
    throw new BadRequestException('syncMode deve ser full ou incremental');
  const scope = object(input.scope, 'scope');
  const company = text(scope.company, 'scope.company', 100).toUpperCase();
  const unit = text(scope.unit, 'scope.unit', 100).toUpperCase();
  if (company !== USINA_COMPANY_ID || unit !== USINA_UNIT_ID)
    throw new BadRequestException('Empresa/unidade fora do escopo da Usina');
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateTo < dateFrom)
    throw new BadRequestException('scope.dateTo anterior a dateFrom');
  const batchNumber = integer(input.batchNumber, 'batchNumber')!;
  if (!Array.isArray(input.rows))
    throw new BadRequestException('rows deve ser array');
  if (input.rows.length > USINA_PRODUCTION_BATCH_LIMIT)
    throw new BadRequestException(
      `rows deve ter ate ${USINA_PRODUCTION_BATCH_LIMIT} linhas`,
    );
  return {
    dataset: USINA_ASPHALT_EQUIPMENT_HOUR_DATASET,
    syncMode: syncMode as 'full' | 'incremental',
    syncRunId: text(input.syncRunId, 'syncRunId', 200),
    generatedAt: instant(input.generatedAt, 'generatedAt'),
    scope: {
      company,
      unit,
      dateFrom,
      dateTo,
      includeUndated: booleanValue(scope.includeUndated, false),
    },
    batchNumber,
    isLastBatch: booleanValue(input.isLastBatch, false),
    rows: input.rows,
  };
}

function normalizedSourceDate(
  value: unknown,
  requestedStatus: string | null,
  scope: { dateFrom: Date; dateTo: Date; includeUndated: boolean },
) {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  try {
    const result = dateOnly(value, 'sourceDate');
    if (result < scope.dateFrom || result > scope.dateTo) {
      if (requestedStatus === 'SEM_DATA_COMPETENCIA' && scope.includeUndated)
        return null;
      throw new BadRequestException('sourceDate fora do scope');
    }
    return result;
  } catch (error) {
    if (requestedStatus === 'SEM_DATA_COMPETENCIA' && scope.includeUndated)
      return null;
    throw error;
  }
}

function normalizeRow(
  value: unknown,
  scope: { dateFrom: Date; dateTo: Date; includeUndated: boolean },
): NormalizedAsphaltEquipmentHourRow {
  const row = object(value, 'row');
  if (
    row.source !== undefined &&
    text(row.source, 'source', 20).toUpperCase() !== 'AETHOS'
  ) {
    throw new BadRequestException('source deve ser AETHOS');
  }
  const sourceBranch = member(row.sourceBranch, 'sourceBranch', BRANCHES);
  const hourType = member(row.hourType, 'hourType', HOUR_TYPES);
  const category = member(row.category, 'category', CATEGORIES);
  const classifierKind = member(
    row.classifierKind,
    'classifierKind',
    CLASSIFIER_KINDS,
  );
  if (
    (hourType === 'PRODUTIVA' && classifierKind !== 'ID_TIPOFRETE') ||
    (hourType === 'IMPRODUTIVA' && classifierKind !== 'ID_ITEM')
  ) {
    throw new BadRequestException('classifierKind incompatível com hourType');
  }
  const classifierId = integer(row.classifierId, 'classifierId')!;
  if (!CLASSIFIERS[category][hourType].includes(classifierId))
    throw new BadRequestException('classifierId incompatível com categoria/tipo');
  const sourceStatus = text(row.sourceStatus, 'sourceStatus', 10).toUpperCase();
  if (sourceStatus !== 'F')
    throw new BadRequestException('Somente documentos finalizados F');

  const requestedStatus =
    optionalText(row.classificationStatus, 50)?.toUpperCase() || null;
  if (
    requestedStatus &&
    ![
      'ELIGIBLE',
      'SEM_DATA_COMPETENCIA',
      'SEM_ID_VEICULO',
      'CONFLITO_CATEGORIA',
    ].includes(requestedStatus)
  ) {
    throw new BadRequestException('classificationStatus invalido');
  }
  const sourceDate = normalizedSourceDate(row.sourceDate, requestedStatus, scope);
  const aethosVehicleId = integer(
    row.aethosVehicleId,
    'aethosVehicleId',
    true,
  );
  let classificationStatus: ClassificationStatus = 'ELIGIBLE';
  if (requestedStatus === 'CONFLITO_CATEGORIA')
    classificationStatus = 'CONFLITO_CATEGORIA';
  else if (!sourceDate) classificationStatus = 'SEM_DATA_COMPETENCIA';
  else if (!aethosVehicleId) classificationStatus = 'SEM_ID_VEICULO';

  const sourceCompanyId = integer(row.sourceCompanyId, 'sourceCompanyId')!;
  const sourceDocumentId = text(row.sourceDocumentId, 'sourceDocumentId', 100);
  const sourceLineId = optionalText(row.sourceLineId, 100);
  const documentDate =
    row.documentDate === undefined ||
    row.documentDate === null ||
    String(row.documentDate).trim() === ''
      ? null
      : dateOnly(row.documentDate, 'documentDate');
  const expectedRecordId = `${sourceBranch}|${sourceCompanyId}|${sourceDocumentId}|${
    sourceLineId || '0'
  }|${hourType}`;
  const sourceRecordId = optionalText(row.sourceRecordId, 260) || expectedRecordId;
  if (sourceRecordId !== expectedRecordId)
    throw new BadRequestException('sourceRecordId difere da chave natural');

  const quantityHours = decimal(row.quantityHours, 'quantityHours')!;
  const sourceAmount = decimal(row.sourceAmount, 'sourceAmount', true);
  const cancelReason = optionalText(row.cancelReason, 500);
  const cancelReasonPresent = Boolean(cancelReason) ||
    booleanValue(row.cancelReasonPresent, false);
  const fleetNumber = optionalText(row.fleetNumber, 40);
  const plate = optionalText(row.plate, 20)?.toUpperCase() || null;
  const sourceCreatedAt = optionalInstant(row.sourceCreatedAt, 'sourceCreatedAt');
  const sourceUpdatedAt = optionalInstant(row.sourceUpdatedAt, 'sourceUpdatedAt');
  const active = booleanValue(row.active, true);
  const raw = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
  const competence = sourceDate
    ? new Date(Date.UTC(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth(), 1))
    : null;

  const normalized = {
    source: 'AETHOS' as const,
    dataset: USINA_ASPHALT_EQUIPMENT_HOUR_DATASET,
    sourceRecordId,
    sourceBranch,
    sourceCompanyId,
    sourceDocumentId,
    sourceLineId,
    documentDate,
    sourceDate,
    competence,
    aethosVehicleId,
    fleetNumber,
    plate,
    category,
    hourType,
    classifierKind,
    classifierId,
    quantityHours,
    sourceAmount,
    sourceStatus: 'F' as const,
    cancelReasonPresent,
    cancelReason,
    classificationStatus,
    sourceCreatedAt,
    sourceUpdatedAt,
    raw,
    active,
  };
  const contentHash = hashCanonicalValue({
    sourceRecordId,
    documentDate: documentDate?.toISOString().slice(0, 10) ?? '__NULL__',
    sourceDate: sourceDate?.toISOString().slice(0, 10) ?? '__NULL__',
    aethosVehicleId: aethosVehicleId ?? '__NULL__',
    fleetNumber: fleetNumber ?? '__NULL__',
    plate: plate ?? '__NULL__',
    category,
    hourType,
    classifierKind,
    classifierId,
    quantityHours: quantityHours.toFixed(6),
    sourceAmount: sourceAmount?.toFixed(6) ?? '__NULL__',
    sourceStatus: 'F',
    cancelReasonPresent,
    cancelReason: cancelReason ?? '__NULL__',
    classificationStatus,
    active,
  });
  if (
    row.contentHash &&
    String(row.contentHash).trim().toLowerCase() !== contentHash
  ) {
    throw new BadRequestException('contentHash divergente do contrato canonico');
  }
  return { ...normalized, contentHash };
}

export function normalizeUsinaAsphaltEquipmentHourRows(
  rows: unknown[],
  scope: { dateFrom: Date; dateTo: Date; includeUndated: boolean },
) {
  const accepted: NormalizedAsphaltEquipmentHourRow[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    try {
      const normalized = normalizeRow(row, scope);
      if (keys.has(normalized.sourceRecordId))
        throw new BadRequestException('sourceRecordId duplicado no lote');
      keys.add(normalized.sourceRecordId);
      accepted.push(normalized);
    } catch (error: any) {
      rejected.push({ index, reason: String(error?.message || error) });
    }
  });
  return { accepted, rejected };
}
