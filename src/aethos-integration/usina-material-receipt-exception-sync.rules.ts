import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashCanonicalValue, USINA_COMPANY_ID, USINA_PRODUCTION_BATCH_LIMIT, USINA_UNIT_ID } from './usina-production-sync.rules';

export const USINA_MATERIAL_EXCEPTION_DATASET = 'AGGREGATE_RECEIPT_EXCEPTIONS' as const;
type AnyRow = Record<string, unknown>;

export interface NormalizedMaterialExceptionEnvelope {
  dataset: typeof USINA_MATERIAL_EXCEPTION_DATASET;
  syncMode: 'full';
  syncRunId: string;
  generatedAt: Date;
  scope: { dateFrom: Date; dateTo: Date; materialClass: 'PO_DE_PEDRA'; sourcePartyId: number };
  batchNumber: number;
  isLastBatch: boolean;
  rows: unknown[];
}

export interface NormalizedMaterialExceptionRow {
  index: number;
  source: 'AETHOS';
  dataset: typeof USINA_MATERIAL_EXCEPTION_DATASET;
  sourceRecordId: string;
  sourceTicketId: string;
  sourceVehicleWeighingId: number;
  occurredAt: Date;
  occurredDate: Date;
  competence: Date;
  finalizedAt: Date | null;
  plate: string;
  sourcePartyId: number;
  sourcePartyName: string;
  aethosItemId: number;
  itemDescription: string;
  materialClass: 'PO_DE_PEDRA';
  quantityOriginal: Prisma.Decimal;
  quantityUnit: 'M3';
  sourceDirection: string | null;
  reasonCode: 'NO_FINAL_ENTRY_MATCH' | 'UNCONFIRMED_FREIGHT_TYPE';
  reason: string;
  correlatedEntryId: bigint | null;
  correlatedEntryItemId: bigint | null;
  correlatedFreightTypeId: number | null;
  correlatedEntryQuantityOriginal: Prisma.Decimal | null;
  correlatedEntryQuantityUnit: string | null;
  active: boolean;
  sourceUpdatedAt: Date;
  raw: Prisma.InputJsonValue;
  contentHash: string;
}

function text(value: unknown, field: string, max = 300) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max) throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}

function optionalText(value: unknown, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > max) throw new BadRequestException(`Texto excede ${max} caracteres`);
  return result;
}

function integer(value: unknown, field: string) {
  const result = Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(result) || result <= 0) throw new BadRequestException(`${field} deve ser inteiro positivo`);
  return result;
}

function bigint(value: unknown, field: string, nullable = false) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  try {
    const result = BigInt(String(value).trim());
    if (result <= 0n) throw new Error();
    return result;
  } catch {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
}

function decimal(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const raw = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(raw)) throw new BadRequestException(`${field} deve ser decimal com ate 6 casas`);
  return new Prisma.Decimal(raw);
}

function positiveDecimal(value: unknown, field: string, nullable = false) {
  const result = decimal(value, field, nullable);
  if (result !== null && result.lte(0)) throw new BadRequestException(`${field} deve ser maior que zero`);
  return result;
}

function date(value: unknown, field: string) {
  const raw = text(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestException(`${field} deve ser AAAA-MM-DD`);
  const result = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== raw) throw new BadRequestException(`${field} invalida`);
  return result;
}

function dateTime(value: unknown, field: string, nullable = false) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const result = new Date(text(value, field, 60));
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${field} deve ser data/hora ISO valida`);
  return result;
}

function bool(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || String(value).toLowerCase() === 'false') return false;
  throw new BadRequestException(`${field} deve ser booleano`);
}

function civilDates(occurredAt: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(occurredAt).map((part) => [part.type, part.value]));
  const occurredDate = date(`${parts.year}-${parts.month}-${parts.day}`, 'occurredDate');
  return { occurredDate, competence: date(`${parts.year}-${parts.month}-01`, 'competence') };
}

export function normalizeUsinaMaterialExceptionEnvelope(body: unknown): NormalizedMaterialExceptionEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Envelope invalido');
  const payload = body as AnyRow;
  if (text(payload.dataset, 'dataset', 60).toUpperCase() !== USINA_MATERIAL_EXCEPTION_DATASET)
    throw new BadRequestException(`dataset deve ser ${USINA_MATERIAL_EXCEPTION_DATASET}`);
  if (text(payload.syncMode, 'syncMode', 20).toLowerCase() !== 'full')
    throw new BadRequestException('syncMode deve ser full');
  if (!payload.scope || typeof payload.scope !== 'object' || Array.isArray(payload.scope))
    throw new BadRequestException('scope e obrigatorio');
  const scope = payload.scope as AnyRow;
  const dateFrom = date(scope.dateFrom, 'scope.dateFrom');
  const dateTo = date(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo) throw new BadRequestException('scope.dateFrom nao pode ser posterior a scope.dateTo');
  const materialClass = text(scope.materialClass, 'scope.materialClass', 50).toUpperCase();
  if (materialClass !== 'PO_DE_PEDRA') throw new BadRequestException('scope.materialClass deve ser PO_DE_PEDRA');
  const sourcePartyId = integer(scope.sourcePartyId, 'scope.sourcePartyId');
  if (!Array.isArray(payload.rows) || payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT)
    throw new BadRequestException(`rows deve ter ate ${USINA_PRODUCTION_BATCH_LIMIT} linhas`);
  return {
    dataset: USINA_MATERIAL_EXCEPTION_DATASET,
    syncMode: 'full',
    syncRunId: text(payload.syncRunId, 'syncRunId', 200),
    generatedAt: dateTime(payload.generatedAt, 'generatedAt') as Date,
    scope: { dateFrom, dateTo, materialClass: 'PO_DE_PEDRA', sourcePartyId },
    batchNumber: integer(payload.batchNumber, 'batchNumber'),
    isLastBatch: bool(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function normalizeRow(raw: AnyRow, index: number, envelope: NormalizedMaterialExceptionEnvelope): NormalizedMaterialExceptionRow {
  const sourceTicketId = text(raw.sourceTicketId, 'sourceTicketId', 120);
  const aethosItemId = integer(raw.aethosItemId, 'aethosItemId');
  if (aethosItemId !== 968) throw new BadRequestException('aethosItemId deve ser 968');
  const sourceRecordId = text(raw.sourceRecordId, 'sourceRecordId', 250);
  if (sourceRecordId !== `${sourceTicketId}|${aethosItemId}`) throw new BadRequestException('sourceRecordId diverge da chave canonica');
  const occurredAt = dateTime(raw.occurredAt, 'occurredAt') as Date;
  const { occurredDate, competence } = civilDates(occurredAt);
  if (occurredDate < envelope.scope.dateFrom || occurredDate > envelope.scope.dateTo)
    throw new BadRequestException('occurredAt fora do scope');
  const sourcePartyId = integer(raw.sourcePartyId, 'sourcePartyId');
  if (sourcePartyId !== envelope.scope.sourcePartyId) throw new BadRequestException('sourcePartyId fora do scope');
  const materialClass = text(raw.materialClass, 'materialClass', 50).toUpperCase();
  if (materialClass !== envelope.scope.materialClass) throw new BadRequestException('materialClass fora do scope');
  const plate = text(raw.plate, 'plate', 30).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(plate)) throw new BadRequestException('plate deve estar normalizada sem hifen');
  const quantityUnit = text(raw.quantityUnit, 'quantityUnit', 20).toUpperCase();
  if (quantityUnit !== 'M3') throw new BadRequestException('quantityUnit deve ser M3');
  const reasonCode = text(raw.reasonCode, 'reasonCode', 60).toUpperCase();
  if (!['NO_FINAL_ENTRY_MATCH', 'UNCONFIRMED_FREIGHT_TYPE'].includes(reasonCode))
    throw new BadRequestException('reasonCode invalido');
  const correlatedEntryId = bigint(raw.correlatedEntryId, 'correlatedEntryId', true);
  const correlatedEntryItemId = bigint(raw.correlatedEntryItemId, 'correlatedEntryItemId', true);
  const correlatedFreightTypeId = raw.correlatedFreightTypeId == null ? null : integer(raw.correlatedFreightTypeId, 'correlatedFreightTypeId');
  const correlatedEntryQuantityOriginal = positiveDecimal(raw.correlatedEntryQuantityOriginal, 'correlatedEntryQuantityOriginal', true);
  const correlatedEntryQuantityUnit = optionalText(raw.correlatedEntryQuantityUnit, 20)?.toUpperCase() ?? null;
  if (reasonCode === 'NO_FINAL_ENTRY_MATCH' && [correlatedEntryId, correlatedEntryItemId, correlatedFreightTypeId, correlatedEntryQuantityOriginal, correlatedEntryQuantityUnit].some((value) => value !== null))
    throw new BadRequestException('NO_FINAL_ENTRY_MATCH nao aceita correlacao');
  if (reasonCode === 'UNCONFIRMED_FREIGHT_TYPE') {
    if ([correlatedEntryId, correlatedEntryItemId, correlatedFreightTypeId, correlatedEntryQuantityOriginal, correlatedEntryQuantityUnit].some((value) => value === null))
      throw new BadRequestException('UNCONFIRMED_FREIGHT_TYPE exige correlacao completa');
    if ([2262, 2568].includes(correlatedFreightTypeId!)) throw new BadRequestException('Frete confirmado nao deve ser excecao');
  }
  const row = {
    index, source: 'AETHOS' as const, dataset: USINA_MATERIAL_EXCEPTION_DATASET, sourceRecordId,
    sourceTicketId, sourceVehicleWeighingId: integer(raw.sourceVehicleWeighingId, 'sourceVehicleWeighingId'),
    occurredAt, occurredDate, competence, finalizedAt: dateTime(raw.finalizedAt, 'finalizedAt', true), plate,
    sourcePartyId, sourcePartyName: text(raw.sourcePartyName, 'sourcePartyName', 300), aethosItemId,
    itemDescription: text(raw.itemDescription, 'itemDescription', 500), materialClass: 'PO_DE_PEDRA' as const,
    quantityOriginal: positiveDecimal(raw.quantityOriginal, 'quantityOriginal')!, quantityUnit: 'M3' as const,
    sourceDirection: optionalText(raw.sourceDirection, 30), reasonCode: reasonCode as NormalizedMaterialExceptionRow['reasonCode'],
    reason: text(raw.reason, 'reason', 1000), correlatedEntryId, correlatedEntryItemId, correlatedFreightTypeId,
    correlatedEntryQuantityOriginal, correlatedEntryQuantityUnit,
    active: raw.active === undefined ? true : bool(raw.active, 'active'),
    sourceUpdatedAt: dateTime(raw.sourceUpdatedAt, 'sourceUpdatedAt') as Date,
  };
  const contentHash = hashCanonicalValue({
    ...row,
    occurredAt: row.occurredAt.toISOString(), occurredDate: row.occurredDate.toISOString().slice(0, 10),
    competence: row.competence.toISOString().slice(0, 10), finalizedAt: row.finalizedAt?.toISOString() ?? null,
    quantityOriginal: row.quantityOriginal.toFixed(6), correlatedEntryId: row.correlatedEntryId?.toString() ?? null,
    correlatedEntryItemId: row.correlatedEntryItemId?.toString() ?? null,
    correlatedEntryQuantityOriginal: row.correlatedEntryQuantityOriginal?.toFixed(6) ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
  });
  return { ...row, raw: raw as Prisma.InputJsonValue, contentHash };
}

export function normalizeUsinaMaterialExceptionRows(rows: unknown[], envelope: NormalizedMaterialExceptionEnvelope) {
  const accepted: NormalizedMaterialExceptionRow[] = [];
  const rejected: Array<{ index: number; key: string | null; reason: string }> = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    let key: string | null = null;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Linha deve ser objeto');
      const row = normalizeRow(value as AnyRow, index, envelope);
      key = row.sourceRecordId;
      if (seen.has(key)) throw new BadRequestException('Chave repetida no mesmo lote');
      seen.add(key);
      accepted.push(row);
    } catch (error) {
      const response = error instanceof BadRequestException ? error.getResponse() : null;
      const message = typeof response === 'string' ? response : error instanceof Error ? error.message : 'Linha invalida';
      rejected.push({ index, key, reason: message });
    }
  });
  return { accepted, rejected };
}

export const USINA_MATERIAL_EXCEPTION_CONTEXT = { companyId: USINA_COMPANY_ID, unitId: USINA_UNIT_ID };
