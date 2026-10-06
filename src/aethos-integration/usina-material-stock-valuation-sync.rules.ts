import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_MATERIAL_STOCK_VALUATION_DATASET =
  'MATERIAL_STOCK_VALUATIONS' as const;
export const USINA_STONE_POWDER_AETHOS_ITEM_ID = 968;
export const USINA_STOCK_VALUATION_AETHOS_ITEM_IDS = [
  968,
  1813,
  5525,
  5643,
  11734,
  13861,
] as const;

type AnyRow = Record<string, unknown>;

export interface NormalizedMaterialStockValuationEnvelope {
  dataset: typeof USINA_MATERIAL_STOCK_VALUATION_DATASET;
  syncMode: 'incremental' | 'full';
  syncRunId: string;
  generatedAt: Date;
  scope: {
    company: typeof USINA_COMPANY_ID;
    unit: typeof USINA_UNIT_ID;
    companyId: number;
    aethosItemIds: number[];
    dateFrom: Date;
    dateTo: Date;
  };
  batchNumber: number;
  isLastBatch: boolean;
  rows: unknown[];
}

export interface NormalizedMaterialStockValuationRow {
  index: number;
  source: 'AETHOS';
  aethosCompanyId: number;
  aethosItemId: number;
  competence: Date;
  quantityUnit: 'M3' | 'TN';
  openingQuantity: Prisma.Decimal;
  validEntryQuantity: Prisma.Decimal;
  validIssueQuantity: Prisma.Decimal;
  cancellationAdjustmentQuantity: Prisma.Decimal;
  netMovementQuantity: Prisma.Decimal;
  closingQuantity: Prisma.Decimal;
  openingAverageCost: Prisma.Decimal | null;
  closingAverageCost: Prisma.Decimal | null;
  sourceMaxMovementId: bigint | null;
  sourceUpdatedAt: Date | null;
  active: boolean;
  contentHash: string;
  raw: Prisma.InputJsonValue;
}

function text(value: unknown, field: string, max = 300) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max)
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}

function integer(value: unknown, field: string) {
  if (!/^\d+$/.test(String(value ?? '').trim()))
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  return result;
}

function bigint(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d+$/.test(String(value).trim()))
    throw new BadRequestException(`${field} deve ser bigint positivo`);
  const result = BigInt(String(value).trim());
  if (result <= 0n)
    throw new BadRequestException(`${field} deve ser bigint positivo`);
  return result;
}

function decimal(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const raw = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(raw))
    throw new BadRequestException(`${field} deve ser decimal com ate 6 casas`);
  return new Prisma.Decimal(raw);
}

function date(value: unknown, field: string) {
  const parsed = new Date(text(value, field, 50));
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException(`${field} deve ser data ISO valida`);
  return parsed;
}

function dateOnly(value: unknown, field: string) {
  const raw = text(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    throw new BadRequestException(`${field} deve ser AAAA-MM-DD`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== raw)
    throw new BadRequestException(`${field} invalida`);
  return parsed;
}

function bool(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || String(value).toLowerCase() === 'false') return false;
  throw new BadRequestException(`${field} deve ser booleano`);
}

export function normalizeUsinaMaterialStockValuationEnvelope(
  body: unknown,
): NormalizedMaterialStockValuationEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Envelope invalido');
  const payload = body as AnyRow;
  if (
    text(payload.dataset, 'dataset', 60).toUpperCase() !==
    USINA_MATERIAL_STOCK_VALUATION_DATASET
  )
    throw new BadRequestException('dataset invalido');
  const syncMode = text(payload.syncMode, 'syncMode', 20).toLowerCase();
  if (syncMode !== 'full' && syncMode !== 'incremental')
    throw new BadRequestException('syncMode invalido');
  if (!payload.scope || typeof payload.scope !== 'object' || Array.isArray(payload.scope))
    throw new BadRequestException('scope e obrigatorio');
  const scope = payload.scope as AnyRow;
  if (
    text(scope.company, 'scope.company').toUpperCase() !== USINA_COMPANY_ID ||
    text(scope.unit, 'scope.unit').toUpperCase() !== USINA_UNIT_ID
  )
    throw new BadRequestException('scope invalido');
  const companyId = integer(scope.companyId, 'scope.companyId');
  if (companyId !== 1) throw new BadRequestException('scope.companyId invalido');
  if (!Array.isArray(scope.aethosItemIds) || scope.aethosItemIds.length < 1)
    throw new BadRequestException('scope.aethosItemIds e obrigatorio');
  const aethosItemIds = scope.aethosItemIds.map((value) =>
    integer(value, 'scope.aethosItemIds'),
  );
  if (
    new Set(aethosItemIds).size !== aethosItemIds.length ||
    aethosItemIds.some(
      (itemId) =>
        !(USINA_STOCK_VALUATION_AETHOS_ITEM_IDS as readonly number[]).includes(
          itemId,
        ),
    )
  )
    throw new BadRequestException(
      'scope.aethosItemIds contem item duplicado ou nao autorizado',
    );
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo) throw new BadRequestException('scope invalido');
  const batchNumber = integer(payload.batchNumber, 'batchNumber');
  if (!Array.isArray(payload.rows) || payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT)
    throw new BadRequestException('rows deve ter ate 500 linhas');
  return {
    dataset: USINA_MATERIAL_STOCK_VALUATION_DATASET,
    syncMode,
    syncRunId: text(payload.syncRunId, 'syncRunId', 200),
    generatedAt: date(payload.generatedAt, 'generatedAt'),
    scope: {
      company: USINA_COMPANY_ID,
      unit: USINA_UNIT_ID,
      companyId,
      aethosItemIds,
      dateFrom,
      dateTo,
    },
    batchNumber,
    isLastBatch: bool(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function errorMessage(error: unknown) {
  return error instanceof BadRequestException
    ? typeof error.getResponse() === 'string'
      ? (error.getResponse() as string)
      : error.message
    : error instanceof Error
      ? error.message
      : 'Linha invalida';
}

export function normalizeUsinaMaterialStockValuationRows(
  rows: unknown[],
  envelope: NormalizedMaterialStockValuationEnvelope,
) {
  const accepted: NormalizedMaterialStockValuationRow[] = [];
  const rejected: { index: number; key: string | null; reason: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    let key: string | null = null;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('Linha deve ser objeto');
      const row = value as AnyRow;
      if (text(row.source, 'source', 20).toUpperCase() !== 'AETHOS')
        throw new BadRequestException('source deve ser AETHOS');
      const aethosCompanyId = integer(row.companyId, 'companyId');
      const aethosItemId = integer(row.aethosItemId, 'aethosItemId');
      if (
        aethosCompanyId !== envelope.scope.companyId ||
        !envelope.scope.aethosItemIds.includes(aethosItemId)
      )
        throw new BadRequestException('Empresa ou item fora do scope');
      const competence = dateOnly(row.competence, 'competence');
      if (competence.getUTCDate() !== 1)
        throw new BadRequestException('competence deve ser o primeiro dia do mes');
      if (competence < envelope.scope.dateFrom || competence > envelope.scope.dateTo)
        throw new BadRequestException('competence fora do scope');
      const quantityUnit = text(
        row.quantityUnit,
        'quantityUnit',
        20,
      ).toUpperCase();
      const expectedUnit =
        aethosItemId === USINA_STONE_POWDER_AETHOS_ITEM_ID ? 'M3' : 'TN';
      if (quantityUnit !== expectedUnit)
        throw new BadRequestException(
          `quantityUnit deve ser ${expectedUnit} para o item ${aethosItemId}`,
        );
      key = `AETHOS|${aethosCompanyId}|${aethosItemId}|${competence
        .toISOString()
        .slice(0, 10)}`;
      if (seen.has(key)) throw new BadRequestException('Chave repetida no lote');
      seen.add(key);

      const openingQuantity = decimal(row.openingQuantity, 'openingQuantity')!;
      const validEntryQuantity = decimal(row.validEntryQuantity, 'validEntryQuantity')!;
      const validIssueQuantity = decimal(row.validIssueQuantity, 'validIssueQuantity')!;
      const cancellationAdjustmentQuantity = decimal(
        row.cancellationAdjustmentQuantity,
        'cancellationAdjustmentQuantity',
      )!;
      const netMovementQuantity = decimal(row.netMovementQuantity, 'netMovementQuantity')!;
      const closingQuantity = decimal(row.closingQuantity, 'closingQuantity')!;
      const openingAverageCost = decimal(
        row.openingAverageCost,
        'openingAverageCost',
        true,
      );
      const closingAverageCost = decimal(
        row.closingAverageCost,
        'closingAverageCost',
        true,
      );
      if (
        openingQuantity.lt(0) ||
        validEntryQuantity.lt(0) ||
        validIssueQuantity.lt(0) ||
        closingQuantity.lt(0) ||
        openingAverageCost?.lt(0) ||
        closingAverageCost?.lt(0)
      )
        throw new BadRequestException('Quantidades e custos nao podem ser negativos');
      const expectedNet = validEntryQuantity
        .minus(validIssueQuantity)
        .plus(cancellationAdjustmentQuantity);
      if (!netMovementQuantity.equals(expectedNet))
        throw new BadRequestException('netMovementQuantity nao fecha a equacao mensal');
      if (!closingQuantity.equals(openingQuantity.plus(netMovementQuantity)))
        throw new BadRequestException('closingQuantity nao fecha a equacao mensal');
      const contentHash = text(row.contentHash, 'contentHash', 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(contentHash))
        throw new BadRequestException('contentHash deve ser SHA-256 hexadecimal');
      accepted.push({
        index,
        source: 'AETHOS',
        aethosCompanyId,
        aethosItemId,
        competence,
        quantityUnit: quantityUnit as 'M3' | 'TN',
        openingQuantity,
        validEntryQuantity,
        validIssueQuantity,
        cancellationAdjustmentQuantity,
        netMovementQuantity,
        closingQuantity,
        openingAverageCost,
        closingAverageCost,
        sourceMaxMovementId: bigint(row.sourceMaxMovementId, 'sourceMaxMovementId'),
        sourceUpdatedAt:
          row.sourceUpdatedAt === null || row.sourceUpdatedAt === undefined
            ? null
            : date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
        active: row.active === undefined ? true : bool(row.active, 'active'),
        contentHash,
        raw: row as Prisma.InputJsonValue,
      });
    } catch (error) {
      rejected.push({ index, key, reason: errorMessage(error) });
    }
  });
  return { accepted, rejected };
}
