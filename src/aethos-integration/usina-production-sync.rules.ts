import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export const USINA_PRODUCTION_DATASET = 'PRODUCTION';
export const USINA_COMPANY_ID = 'JR_CONSTRUCOES';
export const USINA_UNIT_ID = 'USINA_ASFALTO_ICARA';
export const USINA_PRODUCTION_BATCH_LIMIT = 500;

type AnyRow = Record<string, unknown>;

export interface NormalizedUsinaSyncEnvelope {
  dataset: typeof USINA_PRODUCTION_DATASET;
  syncMode: 'incremental' | 'full';
  syncRunId: string;
  generatedAt: Date;
  scope: {
    company: typeof USINA_COMPANY_ID;
    unit: typeof USINA_UNIT_ID;
    dateFrom: Date;
    dateTo: Date;
  };
  batchNumber: number;
  isLastBatch: boolean;
  rows: unknown[];
}

export interface NormalizedProductionRow {
  index: number;
  source: 'AETHOS';
  sourceRecordId: string;
  weighingId: string;
  aethosProductId: number;
  productDescription: string;
  classification:
    | 'USINAGEM_SEM_CAP'
    | 'CAP_BORRACHA'
    | 'CAP_POLIMERO'
    | 'CAP_50_70';
  occurredAt: Date;
  occurredDate: Date;
  competence: Date;
  quantityTon: Prisma.Decimal;
  aethosCompanyId: number;
  originFlag: string | null;
  personId: number | null;
  entryExitFlag: string | null;
  weighingVehicleStatus: 'FIN';
  weighingStatus: 'FIN';
  tareTon: Prisma.Decimal | null;
  firstWeighingAt: Date | null;
  secondWeighingAt: Date | null;
  sourceUpdatedAt: Date | null;
  active: boolean;
  raw: Prisma.InputJsonValue;
  contentHash: string;
}

export interface ProductionRowRejection {
  index: number;
  key: string | null;
  reason: string;
}

function pick(row: AnyRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function text(value: unknown, field: string, max = 300) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BadRequestException(`${field} e obrigatorio`);
  if (normalized.length > max) {
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  }
  return normalized;
}

function nullableText(value: unknown, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new BadRequestException(`Texto excede ${max} caracteres`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  return parsed;
}

function nullablePositiveInteger(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, field);
}

function decimal(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const normalized = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new BadRequestException(`${field} deve ser decimal com ate 6 casas`);
  }
  return new Prisma.Decimal(normalized);
}

function isoDate(value: unknown, field: string) {
  const normalized = text(value, field, 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new BadRequestException(`${field} invalida`);
  }
  return parsed;
}

function isoDateTime(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const normalized = String(value).trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} deve ser data/hora ISO valida`);
  }
  return parsed;
}

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function saoPauloCivilDateText(rawValue: unknown, parsed: Date) {
  const raw = String(rawValue ?? '').trim();
  const datePrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/i)?.[1];
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (datePrefix && !hasExplicitZone) return datePrefix;

  const parts = Object.fromEntries(
    SAO_PAULO_DATE_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function booleanValue(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).trim().toLowerCase() === 'true') return true;
  if (value === 0 || String(value).trim().toLowerCase() === 'false') return false;
  throw new BadRequestException(`${field} deve ser booleano`);
}

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function classifyUsinaProduction(description: string) {
  const normalized = fold(description);
  if (normalized.includes('S/CAP') || normalized.includes('RAP')) {
    return 'USINAGEM_SEM_CAP' as const;
  }
  if (normalized.includes('BORRACHA')) return 'CAP_BORRACHA' as const;
  if (normalized.includes('POLIMERO')) return 'CAP_POLIMERO' as const;
  return 'CAP_50_70' as const;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as AnyRow)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function hashCanonicalValue(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

export function normalizeUsinaProductionEnvelope(body: unknown): NormalizedUsinaSyncEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Envelope de sincronizacao invalido');
  }
  const payload = body as AnyRow;
  const dataset = text(payload.dataset, 'dataset', 50).toUpperCase();
  if (dataset !== USINA_PRODUCTION_DATASET) {
    throw new BadRequestException(`dataset deve ser ${USINA_PRODUCTION_DATASET}`);
  }
  const syncMode = text(payload.syncMode, 'syncMode', 20).toLowerCase();
  if (syncMode !== 'incremental' && syncMode !== 'full') {
    throw new BadRequestException('syncMode deve ser incremental ou full');
  }
  const scopeValue = payload.scope;
  if (!scopeValue || typeof scopeValue !== 'object' || Array.isArray(scopeValue)) {
    throw new BadRequestException('scope e obrigatorio');
  }
  const scope = scopeValue as AnyRow;
  const company = text(scope.company, 'scope.company', 100).toUpperCase();
  const unit = text(scope.unit, 'scope.unit', 100).toUpperCase();
  if (company !== USINA_COMPANY_ID || unit !== USINA_UNIT_ID) {
    throw new BadRequestException('scope deve apontar para JR_CONSTRUCOES/USINA_ASFALTO_ICARA');
  }
  const dateFrom = isoDate(scope.dateFrom, 'scope.dateFrom');
  const dateTo = isoDate(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo) {
    throw new BadRequestException('scope.dateFrom nao pode ser posterior a scope.dateTo');
  }
  const batchNumber = positiveInteger(payload.batchNumber, 'batchNumber');
  const rows = payload.rows;
  if (!Array.isArray(rows) || rows.length > USINA_PRODUCTION_BATCH_LIMIT) {
    throw new BadRequestException(`rows deve ser uma lista de ate ${USINA_PRODUCTION_BATCH_LIMIT} linhas`);
  }
  return {
    dataset: USINA_PRODUCTION_DATASET,
    syncMode,
    syncRunId: text(payload.syncRunId, 'syncRunId', 200),
    generatedAt: isoDateTime(payload.generatedAt, 'generatedAt') as Date,
    scope: { company: USINA_COMPANY_ID, unit: USINA_UNIT_ID, dateFrom, dateTo },
    batchNumber,
    isLastBatch: booleanValue(payload.isLastBatch, 'isLastBatch'),
    rows,
  };
}

function rowErrorMessage(error: unknown) {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join('; ') : message || error.message;
  }
  return error instanceof Error ? error.message : 'Linha invalida';
}

function normalizeProductionRow(value: unknown, index: number): NormalizedProductionRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Linha deve ser um objeto');
  }
  const row = value as AnyRow;
  const weighingId = text(pick(row, ['idPesagem', 'ID_PESAGEM', 'weighingId']), 'ID_PESAGEM', 100);
  const aethosProductId = positiveInteger(
    pick(row, ['idItem', 'ID_ITEM', 'aethosProductId']),
    'ID_ITEM',
  );
  const source = (nullableText(row.source, 30) || 'AETHOS').toUpperCase();
  if (source !== 'AETHOS') throw new BadRequestException('source deve ser AETHOS');
  const sourceRecordId = nullableText(row.sourceRecordId, 220) || `${weighingId}|${aethosProductId}`;
  const productDescription = text(
    pick(row, ['description', 'productDescription', 'DS_ITEM']),
    'DS_ITEM',
    500,
  );
  const occurredAtRaw = pick(row, ['occurredAt', 'DT_PRI_PESAGEM']);
  const occurredAt = isoDateTime(occurredAtRaw, 'DT_PRI_PESAGEM') as Date;
  const occurredDateText = saoPauloCivilDateText(occurredAtRaw, occurredAt);
  const occurredDate = isoDate(occurredDateText, 'data civil de DT_PRI_PESAGEM');
  const competence = isoDate(
    `${occurredDateText.slice(0, 7)}-01`,
    'competencia derivada de DT_PRI_PESAGEM',
  );
  const quantityTon = decimal(pick(row, ['quantityTon', 'VL_PESO']), 'VL_PESO') as Prisma.Decimal;
  if (quantityTon.lte(0)) throw new BadRequestException('VL_PESO deve ser maior que zero');
  const aethosCompanyId = positiveInteger(
    pick(row, ['aethosCompanyId', 'ID_EMPRESA']),
    'ID_EMPRESA',
  );
  const originFlag = nullableText(pick(row, ['originFlag', 'FL_ORIGEM']), 30);
  const personId = nullablePositiveInteger(pick(row, ['personId', 'ID_PESSOA']), 'ID_PESSOA');
  const entryExitFlag = nullableText(pick(row, ['entryExitFlag', 'FL_ENTRADA_SAIDA']), 30);
  const weighingVehicleStatus = text(
    pick(row, [
      'weighingVehicleStatus',
      'PESAGEM_VEICULO_FL_SITUACAO',
      'PV_FL_SITUACAO',
    ]),
    'PESAGEM_VEICULO.FL_SITUACAO',
    30,
  ).toUpperCase();
  const weighingStatus = text(
    pick(row, ['weighingStatus', 'PESAGEM_FL_SITUACAO', 'P_FL_SITUACAO']),
    'PESAGEM.FL_SITUACAO',
    30,
  ).toUpperCase();
  const tareTon = decimal(pick(row, ['tareTon', 'VL_TARA']), 'VL_TARA', true);
  const firstWeighingAt = isoDateTime(
    pick(row, ['firstWeighingAt', 'DT_PRI_PESAGEM']),
    'DT_PRI_PESAGEM',
    true,
  );
  const secondWeighingAt = isoDateTime(
    pick(row, ['secondWeighingAt', 'DT_SEG_PESAGEM']),
    'DT_SEG_PESAGEM',
    true,
  );
  const sourceUpdatedAt = isoDateTime(
    pick(row, ['sourceUpdatedAt', 'DT_ATUALIZACAO']),
    'sourceUpdatedAt',
    true,
  );
  const active = row.active === undefined ? true : booleanValue(row.active, 'active');
  const foldedDescription = fold(productDescription);
  if (!foldedDescription.includes('ASFALTO') || foldedDescription.includes('REJEIT')) {
    throw new BadRequestException('Item nao atende ao filtro de producao de asfalto');
  }
  if (fold(weighingVehicleStatus) !== 'FIN') {
    throw new BadRequestException('PESAGEM_VEICULO.FL_SITUACAO deve ser FIN');
  }
  if (fold(weighingStatus) !== 'FIN') {
    throw new BadRequestException('PESAGEM.FL_SITUACAO deve ser FIN');
  }
  if (tareTon !== null && tareTon.gt(0)) {
    throw new BadRequestException('VL_TARA deve ser nulo ou menor/igual a zero');
  }
  if (aethosCompanyId === 4) throw new BadRequestException('ID_EMPRESA 4 nao pertence ao escopo');
  if (fold(originFlag || '') === 'TER') throw new BadRequestException('FL_ORIGEM TER nao pertence ao escopo');
  if (personId === 443) throw new BadRequestException('ID_PESSOA 443 nao pertence ao escopo');
  const classification = classifyUsinaProduction(productDescription);
  const contentHash = hashCanonicalValue({
    weighingId,
    aethosProductId,
    productDescription,
    classification,
    occurredAt: occurredAt.toISOString(),
    competence: competence.toISOString().slice(0, 10),
    quantityTon: quantityTon.toFixed(6),
    aethosCompanyId,
    originFlag,
    personId,
    entryExitFlag,
    weighingVehicleStatus,
    weighingStatus,
    tareTon: tareTon?.toFixed(6) ?? null,
    firstWeighingAt: firstWeighingAt?.toISOString() ?? null,
    secondWeighingAt: secondWeighingAt?.toISOString() ?? null,
    sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
    active,
  });
  return {
    index,
    source: 'AETHOS',
    sourceRecordId,
    weighingId,
    aethosProductId,
    productDescription,
    classification,
    occurredAt,
    occurredDate,
    competence,
    quantityTon,
    aethosCompanyId,
    originFlag,
    personId,
    entryExitFlag,
    weighingVehicleStatus: 'FIN',
    weighingStatus: 'FIN',
    tareTon,
    firstWeighingAt,
    secondWeighingAt,
    sourceUpdatedAt,
    active,
    raw: row as Prisma.InputJsonValue,
    contentHash,
  };
}

export function normalizeUsinaProductionRows(rows: unknown[], scope: NormalizedUsinaSyncEnvelope['scope']) {
  const accepted: NormalizedProductionRow[] = [];
  const rejected: ProductionRowRejection[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    let key: string | null = null;
    try {
      const normalized = normalizeProductionRow(row, index);
      key = normalized.sourceRecordId;
      if (seen.has(key)) throw new BadRequestException('Chave repetida no mesmo lote');
      seen.add(key);
      if (normalized.occurredDate < scope.dateFrom || normalized.occurredDate > scope.dateTo) {
        throw new BadRequestException('Data da linha esta fora do scope informado');
      }
      accepted.push(normalized);
    } catch (error) {
      rejected.push({ index, key, reason: rowErrorMessage(error) });
    }
  });
  return { accepted, rejected };
}
