import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classifyUsinaProduction,
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_REVENUE_DATASETS = [
  'INTERNAL_REVENUE',
  'EXTERNAL_REVENUE',
] as const;
export type UsinaRevenueDataset = (typeof USINA_REVENUE_DATASETS)[number];
export type UsinaRevenueType = 'INTERNAL' | 'EXTERNAL';

type AnyRow = Record<string, unknown>;

export interface NormalizedRevenueEnvelope {
  dataset: UsinaRevenueDataset;
  revenueType: UsinaRevenueType;
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

export interface NormalizedRevenueRow {
  index: number;
  source: 'AETHOS';
  revenueType: UsinaRevenueType;
  sourceRecordId: string;
  sourceOrderId: string | null;
  sourceDocumentId: string;
  sourceItemId: string;
  sourceLineId: string | null;
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
  quantityOriginal: Prisma.Decimal;
  quantityUnit: string;
  quantityTon: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  freightAmount: Prisma.Decimal | null;
  orderFreightAmount: Prisma.Decimal | null;
  historicalUnitCost: Prisma.Decimal | null;
  aethosCompanyId: number | null;
  originFlag: string | null;
  personId: number | null;
  entryExitFlag: string | null;
  weighingVehicleStatus: 'FIN' | null;
  weighingStatus: 'FIN' | null;
  tareTon: Prisma.Decimal | null;
  sourceUpdatedAt: Date | null;
  active: boolean;
  raw: Prisma.InputJsonValue;
  contentHash: string;
}

export interface RevenueRowRejection {
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
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  return parsed;
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
  const normalized = requiredText(value, field, 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException(`${field} invalida`);
  }
  return parsed;
}

function isoDateTime(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const parsed = new Date(String(value).trim());
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

function civilDateText(rawValue: unknown, parsed: Date) {
  const raw = String(rawValue ?? '').trim();
  const prefix = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (prefix && !hasZone) return prefix;
  const parts = Object.fromEntries(
    SAO_PAULO_DATE_FORMATTER.formatToParts(parsed).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateFields(raw: unknown, field: string) {
  const occurredAt = isoDateTime(raw, field) as Date;
  const dateText = civilDateText(raw, occurredAt);
  return {
    occurredAt,
    occurredDate: isoDate(dateText, `data civil de ${field}`),
    competence: isoDate(
      `${dateText.slice(0, 7)}-01`,
      `competencia derivada de ${field}`,
    ),
  };
}

function booleanValue(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).trim().toLowerCase() === 'true') return true;
  if (value === 0 || String(value).trim().toLowerCase() === 'false')
    return false;
  throw new BadRequestException(`${field} deve ser booleano`);
}

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function normalizeUsinaRevenueEnvelope(
  body: unknown,
): NormalizedRevenueEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Envelope de sincronizacao invalido');
  }
  const payload = body as AnyRow;
  const dataset = requiredText(payload.dataset, 'dataset', 50).toUpperCase();
  if (!(USINA_REVENUE_DATASETS as readonly string[]).includes(dataset)) {
    throw new BadRequestException(
      'dataset deve ser INTERNAL_REVENUE ou EXTERNAL_REVENUE',
    );
  }
  const syncMode = requiredText(payload.syncMode, 'syncMode', 20).toLowerCase();
  if (syncMode !== 'incremental' && syncMode !== 'full') {
    throw new BadRequestException('syncMode deve ser incremental ou full');
  }
  if (
    !payload.scope ||
    typeof payload.scope !== 'object' ||
    Array.isArray(payload.scope)
  ) {
    throw new BadRequestException('scope e obrigatorio');
  }
  const scope = payload.scope as AnyRow;
  const company = requiredText(
    scope.company,
    'scope.company',
    100,
  ).toUpperCase();
  const unit = requiredText(scope.unit, 'scope.unit', 100).toUpperCase();
  if (company !== USINA_COMPANY_ID || unit !== USINA_UNIT_ID) {
    throw new BadRequestException(
      'scope deve apontar para JR_CONSTRUCOES/USINA_ASFALTO_ICARA',
    );
  }
  const dateFrom = isoDate(scope.dateFrom, 'scope.dateFrom');
  const dateTo = isoDate(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo)
    throw new BadRequestException(
      'scope.dateFrom nao pode ser posterior a scope.dateTo',
    );
  const batchNumber = integer(payload.batchNumber, 'batchNumber') as number;
  if (
    !Array.isArray(payload.rows) ||
    payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT
  ) {
    throw new BadRequestException(
      `rows deve ser uma lista de ate ${USINA_PRODUCTION_BATCH_LIMIT} linhas`,
    );
  }
  return {
    dataset: dataset as UsinaRevenueDataset,
    revenueType: dataset === 'INTERNAL_REVENUE' ? 'INTERNAL' : 'EXTERNAL',
    syncMode,
    syncRunId: requiredText(payload.syncRunId, 'syncRunId', 200),
    generatedAt: isoDateTime(payload.generatedAt, 'generatedAt') as Date,
    scope: { company: USINA_COMPANY_ID, unit: USINA_UNIT_ID, dateFrom, dateTo },
    batchNumber,
    isLastBatch: booleanValue(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function common(row: AnyRow, revenueType: UsinaRevenueType) {
  const source = (optionalText(row.source, 30) || 'AETHOS').toUpperCase();
  if (source !== 'AETHOS')
    throw new BadRequestException('source deve ser AETHOS');
  const aethosProductId = integer(
    pick(row, ['ID_ITEM', 'idItem', 'aethosProductId']),
    'ID_ITEM',
  ) as number;
  const productDescription = requiredText(
    pick(row, ['DS_ITEM', 'description', 'productDescription']),
    'DS_ITEM',
    500,
  );
  const folded = fold(productDescription);
  if (
    revenueType === 'INTERNAL' &&
    (!folded.includes('ASFALTO') || folded.includes('REJEIT'))
  ) {
    throw new BadRequestException(
      'Item nao atende ao filtro de receita interna de asfalto',
    );
  }
  if (
    revenueType === 'EXTERNAL' &&
    !folded.includes('ASFALTO') &&
    !folded.includes('CBUQ')
  ) {
    throw new BadRequestException(
      'Item nao atende ao filtro de receita externa de asfalto/CBUQ',
    );
  }
  return {
    source: 'AETHOS' as const,
    aethosProductId,
    productDescription,
    classification: classifyUsinaProduction(productDescription),
    active:
      row.active === undefined ? true : booleanValue(row.active, 'active'),
    sourceUpdatedAt: isoDateTime(
      pick(row, ['sourceUpdatedAt', 'DT_ATUALIZACAO']),
      'sourceUpdatedAt',
      true,
    ),
  };
}

function normalizeInternal(row: AnyRow, index: number): NormalizedRevenueRow {
  const base = common(row, 'INTERNAL');
  const weighingId = requiredText(
    pick(row, ['ID_PESAGEM', 'idPesagem', 'weighingId']),
    'ID_PESAGEM',
    100,
  );
  const sourceRecordId = `${weighingId}|${base.aethosProductId}`;
  const dates = dateFields(
    pick(row, ['DT_PRI_PESAGEM', 'occurredAt']),
    'DT_PRI_PESAGEM',
  );
  const quantity = decimal(
    pick(row, ['VL_PESO', 'quantityTon']),
    'VL_PESO',
  ) as Prisma.Decimal;
  if (quantity.lte(0))
    throw new BadRequestException('VL_PESO deve ser maior que zero');
  const amount = decimal(
    pick(row, ['VL_TOTAL', 'amount']),
    'VL_TOTAL',
  ) as Prisma.Decimal;
  const aethosCompanyId = integer(
    pick(row, ['ID_EMPRESA', 'aethosCompanyId']),
    'ID_EMPRESA',
  ) as number;
  const originFlag = optionalText(pick(row, ['FL_ORIGEM', 'originFlag']), 30);
  const personId = integer(
    pick(row, ['ID_PESSOA', 'personId']),
    'ID_PESSOA',
    true,
  );
  const entryExitFlag = optionalText(
    pick(row, ['FL_ENTRADA_SAIDA', 'entryExitFlag']),
    30,
  );
  const vehicleStatus = requiredText(
    pick(row, [
      'PESAGEM_VEICULO_FL_SITUACAO',
      'PV_FL_SITUACAO',
      'weighingVehicleStatus',
    ]),
    'PESAGEM_VEICULO.FL_SITUACAO',
    30,
  ).toUpperCase();
  const weighingStatus = requiredText(
    pick(row, ['PESAGEM_FL_SITUACAO', 'P_FL_SITUACAO', 'weighingStatus']),
    'PESAGEM.FL_SITUACAO',
    30,
  ).toUpperCase();
  const tareTon = decimal(pick(row, ['VL_TARA', 'tareTon']), 'VL_TARA', true);
  if (fold(vehicleStatus) !== 'FIN' || fold(weighingStatus) !== 'FIN') {
    throw new BadRequestException(
      'As situacoes da pesagem interna devem ser FIN',
    );
  }
  if (tareTon !== null && tareTon.gt(0)) {
    throw new BadRequestException(
      'VL_TARA deve ser nulo ou menor/igual a zero',
    );
  }
  if (
    aethosCompanyId === 4 ||
    fold(originFlag || '') === 'TER' ||
    personId === 443
  ) {
    throw new BadRequestException(
      'Linha nao pertence ao escopo da receita interna',
    );
  }
  return finish(index, row, {
    ...base,
    revenueType: 'INTERNAL',
    sourceRecordId,
    sourceOrderId: null,
    sourceDocumentId: weighingId,
    sourceItemId: String(base.aethosProductId),
    sourceLineId: null,
    ...dates,
    quantityOriginal: quantity,
    quantityUnit: 'T',
    quantityTon: quantity,
    amount,
    freightAmount: null,
    orderFreightAmount: null,
    historicalUnitCost: decimal(
      pick(row, ['VL_CUSTOITEM', 'historicalUnitCost']),
      'VL_CUSTOITEM',
      true,
    ),
    aethosCompanyId,
    originFlag,
    personId,
    entryExitFlag,
    weighingVehicleStatus: 'FIN',
    weighingStatus: 'FIN',
    tareTon,
  });
}

function normalizeExternal(row: AnyRow, index: number): NormalizedRevenueRow {
  const base = common(row, 'EXTERNAL');
  const orderId = requiredText(
    pick(row, ['ID_PEDIDO', 'sourceOrderId']),
    'ID_PEDIDO',
    120,
  );
  const documentId = requiredText(
    pick(row, ['ID_DOCUMENTO', 'sourceDocumentId']),
    'ID_DOCUMENTO',
    120,
  );
  const sourceItemId = String(base.aethosProductId);
  const sourceLineId = requiredText(
    pick(row, ['ID_PEDIDOITEM', 'sourceLineId']),
    'ID_PEDIDOITEM',
    120,
  );
  const sourceRecordId = `${orderId}|${sourceLineId}`;
  const dates = dateFields(
    pick(row, ['DT_FATURAMENTO', 'occurredAt']),
    'DT_FATURAMENTO',
  );
  const quantityOriginal = decimal(
    pick(row, ['QT_VENDA', 'quantityOriginal']),
    'QT_VENDA',
  ) as Prisma.Decimal;
  const quantityUnit = requiredText(
    pick(row, ['SG_UNIDADEMEDIDA', 'quantityUnit']),
    'SG_UNIDADEMEDIDA',
    30,
  ).toUpperCase();
  const explicitQuantityTon = decimal(row.quantityTon, 'quantityTon', true);
  const quantityTon =
    explicitQuantityTon ||
    (['TN', 'T', 'TON', 'TONELADA', 'TONELADAS'].includes(fold(quantityUnit))
      ? quantityOriginal
      : null);
  return finish(index, row, {
    ...base,
    revenueType: 'EXTERNAL',
    sourceRecordId,
    sourceOrderId: orderId,
    sourceDocumentId: documentId,
    sourceItemId,
    sourceLineId,
    ...dates,
    quantityOriginal,
    quantityUnit,
    quantityTon,
    amount: decimal(
      pick(row, ['VL_VENDA_SEM_FRETE', 'amount']),
      'VL_VENDA_SEM_FRETE',
    ) as Prisma.Decimal,
    freightAmount: decimal(
      pick(row, ['VL_FRETE', 'freightAmount']),
      'VL_FRETE',
      true,
    ),
    orderFreightAmount: decimal(
      pick(row, ['VL_FRETEPEDIDO', 'orderFreightAmount']),
      'VL_FRETEPEDIDO',
      true,
    ),
    historicalUnitCost: null,
    aethosCompanyId: integer(
      pick(row, ['ID_EMPRESA', 'aethosCompanyId']),
      'ID_EMPRESA',
      true,
    ),
    originFlag: null,
    personId: null,
    entryExitFlag: null,
    weighingVehicleStatus: null,
    weighingStatus: null,
    tareTon: null,
  });
}

function finish(
  index: number,
  raw: AnyRow,
  row: Omit<NormalizedRevenueRow, 'index' | 'raw' | 'contentHash'>,
): NormalizedRevenueRow {
  const contentHash = hashCanonicalValue({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    occurredDate: row.occurredDate.toISOString().slice(0, 10),
    competence: row.competence.toISOString().slice(0, 10),
    quantityOriginal: row.quantityOriginal.toFixed(6),
    quantityTon: row.quantityTon?.toFixed(6) ?? null,
    amount: row.amount.toFixed(6),
    freightAmount: row.freightAmount?.toFixed(6) ?? null,
    orderFreightAmount: row.orderFreightAmount?.toFixed(6) ?? null,
    historicalUnitCost: row.historicalUnitCost?.toFixed(6) ?? null,
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
    return Array.isArray(message)
      ? message.join('; ')
      : message || error.message;
  }
  return error instanceof Error ? error.message : 'Linha invalida';
}

export function normalizeUsinaRevenueRows(
  rows: unknown[],
  envelope: Pick<NormalizedRevenueEnvelope, 'revenueType' | 'scope'>,
) {
  const accepted: NormalizedRevenueRow[] = [];
  const rejected: RevenueRowRejection[] = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    let key: string | null = null;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('Linha deve ser um objeto');
      }
      const row = value as AnyRow;
      const normalized =
        envelope.revenueType === 'INTERNAL'
          ? normalizeInternal(row, index)
          : normalizeExternal(row, index);
      key = normalized.sourceRecordId;
      if (seen.has(key))
        throw new BadRequestException('Chave repetida no mesmo lote');
      seen.add(key);
      if (
        normalized.occurredDate < envelope.scope.dateFrom ||
        normalized.occurredDate > envelope.scope.dateTo
      ) {
        throw new BadRequestException(
          'Data da linha esta fora do scope informado',
        );
      }
      accepted.push(normalized);
    } catch (error) {
      rejected.push({ index, key, reason: errorMessage(error) });
    }
  });
  return { accepted, rejected };
}
