import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_MATERIAL_DATASETS = [
  'CAP_MOVEMENTS',
  'AGGREGATE_RECEIPTS',
  'CAP_PURCHASE_ORDERS',
] as const;
export type UsinaMaterialDataset = (typeof USINA_MATERIAL_DATASETS)[number];
export type UsinaMaterialClass =
  | 'CAP_50_70'
  | 'CAP_BORRACHA'
  | 'CAP_POLIMERO'
  | 'CAP_ALTO_MODULO'
  | 'BRITADO';
export type UsinaMaterialMovement = 'ENTRY' | 'DIRECT_EXIT';
export type UsinaMaterialReportingFamily =
  | 'CAP_50_70'
  | 'CAP_BORRACHA'
  | 'CAP_POLIMERO'
  | 'CAP_ALTO_MODULO';

type AnyRow = Record<string, unknown>;

export interface NormalizedMaterialEnvelope {
  dataset: UsinaMaterialDataset;
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

export interface NormalizedMaterialRow {
  index: number;
  source: 'AETHOS';
  dataset: UsinaMaterialDataset;
  sourceRecordId: string;
  sourceDocumentId: string;
  sourceLineId: string | null;
  sourceFreightTypeId: number | null;
  aethosMaterialId: number;
  materialDescription: string;
  materialClass: UsinaMaterialClass;
  reportingFamily: UsinaMaterialReportingFamily | null;
  movementType: UsinaMaterialMovement;
  occurredAt: Date;
  occurredDate: Date;
  competence: Date;
  quantityOriginal: Prisma.Decimal;
  quantityUnit: string;
  quantityTon: Prisma.Decimal | null;
  materialUnitCost: Prisma.Decimal | null;
  materialAmount: Prisma.Decimal | null;
  freightQuantity: Prisma.Decimal | null;
  freightUnitCost: Prisma.Decimal | null;
  freightAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal | null;
  sourceUsedQuantity: Prisma.Decimal | null;
  sourceBalanceQuantity: Prisma.Decimal | null;
  sourceDiscountAmount: Prisma.Decimal | null;
  aethosCompanyId: number | null;
  supplierId: number | null;
  documentPartyId: number | null;
  physicalSourcePartyId: number | null;
  sourceTicketId: string | null;
  entryExitFlag: string | null;
  sourceStatus: string;
  tareTon: Prisma.Decimal | null;
  sourceUpdatedAt: Date | null;
  active: boolean;
  raw: Prisma.InputJsonValue;
  contentHash: string;
}

export interface MaterialRowRejection {
  index: number;
  key: string | null;
  reason: string;
}

function pick(row: AnyRow, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function requiredText(value: unknown, field: string, max = 300) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BadRequestException(`${field} e obrigatorio`);
  if (normalized.length > max)
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  return normalized;
}

function optionalText(value: unknown, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max)
    throw new BadRequestException(`Texto excede ${max} caracteres`);
  return normalized;
}

function integer(value: unknown, field: string, nullable = false) {
  if ((value === null || value === undefined || value === '') && nullable)
    return null;
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized))
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  return parsed;
}

function decimal(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const normalized = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(normalized))
    throw new BadRequestException(`${field} deve ser decimal com ate 6 casas`);
  return new Prisma.Decimal(normalized);
}

function positiveDecimal(value: unknown, field: string) {
  const parsed = decimal(value, field) as Prisma.Decimal;
  if (parsed.lte(0))
    throw new BadRequestException(`${field} deve ser maior que zero`);
  return parsed;
}

function nonNegativeDecimal(value: unknown, field: string, nullable = false) {
  const parsed = decimal(value, field, nullable);
  if (parsed !== null && parsed.lt(0))
    throw new BadRequestException(`${field} nao pode ser negativo`);
  return parsed;
}

function isoDate(value: unknown, field: string) {
  const normalized = requiredText(value, field, 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized))
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized)
    throw new BadRequestException(`${field} invalida`);
  return parsed;
}

function isoDateTime(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException(`${field} deve ser data/hora ISO valida`);
  return parsed;
}

const SAO_PAULO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateFields(rawValue: unknown, field: string) {
  const occurredAt = isoDateTime(rawValue, field) as Date;
  const raw = String(rawValue ?? '').trim();
  const prefix = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  let dateText = prefix;
  if (!dateText || hasZone) {
    const parts = Object.fromEntries(
      SAO_PAULO.formatToParts(occurredAt).map((part) => [part.type, part.value]),
    );
    dateText = `${parts.year}-${parts.month}-${parts.day}`;
  }
  return {
    occurredAt,
    occurredDate: isoDate(dateText, `data civil de ${field}`),
    competence: isoDate(`${dateText.slice(0, 7)}-01`, `competencia de ${field}`),
  };
}

function booleanValue(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).trim().toLowerCase() === 'true') return true;
  if (value === 0 || String(value).trim().toLowerCase() === 'false') return false;
  throw new BadRequestException(`${field} deve ser booleano`);
}

function materialClass(id: number): UsinaMaterialClass {
  if ([968, 111, 1465].includes(id)) return 'BRITADO';
  if (id === 1813) return 'CAP_50_70';
  if (id === 5525) return 'CAP_BORRACHA';
  if ([5643, 11734].includes(id)) return 'CAP_POLIMERO';
  if (id === 13861) return 'CAP_ALTO_MODULO';
  throw new BadRequestException('ID_ITEM nao pertence aos materiais da Usina autorizados');
}

function reportingFamily(
  materialClassValue: UsinaMaterialClass,
): UsinaMaterialReportingFamily | null {
  if (materialClassValue === 'BRITADO') return null;
  return materialClassValue;
}

export function normalizeUsinaMaterialEnvelope(body: unknown): NormalizedMaterialEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Envelope de sincronizacao invalido');
  const payload = body as AnyRow;
  const dataset = requiredText(payload.dataset, 'dataset', 50).toUpperCase();
  if (!(USINA_MATERIAL_DATASETS as readonly string[]).includes(dataset))
    throw new BadRequestException(
      'dataset deve ser CAP_MOVEMENTS, AGGREGATE_RECEIPTS ou CAP_PURCHASE_ORDERS',
    );
  const syncMode = requiredText(payload.syncMode, 'syncMode', 20).toLowerCase();
  if (syncMode !== 'incremental' && syncMode !== 'full')
    throw new BadRequestException('syncMode deve ser incremental ou full');
  if (!payload.scope || typeof payload.scope !== 'object' || Array.isArray(payload.scope))
    throw new BadRequestException('scope e obrigatorio');
  const scope = payload.scope as AnyRow;
  const company = requiredText(scope.company, 'scope.company', 100).toUpperCase();
  const unit = requiredText(scope.unit, 'scope.unit', 100).toUpperCase();
  if (company !== USINA_COMPANY_ID || unit !== USINA_UNIT_ID)
    throw new BadRequestException('scope deve apontar para JR_CONSTRUCOES/USINA_ASFALTO_ICARA');
  const dateFrom = isoDate(scope.dateFrom, 'scope.dateFrom');
  const dateTo = isoDate(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo)
    throw new BadRequestException('scope.dateFrom nao pode ser posterior a scope.dateTo');
  const batchNumber = integer(payload.batchNumber, 'batchNumber') as number;
  if (!Array.isArray(payload.rows) || payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT)
    throw new BadRequestException(`rows deve ser uma lista de ate ${USINA_PRODUCTION_BATCH_LIMIT} linhas`);
  return {
    dataset: dataset as UsinaMaterialDataset,
    syncMode,
    syncRunId: requiredText(payload.syncRunId, 'syncRunId', 200),
    generatedAt: isoDateTime(payload.generatedAt, 'generatedAt') as Date,
    scope: { company: USINA_COMPANY_ID, unit: USINA_UNIT_ID, dateFrom, dateTo },
    batchNumber,
    isLastBatch: booleanValue(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function common(row: AnyRow) {
  const source = (optionalText(row.source, 30) || 'AETHOS').toUpperCase();
  if (source !== 'AETHOS') throw new BadRequestException('source deve ser AETHOS');
  const aethosMaterialId = integer(pick(row, ['ID_ITEM', 'aethosMaterialId']), 'ID_ITEM') as number;
  const classifiedMaterial = materialClass(aethosMaterialId);
  const expectedReportingFamily = reportingFamily(classifiedMaterial);
  const providedReportingFamily =
    optionalText(row.reportingFamily, 50)?.toUpperCase() ?? null;
  if (
    providedReportingFamily !== null &&
    providedReportingFamily !== expectedReportingFamily
  )
    throw new BadRequestException(
      `reportingFamily deve ser ${expectedReportingFamily ?? 'nulo'} para o item ${aethosMaterialId}`,
    );
  return {
    source: 'AETHOS' as const,
    aethosMaterialId,
    materialDescription: requiredText(pick(row, ['DS_ITEM', 'materialDescription']), 'DS_ITEM', 500),
    materialClass: classifiedMaterial,
    reportingFamily: expectedReportingFamily,
    active: row.active === undefined ? true : booleanValue(row.active, 'active'),
    sourceUpdatedAt: isoDateTime(pick(row, ['sourceUpdatedAt', 'DT_ATUALIZACAO']), 'sourceUpdatedAt', true),
  };
}

function normalizeCap(row: AnyRow, index: number): NormalizedMaterialRow {
  const base = common(row);
  if (base.materialClass === 'BRITADO')
    throw new BadRequestException('CAP_MOVEMENTS aceita somente itens de CAP');
  const weighingId = requiredText(pick(row, ['ID_PESAGEM', 'sourceDocumentId']), 'ID_PESAGEM', 120);
  const weighingVehicleId = requiredText(
    pick(row, ['ID_PESAGEM_VEICULO', 'sourceLineId']),
    'ID_PESAGEM_VEICULO',
    120,
  );
  const dates = dateFields(pick(row, ['DT_PRI_PESAGEM', 'occurredAt']), 'DT_PRI_PESAGEM');
  const quantityTon = positiveDecimal(pick(row, ['VL_PESO', 'quantityTon']), 'VL_PESO');
  const entryExitFlag = requiredText(pick(row, ['FL_ENTRADA_SAIDA', 'entryExitFlag']), 'FL_ENTRADA_SAIDA', 30).toUpperCase();
  const originFlag = requiredText(
    pick(row, ['FL_ORIGEM', 'originFlag']),
    'PESAGEM.FL_ORIGEM',
    30,
  ).toUpperCase();
  if (originFlag !== 'PRO')
    throw new BadRequestException('PESAGEM.FL_ORIGEM deve ser PRO');
  const vehicleStatus = requiredText(pick(row, ['PV_FL_SITUACAO', 'PESAGEM_VEICULO_FL_SITUACAO']), 'PESAGEM_VEICULO.FL_SITUACAO', 30).toUpperCase();
  const weighingStatus = requiredText(pick(row, ['P_FL_SITUACAO', 'PESAGEM_FL_SITUACAO']), 'PESAGEM.FL_SITUACAO', 30).toUpperCase();
  if (vehicleStatus !== 'FIN' || weighingStatus !== 'FIN')
    throw new BadRequestException('As situacoes da pesagem de CAP devem ser FIN');
  const tareTon = decimal(pick(row, ['VL_TARA', 'tareTon']), 'VL_TARA', true);
  if (tareTon !== null && tareTon.gt(0))
    throw new BadRequestException('VL_TARA deve ser nulo ou menor/igual a zero');
  const materialUnitCost = decimal(pick(row, ['VL_CUSTOITEM', 'materialUnitCost']), 'VL_CUSTOITEM', true);
  return finish(index, row, {
    ...base,
    dataset: 'CAP_MOVEMENTS',
    sourceRecordId: `${weighingId}|${base.aethosMaterialId}`,
    sourceDocumentId: weighingId,
    sourceLineId: weighingVehicleId,
    sourceFreightTypeId: null,
    movementType: 'ENTRY',
    ...dates,
    quantityOriginal: quantityTon,
    quantityUnit: 'T',
    quantityTon,
    materialUnitCost,
    materialAmount: materialUnitCost ? quantityTon.mul(materialUnitCost) : null,
    freightQuantity: null,
    freightUnitCost: null,
    freightAmount: null,
    totalAmount: decimal(pick(row, ['VL_TOTAL', 'totalAmount']), 'VL_TOTAL', true),
    sourceUsedQuantity: null,
    sourceBalanceQuantity: null,
    sourceDiscountAmount: null,
    aethosCompanyId: integer(pick(row, ['ID_EMPRESA', 'aethosCompanyId']), 'ID_EMPRESA', true),
    supplierId: integer(pick(row, ['ID_FORNECEDOR', 'supplierId']), 'ID_FORNECEDOR', true),
    documentPartyId: null,
    physicalSourcePartyId: null,
    sourceTicketId: null,
    entryExitFlag,
    sourceStatus: 'FIN',
    tareTon,
  });
}

function normalizeAggregate(row: AnyRow, index: number): NormalizedMaterialRow {
  const base = common(row);
  if (base.materialClass !== 'BRITADO')
    throw new BadRequestException('AGGREGATE_RECEIPTS aceita somente itens 111, 968 e 1465');
  const entryId = requiredText(pick(row, ['ID_ENTRADA', 'sourceDocumentId']), 'ID_ENTRADA', 120);
  const lineId = requiredText(pick(row, ['ID_ENTRADAITEM', 'sourceLineId']), 'ID_ENTRADAITEM', 120);
  const freightTypeId = integer(pick(row, ['ID_TIPOFRETE', 'sourceFreightTypeId']), 'ID_TIPOFRETE') as number;
  if (![2062, 2262, 2364, 2568, 2677].includes(freightTypeId))
    throw new BadRequestException(
      'ID_TIPOFRETE deve ser 2062, 2262, 2364, 2568 ou 2677',
    );
  const correlatedFreight = [2062, 2364, 2677].includes(freightTypeId);
  if (correlatedFreight && base.aethosMaterialId !== 968)
    throw new BadRequestException(
      'Fretes 2062, 2364 e 2677 sao autorizados somente para o item 968',
    );
  const documentPartyId = integer(
    pick(row, ['documentPartyId', 'ID_PESSOA_DOCUMENTO']),
    'documentPartyId',
    !correlatedFreight,
  );
  const physicalSourcePartyId = integer(
    pick(row, ['physicalSourcePartyId', 'ID_PESSOA_ORIGEM_FISICA']),
    'physicalSourcePartyId',
    !correlatedFreight,
  );
  const sourceTicketId = correlatedFreight
    ? requiredText(
        pick(row, ['sourceTicketId', 'ID_TICKET_ORIGEM']),
        'sourceTicketId',
        120,
      )
    : optionalText(
        pick(row, ['sourceTicketId', 'ID_TICKET_ORIGEM']),
        120,
      );
  if (correlatedFreight && physicalSourcePartyId !== 3092)
    throw new BadRequestException(
      'physicalSourcePartyId deve ser 3092 nos fretes correlacionados',
    );
  const sourceStatus = requiredText(pick(row, ['FL_STATUS', 'sourceStatus']), 'FL_STATUS', 30).toUpperCase();
  if (sourceStatus !== 'F')
    throw new BadRequestException('ENTRADASIMPLES.FL_STATUS deve ser F');
  const dates = dateFields(pick(row, ['DT_EMISSAO', 'occurredAt']), 'DT_EMISSAO');
  const quantityOriginal = positiveDecimal(pick(row, ['QT_ITEM', 'quantityOriginal']), 'QT_ITEM');
  const quantityUnit = (optionalText(pick(row, ['SG_UNIDADEMEDIDA', 'quantityUnit']), 30) || 'TN').toUpperCase();
  const quantityTon = ['TN', 'T', 'TON', 'TONELADA', 'TONELADAS'].includes(quantityUnit) ? quantityOriginal : null;
  const materialUnitCost = decimal(pick(row, ['VL_CUSTOITEM', 'materialUnitCost']), 'VL_CUSTOITEM', true);
  const freightQuantity = decimal(pick(row, ['QT_QUANTIDADE', 'freightQuantity']), 'QT_QUANTIDADE', true);
  const freightUnitCost = decimal(pick(row, ['VL_FRETE_UNITARIO', 'freightUnitCost']), 'VL_FRETE_UNITARIO', true);
  const freightAmount = decimal(pick(row, ['VL_FRETE', 'freightAmount']), 'VL_FRETE', true);
  const materialAmount = materialUnitCost ? quantityOriginal.mul(materialUnitCost) : null;
  return finish(index, row, {
    ...base,
    dataset: 'AGGREGATE_RECEIPTS',
    sourceRecordId: `${entryId}|${lineId}|${freightTypeId}`,
    sourceDocumentId: entryId,
    sourceLineId: lineId,
    sourceFreightTypeId: freightTypeId,
    movementType: 'ENTRY',
    ...dates,
    quantityOriginal,
    quantityUnit,
    quantityTon,
    materialUnitCost,
    materialAmount,
    freightQuantity,
    freightUnitCost,
    freightAmount,
    totalAmount: materialAmount !== null && freightAmount !== null ? materialAmount.add(freightAmount) : null,
    sourceUsedQuantity: null,
    sourceBalanceQuantity: null,
    sourceDiscountAmount: null,
    aethosCompanyId: integer(pick(row, ['ID_EMPRESA', 'aethosCompanyId']), 'ID_EMPRESA', true),
    supplierId: integer(pick(row, ['ID_FORNECEDOR', 'supplierId']), 'ID_FORNECEDOR', true),
    documentPartyId,
    physicalSourcePartyId,
    sourceTicketId,
    entryExitFlag: 'E',
    sourceStatus,
    tareTon: null,
  });
}

function normalizeCapPurchase(
  row: AnyRow,
  index: number,
): NormalizedMaterialRow {
  const base = common(row);
  if (base.materialClass === 'BRITADO')
    throw new BadRequestException(
      'CAP_PURCHASE_ORDERS aceita somente itens de CAP',
    );
  const orderId = requiredText(
    pick(row, ['ID_ORDEMCOMPRA', 'sourceDocumentId']),
    'ID_ORDEMCOMPRA',
    120,
  );
  const orderItemId = requiredText(
    pick(row, ['ID_ORDEMCOMPRAITEM', 'sourceLineId']),
    'ID_ORDEMCOMPRAITEM',
    120,
  );
  const sourceStatus = requiredText(
    pick(row, ['FL_STATUS', 'sourceStatus']),
    'FL_STATUS',
    30,
  ).toUpperCase();
  if (sourceStatus !== 'F')
    throw new BadRequestException('ORDEMCOMPRA.FL_STATUS deve ser F');
  const dates = dateFields(
    pick(row, ['DT_EMISSAO', 'occurredAt']),
    'DT_EMISSAO',
  );
  const quantityUnit = requiredText(
    pick(row, ['SG_UNIDADEMEDIDA', 'quantityUnit']),
    'SG_UNIDADEMEDIDA',
    30,
  ).toUpperCase();
  if (quantityUnit !== 'TN')
    throw new BadRequestException('SG_UNIDADEMEDIDA deve ser TN');
  const quantity = positiveDecimal(
    pick(row, ['QT_QUANTIDADE', 'quantityOriginal']),
    'QT_QUANTIDADE',
  );
  const unitPrice = positiveDecimal(
    pick(row, ['VL_PRECOUNITARIO', 'materialUnitCost']),
    'VL_PRECOUNITARIO',
  );
  const materialAmount = quantity.mul(unitPrice).toDecimalPlaces(2);
  const freightAmount = nonNegativeDecimal(
    pick(row, ['VL_FRETE', 'freightAmount']),
    'VL_FRETE',
    true,
  );
  return finish(index, row, {
    ...base,
    dataset: 'CAP_PURCHASE_ORDERS',
    sourceRecordId: `${orderId}|${orderItemId}`,
    sourceDocumentId: orderId,
    sourceLineId: orderItemId,
    sourceFreightTypeId: null,
    movementType: 'ENTRY',
    ...dates,
    quantityOriginal: quantity,
    quantityUnit: 'TN',
    quantityTon: quantity,
    materialUnitCost: unitPrice,
    materialAmount,
    freightQuantity: null,
    freightUnitCost: null,
    freightAmount,
    totalAmount: materialAmount,
    sourceUsedQuantity: nonNegativeDecimal(
      pick(row, ['QT_USADA', 'sourceUsedQuantity']),
      'QT_USADA',
      true,
    ),
    sourceBalanceQuantity: nonNegativeDecimal(
      pick(row, ['QT_SALDO', 'sourceBalanceQuantity']),
      'QT_SALDO',
      true,
    ),
    sourceDiscountAmount: nonNegativeDecimal(
      pick(row, ['VL_DESCONTO', 'sourceDiscountAmount']),
      'VL_DESCONTO',
      true,
    ),
    aethosCompanyId: integer(
      pick(row, ['ID_EMPRESA', 'aethosCompanyId']),
      'ID_EMPRESA',
      true,
    ),
    supplierId: integer(
      pick(row, ['ID_FORNECEDOR', 'supplierId']),
      'ID_FORNECEDOR',
      true,
    ),
    documentPartyId: null,
    physicalSourcePartyId: null,
    sourceTicketId: null,
    entryExitFlag: 'E',
    sourceStatus,
    tareTon: null,
  });
}

function finish(
  index: number,
  raw: AnyRow,
  row: Omit<NormalizedMaterialRow, 'index' | 'raw' | 'contentHash'>,
): NormalizedMaterialRow {
  const contentHash = hashCanonicalValue({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    occurredDate: row.occurredDate.toISOString().slice(0, 10),
    competence: row.competence.toISOString().slice(0, 10),
    quantityOriginal: row.quantityOriginal.toFixed(6),
    quantityTon: row.quantityTon?.toFixed(6) ?? null,
    materialUnitCost: row.materialUnitCost?.toFixed(6) ?? null,
    materialAmount: row.materialAmount?.toFixed(6) ?? null,
    freightQuantity: row.freightQuantity?.toFixed(6) ?? null,
    freightUnitCost: row.freightUnitCost?.toFixed(6) ?? null,
    freightAmount: row.freightAmount?.toFixed(6) ?? null,
    totalAmount: row.totalAmount?.toFixed(6) ?? null,
    sourceUsedQuantity: row.sourceUsedQuantity?.toFixed(6) ?? null,
    sourceBalanceQuantity: row.sourceBalanceQuantity?.toFixed(6) ?? null,
    sourceDiscountAmount: row.sourceDiscountAmount?.toFixed(6) ?? null,
    tareTon: row.tareTon?.toFixed(6) ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
  });
  return { ...row, index, raw: raw as Prisma.InputJsonValue, contentHash };
}

function errorMessage(error: unknown) {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join('; ') : message || error.message;
  }
  return error instanceof Error ? error.message : 'Linha invalida';
}

export function normalizeUsinaMaterialRows(rows: unknown[], envelope: NormalizedMaterialEnvelope) {
  const accepted: NormalizedMaterialRow[] = [];
  const rejected: MaterialRowRejection[] = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    let key: string | null = null;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('Linha deve ser um objeto');
      const row = value as AnyRow;
      const normalized =
        envelope.dataset === 'CAP_MOVEMENTS'
          ? normalizeCap(row, index)
          : envelope.dataset === 'AGGREGATE_RECEIPTS'
            ? normalizeAggregate(row, index)
            : normalizeCapPurchase(row, index);
      key = normalized.sourceRecordId;
      if (seen.has(key)) throw new BadRequestException('Chave repetida no mesmo lote');
      seen.add(key);
      if (normalized.occurredDate < envelope.scope.dateFrom || normalized.occurredDate > envelope.scope.dateTo)
        throw new BadRequestException('Data da linha esta fora do scope informado');
      accepted.push(normalized);
    } catch (error) {
      rejected.push({ index, key, reason: errorMessage(error) });
    }
  });
  return { accepted, rejected };
}
