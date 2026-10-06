import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { classifyUsinaVehicleExpense } from '../common/usina-maintenance-classification';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_OPERATIONAL_COST_DATASETS = [
  'VEHICLE_EXPENSES',
  'PAYABLE_EXPENSES',
  'LABOR_COSTS',
  'INTERNAL_CONSUMPTION_EXPENSES',
  'MATERIAL_PURCHASE_EXPENSES',
] as const;
export type UsinaOperationalCostDataset =
  (typeof USINA_OPERATIONAL_COST_DATASETS)[number];
type AnyRow = Record<string, unknown>;

export interface NormalizedOperationalCostEnvelope {
  dataset: UsinaOperationalCostDataset;
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

export interface NormalizedOperationalCostRow {
  index: number;
  source: 'AETHOS' | 'TOTVS_IND_BI_0036';
  dataset: UsinaOperationalCostDataset;
  sourceRecordId: string;
  sourceDocumentId: string | null;
  sourceDocumentType: string | null;
  aethosVehicleId: number | null;
  fleetNumber: number | null;
  accountPlanId: number | null;
  accountPlanDescription: string | null;
  internalConsumptionId: number | null;
  internalConsumptionItemId: number | null;
  materialEntryId: number | null;
  materialEntryItemId: number | null;
  sourceNoteNumber: string | null;
  receivedDate: Date | null;
  aethosItemId: number | null;
  itemDescription: string | null;
  itemCategoryId: number | null;
  itemCategoryDescription: string | null;
  sourceDirection: string | null;
  selectionBasis: string | null;
  costClass:
    | 'DIESEL_USINA'
    | 'MANUTENCAO_USINA'
    | 'VEHICLE_EXPENSE'
    | 'OLEO_RESIVALE'
    | 'CAL_CH1'
    | 'DOP'
    | 'MATERIAL_EXPEDIENTE'
    | 'ENERGIA'
    | 'MAO_DE_OBRA'
    | 'BANHEIRO_QUIMICO_EQUIPE_ASFALTO';
  occurredAt: Date;
  occurredDate: Date;
  competence: Date;
  amount: Prisma.Decimal;
  quantity: Prisma.Decimal | null;
  quantityUnit: string | null;
  quantityOriginal: Prisma.Decimal | null;
  quantityOriginalUnit: string | null;
  quantityTon: Prisma.Decimal | null;
  unitPriceOriginal: Prisma.Decimal | null;
  unitPriceTon: Prisma.Decimal | null;
  sourceItemTotal: Prisma.Decimal | null;
  quantityNormalizationBasis: string | null;
  priceNormalizationBasis: string | null;
  competenceBasis: string | null;
  aethosCompanyId: number | null;
  supplierId: number | null;
  debitCreditFlag: string | null;
  sourceStatus: string;
  limitationNote: string | null;
  sourceUpdatedAt: Date | null;
  active: boolean;
  raw: Prisma.InputJsonValue;
  contentHash: string;
}

const pick = (row: AnyRow, keys: string[]) =>
  keys.map((key) => row[key]).find((value) => value !== undefined);
function text(value: unknown, field: string, max = 300) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max)
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}
function optionalText(value: unknown, max = 300) {
  if (value === null || value === undefined || value === '') return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > max)
    throw new BadRequestException(`Texto excede ${max} caracteres`);
  return result;
}
function integer(value: unknown, field: string, nullable = false) {
  if ((value === null || value === undefined || value === '') && nullable)
    return null;
  if (!/^\d+$/.test(String(value ?? '').trim()))
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  return result;
}
function decimal(value: unknown, field: string, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new BadRequestException(`${field} e obrigatorio`);
  }
  const result = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(result))
    throw new BadRequestException(`${field} deve ser decimal com ate 6 casas`);
  return new Prisma.Decimal(result);
}
function date(value: unknown, field: string) {
  const raw = text(value, field, 50);
  const parsed = new Date(raw);
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
const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function civil(rawValue: unknown, field: string) {
  const occurredAt = date(rawValue, field);
  const raw = String(rawValue ?? '').trim();
  let day = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!day || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parts = Object.fromEntries(
      FMT.formatToParts(occurredAt).map((part) => [part.type, part.value]),
    );
    day = `${parts.year}-${parts.month}-${parts.day}`;
  }
  return {
    occurredAt,
    occurredDate: dateOnly(day, field),
    competence: dateOnly(`${day.slice(0, 7)}-01`, 'competence'),
  };
}
function explicitCompetence(value: unknown) {
  const competence = dateOnly(value, 'DT_COMPETENCIA');
  if (competence.getUTCDate() !== 1)
    throw new BadRequestException(
      'DT_COMPETENCIA deve ser o primeiro dia do mes',
    );
  return competence;
}
function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function normalizeUsinaOperationalCostEnvelope(
  body: unknown,
): NormalizedOperationalCostEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Envelope invalido');
  const payload = body as AnyRow;
  const dataset = text(payload.dataset, 'dataset', 50).toUpperCase();
  if (!(USINA_OPERATIONAL_COST_DATASETS as readonly string[]).includes(dataset))
    throw new BadRequestException('dataset invalido');
  const syncMode = text(payload.syncMode, 'syncMode', 20).toLowerCase();
  if (syncMode !== 'full' && syncMode !== 'incremental')
    throw new BadRequestException('syncMode invalido');
  if (
    !payload.scope ||
    typeof payload.scope !== 'object' ||
    Array.isArray(payload.scope)
  )
    throw new BadRequestException('scope e obrigatorio');
  const scope = payload.scope as AnyRow;
  if (
    text(scope.company, 'scope.company').toUpperCase() !== USINA_COMPANY_ID ||
    text(scope.unit, 'scope.unit').toUpperCase() !== USINA_UNIT_ID
  )
    throw new BadRequestException('scope invalido');
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo) throw new BadRequestException('scope invalido');
  const batchNumber = integer(payload.batchNumber, 'batchNumber') as number;
  if (
    !Array.isArray(payload.rows) ||
    payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT
  )
    throw new BadRequestException('rows deve ter ate 500 linhas');
  return {
    dataset: dataset as UsinaOperationalCostDataset,
    syncMode,
    syncRunId: text(payload.syncRunId, 'syncRunId', 200),
    generatedAt: date(payload.generatedAt, 'generatedAt'),
    scope: { company: USINA_COMPANY_ID, unit: USINA_UNIT_ID, dateFrom, dateTo },
    batchNumber,
    isLastBatch: bool(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function base(row: AnyRow) {
  return {
    active: row.active === undefined ? true : bool(row.active, 'active'),
    sourceUpdatedAt:
      row.sourceUpdatedAt == null
        ? null
        : date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
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
    quantity: decimal(
      pick(row, ['QT_QUANTIDADE', 'quantity']),
      'QT_QUANTIDADE',
      true,
    ),
    quantityUnit: optionalText(
      pick(row, ['SG_UNIDADEMEDIDA', 'quantityUnit']),
      30,
    ),
    materialEntryId: null,
    materialEntryItemId: null,
    sourceNoteNumber: null,
    receivedDate: null,
    quantityOriginal: null,
    quantityOriginalUnit: null,
    quantityTon: null,
    unitPriceOriginal: null,
    unitPriceTon: null,
    sourceItemTotal: null,
    quantityNormalizationBasis: null,
    priceNormalizationBasis: null,
    competenceBasis: null,
  };
}
function vehicle(row: AnyRow, index: number) {
  const common = base(row);
  const documentType = text(
    pick(row, ['FL_DOCUMENTO', 'sourceDocumentType']),
    'FL_DOCUMENTO',
    20,
  ).toUpperCase();
  const documentId = text(
    pick(row, ['ID_DOCUMENTO', 'sourceDocumentId']),
    'ID_DOCUMENTO',
    120,
  );
  const vehicleId = integer(
    pick(row, ['ID_VEICULO', 'aethosVehicleId']),
    'ID_VEICULO',
  ) as number;
  const planId = integer(
    pick(row, ['ID_PLANOCONTA', 'accountPlanId']),
    'ID_PLANOCONTA',
  ) as number;
  const plan = text(
    pick(row, ['DS_PLANOCONTA', 'accountPlanDescription']),
    'DS_PLANOCONTA',
    500,
  );
  const costClass = classifyUsinaVehicleExpense(vehicleId, plan);
  const occurred = civil(pick(row, ['DT_DATA', 'occurredAt']), 'DT_DATA');
  const sourceRecordId = `${documentType}|${documentId}|${vehicleId}|${planId}|${occurred.occurredDate.toISOString().slice(0, 10)}`;
  const providedKey = optionalText(row.sourceRecordId, 300);
  if (providedKey !== null && providedKey !== sourceRecordId)
    throw new BadRequestException('sourceRecordId diverge da chave canonica');
  return finish(index, row, {
    ...common,
    source: 'AETHOS',
    dataset: 'VEHICLE_EXPENSES',
    sourceRecordId,
    sourceDocumentId: documentId,
    sourceDocumentType: documentType,
    aethosVehicleId: vehicleId,
    fleetNumber: integer(
      pick(row, ['NR_FROTA', 'fleetNumber']),
      'NR_FROTA',
      true,
    ),
    accountPlanId: planId,
    accountPlanDescription: plan,
    internalConsumptionId: null,
    internalConsumptionItemId: null,
    aethosItemId: null,
    itemDescription: null,
    itemCategoryId: null,
    itemCategoryDescription: null,
    sourceDirection: null,
    selectionBasis: null,
    costClass,
    ...occurred,
    amount: decimal(
      pick(row, ['VL_TOTAL_CALCULADO', 'amount']),
      'VL_TOTAL_CALCULADO',
    ) as Prisma.Decimal,
    debitCreditFlag: null,
    sourceStatus:
      optionalText(pick(row, ['FL_STATUS', 'sourceStatus']), 30) || 'ACTIVE',
    limitationNote: null,
  });
}
const PAYABLE_CLASSES: Record<
  number,
  NormalizedOperationalCostRow['costClass']
> = {
  1054: 'OLEO_RESIVALE',
  1056: 'DOP',
  776: 'ENERGIA',
  839: 'BANHEIRO_QUIMICO_EQUIPE_ASFALTO',
};
function payable(row: AnyRow, index: number) {
  const common = base(row);
  const planId = integer(
    pick(row, ['ID_PLANOCONTA', 'accountPlanId']),
    'ID_PLANOCONTA',
  ) as number;
  const costClass = PAYABLE_CLASSES[planId];
  if (!costClass)
    throw new BadRequestException('ID_PLANOCONTA fora das rubricas da Usina');
  const debit = text(
    pick(row, ['FL_DEBITOCREDITO', 'debitCreditFlag']),
    'FL_DEBITOCREDITO',
    10,
  ).toUpperCase();
  const status = text(
    pick(row, ['FL_STATUS', 'sourceStatus']),
    'FL_STATUS',
    30,
  ).toUpperCase();
  if (debit !== 'D' || status !== 'BXD')
    throw new BadRequestException('Conta deve ser debito e BXD');
  const occurred = civil(pick(row, ['DT_EMISSAO', 'occurredAt']), 'DT_EMISSAO');
  return finish(index, row, {
    ...common,
    source: 'AETHOS',
    dataset: 'PAYABLE_EXPENSES',
    sourceRecordId: text(
      pick(row, ['ID_RECEBERPAGAR', 'sourceRecordId']),
      'ID_RECEBERPAGAR',
      120,
    ),
    sourceDocumentId: optionalText(
      pick(row, ['ID_DOCUMENTO', 'sourceDocumentId']),
      120,
    ),
    sourceDocumentType: null,
    aethosVehicleId: null,
    fleetNumber: null,
    accountPlanId: planId,
    accountPlanDescription: optionalText(
      pick(row, ['DS_PLANOCONTA', 'accountPlanDescription']),
      500,
    ),
    internalConsumptionId: null,
    internalConsumptionItemId: null,
    aethosItemId: null,
    itemDescription: null,
    itemCategoryId: null,
    itemCategoryDescription: null,
    sourceDirection: null,
    selectionBasis: null,
    costClass,
    occurredAt: occurred.occurredAt,
    occurredDate: occurred.occurredDate,
    competence: explicitCompetence(pick(row, ['DT_COMPETENCIA', 'competence'])),
    amount: decimal(
      pick(row, ['VL_PARCELA', 'amount']),
      'VL_PARCELA',
    ) as Prisma.Decimal,
    debitCreditFlag: debit,
    sourceStatus: status,
    limitationNote: null,
  });
}
function labor(row: AnyRow, index: number) {
  const competence = explicitCompetence(
    pick(row, ['DT_COMPETENCIA', 'competence']),
  );
  const extractedAt = date(
    pick(row, ['sourceExtractedAt', 'occurredAt']),
    'sourceExtractedAt',
  );
  return finish(index, row, {
    materialEntryId: null,
    materialEntryItemId: null,
    sourceNoteNumber: null,
    receivedDate: null,
    quantityOriginal: null,
    quantityOriginalUnit: null,
    quantityTon: null,
    unitPriceOriginal: null,
    unitPriceTon: null,
    sourceItemTotal: null,
    quantityNormalizationBasis: null,
    priceNormalizationBasis: null,
    competenceBasis: null,
    active: row.active === undefined ? true : bool(row.active, 'active'),
    sourceUpdatedAt: extractedAt,
    aethosCompanyId: null,
    supplierId: null,
    quantity: null,
    quantityUnit: null,
    source: 'TOTVS_IND_BI_0036',
    dataset: 'LABOR_COSTS',
    sourceRecordId: `${competence.toISOString().slice(0, 7)}|USINA_ASFALTO_ICARA`,
    sourceDocumentId: null,
    sourceDocumentType: null,
    aethosVehicleId: null,
    fleetNumber: null,
    accountPlanId: null,
    accountPlanDescription: null,
    internalConsumptionId: null,
    internalConsumptionItemId: null,
    aethosItemId: null,
    itemDescription: null,
    itemCategoryId: null,
    itemCategoryDescription: null,
    sourceDirection: null,
    selectionBasis: null,
    costClass: 'MAO_DE_OBRA',
    occurredAt: extractedAt,
    occurredDate: dateOnly(
      extractedAt.toISOString().slice(0, 10),
      'sourceExtractedAt',
    ),
    competence,
    amount: decimal(
      pick(row, ['VL_MO_USINA', 'amount']),
      'VL_MO_USINA',
    ) as Prisma.Decimal,
    debitCreditFlag: null,
    sourceStatus: 'AGGREGATED',
    limitationNote: text(
      pick(row, ['limitationNote', 'observacao']),
      'limitationNote',
      1000,
    ),
  });
}

const INTERNAL_CONSUMPTION_PLAN_ID = 1236;
const INTERNAL_CONSUMPTION_CATEGORY_IDS = new Set([148, 926, 833, 927]);
const INTERNAL_CONSUMPTION_ITEM_EXCEPTIONS = new Set([10387]);

function internalConsumption(row: AnyRow, index: number) {
  const consumptionId = integer(
    pick(row, ['ID_CONSUMOINTERNO', 'internalConsumptionId']),
    'ID_CONSUMOINTERNO',
  ) as number;
  const consumptionItemId = integer(
    pick(row, ['ID_CONSUMOINTERNOITEM', 'internalConsumptionItemId']),
    'ID_CONSUMOINTERNOITEM',
  ) as number;
  const sourceRecordId = `${consumptionId}|${consumptionItemId}`;
  const providedKey = optionalText(row.sourceRecordId, 300);
  if (providedKey !== null && providedKey !== sourceRecordId) {
    throw new BadRequestException('sourceRecordId diverge da chave canonica');
  }

  const planId = integer(
    pick(row, ['ID_PLANOCONTA', 'accountPlanId']),
    'ID_PLANOCONTA',
  ) as number;
  if (planId !== INTERNAL_CONSUMPTION_PLAN_ID) {
    throw new BadRequestException('ID_PLANOCONTA deve ser 1236');
  }

  const status = text(
    pick(row, ['FL_STATUS', 'sourceStatus']),
    'FL_STATUS',
    30,
  ).toUpperCase();
  const direction = text(
    pick(row, ['FL_ENTRADASAIDA', 'sourceDirection']),
    'FL_ENTRADASAIDA',
    10,
  ).toUpperCase();
  if (status !== 'E' || direction !== 'S') {
    throw new BadRequestException(
      'Consumo interno deve ter FL_STATUS=E e FL_ENTRADASAIDA=S',
    );
  }

  const aethosItemId = integer(
    pick(row, ['ID_ITEM', 'aethosItemId']),
    'ID_ITEM',
  ) as number;
  const itemCategoryId = integer(
    pick(row, ['ID_CATEGORIA_ITEM', 'itemCategoryId']),
    'ID_CATEGORIA_ITEM',
  ) as number;
  if (
    !INTERNAL_CONSUMPTION_CATEGORY_IDS.has(itemCategoryId) &&
    !INTERNAL_CONSUMPTION_ITEM_EXCEPTIONS.has(aethosItemId)
  ) {
    throw new BadRequestException(
      'Item fora das categorias de material de expediente da Usina',
    );
  }

  const occurred = civil(
    pick(row, ['DT_LANCAMENTO', 'occurredAt']),
    'DT_LANCAMENTO',
  );
  const competence = explicitCompetence(
    pick(row, ['DT_COMPETENCIA', 'competence']),
  );
  if (
    competence.toISOString().slice(0, 7) !==
    occurred.competence.toISOString().slice(0, 7)
  ) {
    throw new BadRequestException('DT_COMPETENCIA diverge de DT_LANCAMENTO');
  }

  return finish(index, row, {
    materialEntryId: null,
    materialEntryItemId: null,
    sourceNoteNumber: null,
    receivedDate: null,
    quantityOriginal: null,
    quantityOriginalUnit: null,
    quantityTon: null,
    unitPriceOriginal: null,
    unitPriceTon: null,
    sourceItemTotal: null,
    quantityNormalizationBasis: null,
    priceNormalizationBasis: null,
    competenceBasis: null,
    active: row.active === undefined ? true : bool(row.active, 'active'),
    sourceUpdatedAt:
      row.sourceUpdatedAt == null
        ? null
        : date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
    aethosCompanyId: null,
    supplierId: null,
    quantity: decimal(
      pick(row, ['QT_SOLICITADA', 'quantity']),
      'QT_SOLICITADA',
    ) as Prisma.Decimal,
    quantityUnit: null,
    source: 'AETHOS',
    dataset: 'INTERNAL_CONSUMPTION_EXPENSES',
    sourceRecordId,
    sourceDocumentId: String(consumptionId),
    sourceDocumentType: 'CONSUMO_INTERNO',
    aethosVehicleId: null,
    fleetNumber: null,
    accountPlanId: planId,
    accountPlanDescription: text(
      pick(row, ['DS_PLANOCONTA', 'accountPlanDescription']),
      'DS_PLANOCONTA',
      500,
    ),
    internalConsumptionId: consumptionId,
    internalConsumptionItemId: consumptionItemId,
    aethosItemId,
    itemDescription: text(
      pick(row, ['DS_ITEM', 'itemDescription']),
      'DS_ITEM',
      500,
    ),
    itemCategoryId,
    itemCategoryDescription: text(
      pick(row, ['DS_CATEGORIA_ITEM', 'itemCategoryDescription']),
      'DS_CATEGORIA_ITEM',
      500,
    ),
    sourceDirection: direction,
    selectionBasis: text(row.selectionBasis, 'selectionBasis', 1000),
    costClass: 'MATERIAL_EXPEDIENTE',
    occurredAt: occurred.occurredAt,
    occurredDate: occurred.occurredDate,
    competence,
    amount: decimal(
      pick(row, ['VL_CUSTOTOTAL', 'amount']),
      'VL_CUSTOTOTAL',
    ) as Prisma.Decimal,
    debitCreditFlag: null,
    sourceStatus: status,
    limitationNote:
      aethosItemId === 10387
        ? 'Excecao catalogal: VASSOURA GARI classificada fora das categorias usuais de expediente.'
        : null,
  });
}

const CAL_CH1_AETHOS_ITEM_ID = 2023;

function positiveDecimal(value: unknown, field: string) {
  const result = decimal(value, field) as Prisma.Decimal;
  if (result.lte(0)) {
    throw new BadRequestException(`${field} deve ser maior que zero`);
  }
  return result;
}

function optionalCivilDate(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  return civil(value, field).occurredDate;
}

function materialPurchase(row: AnyRow, index: number) {
  const materialEntryId = integer(
    pick(row, ['ID_NFENTRADA', 'materialEntryId']),
    'ID_NFENTRADA',
  ) as number;
  const materialEntryItemId = integer(
    pick(row, ['ID_NFENTRADAITEM', 'materialEntryItemId']),
    'ID_NFENTRADAITEM',
  ) as number;
  const sourceRecordId = `${materialEntryId}|${materialEntryItemId}`;
  const providedKey = optionalText(row.sourceRecordId, 300);
  if (providedKey !== null && providedKey !== sourceRecordId) {
    throw new BadRequestException('sourceRecordId diverge da chave canonica');
  }

  const aethosItemId = integer(
    pick(row, ['ID_ITEM', 'aethosItemId']),
    'ID_ITEM',
  ) as number;
  if (aethosItemId !== CAL_CH1_AETHOS_ITEM_ID) {
    throw new BadRequestException('ID_ITEM deve ser 2023');
  }
  const status = text(
    pick(row, ['FL_STATUS', 'sourceStatus']),
    'FL_STATUS',
    30,
  ).toUpperCase();
  if (status !== 'F') {
    throw new BadRequestException('NF de entrada deve ter FL_STATUS=F');
  }

  const occurred = civil(
    pick(row, ['DT_EMISSAO', 'occurredAt']),
    'DT_EMISSAO',
  );
  const competence = explicitCompetence(
    pick(row, ['DT_COMPETENCIA', 'competence']),
  );
  if (
    competence.toISOString().slice(0, 7) !==
    occurred.competence.toISOString().slice(0, 7)
  ) {
    throw new BadRequestException('DT_COMPETENCIA diverge de DT_EMISSAO');
  }

  const quantityOriginal = positiveDecimal(
    pick(row, ['QT_ORIGINAL', 'quantityOriginal']),
    'QT_ORIGINAL',
  );
  const quantityTon = positiveDecimal(
    pick(row, ['QT_TONELADAS', 'quantityTon']),
    'QT_TONELADAS',
  );
  const unitPriceOriginal = positiveDecimal(
    pick(row, ['VL_PRECOUNITARIO', 'unitPriceOriginal']),
    'VL_PRECOUNITARIO',
  );
  const unitPriceTon = positiveDecimal(
    pick(row, ['VL_PRECO_TONELADA', 'unitPriceTon']),
    'VL_PRECO_TONELADA',
  );
  const sourceItemTotal = positiveDecimal(
    pick(row, ['VL_TOTALITEM', 'sourceItemTotal']),
    'VL_TOTALITEM',
  );
  const calculatedCost = positiveDecimal(
    pick(row, ['VL_CUSTO_CALCULADO', 'amount']),
    'VL_CUSTO_CALCULADO',
  );
  const expectedCost = quantityTon.mul(unitPriceTon).toDecimalPlaces(2);
  if (!calculatedCost.equals(expectedCost)) {
    throw new BadRequestException(
      'VL_CUSTO_CALCULADO diverge de QT_TONELADAS x VL_PRECO_TONELADA',
    );
  }

  return finish(index, row, {
    active: row.active === undefined ? true : bool(row.active, 'active'),
    sourceUpdatedAt:
      row.sourceUpdatedAt == null
        ? null
        : date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
    source: 'AETHOS',
    dataset: 'MATERIAL_PURCHASE_EXPENSES',
    sourceRecordId,
    sourceDocumentId: String(materialEntryId),
    sourceDocumentType: 'NF_ENTRADA',
    aethosVehicleId: null,
    fleetNumber: null,
    accountPlanId: null,
    accountPlanDescription: null,
    internalConsumptionId: null,
    internalConsumptionItemId: null,
    materialEntryId,
    materialEntryItemId,
    sourceNoteNumber: optionalText(
      pick(row, ['NR_NOTA', 'sourceNoteNumber']),
      120,
    ),
    receivedDate: optionalCivilDate(
      pick(row, ['DT_RECEBIMENTO', 'receivedDate']),
      'DT_RECEBIMENTO',
    ),
    aethosItemId,
    itemDescription: text(
      pick(row, ['DS_ITEM', 'itemDescription']),
      'DS_ITEM',
      500,
    ),
    itemCategoryId: null,
    itemCategoryDescription: null,
    sourceDirection: 'E',
    selectionBasis: 'NFENTRADA + NFENTRADAITEM; item 2023; FL_STATUS=F',
    costClass: 'CAL_CH1',
    occurredAt: occurred.occurredAt,
    occurredDate: occurred.occurredDate,
    competence,
    amount: calculatedCost,
    quantity: quantityTon,
    quantityUnit: 'TN',
    quantityOriginal,
    quantityOriginalUnit: text(
      pick(row, ['SG_UNIDADEMEDIDA', 'quantityOriginalUnit']),
      'SG_UNIDADEMEDIDA',
      30,
    ).toUpperCase(),
    quantityTon,
    unitPriceOriginal,
    unitPriceTon,
    sourceItemTotal,
    quantityNormalizationBasis: text(
      row.quantityNormalizationBasis,
      'quantityNormalizationBasis',
      1000,
    ),
    priceNormalizationBasis: text(
      row.priceNormalizationBasis,
      'priceNormalizationBasis',
      1000,
    ),
    competenceBasis: text(row.competenceBasis, 'competenceBasis', 500),
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
    debitCreditFlag: null,
    sourceStatus: status,
    limitationNote: null,
  });
}

function finish(
  index: number,
  raw: AnyRow,
  row: Omit<NormalizedOperationalCostRow, 'index' | 'raw' | 'contentHash'>,
): NormalizedOperationalCostRow {
  const contentHash = hashCanonicalValue({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    occurredDate: row.occurredDate.toISOString().slice(0, 10),
    competence: row.competence.toISOString().slice(0, 10),
    amount: row.amount.toFixed(6),
    quantity: row.quantity?.toFixed(6) ?? null,
    quantityOriginal: row.quantityOriginal?.toFixed(6) ?? null,
    quantityTon: row.quantityTon?.toFixed(6) ?? null,
    unitPriceOriginal: row.unitPriceOriginal?.toFixed(6) ?? null,
    unitPriceTon: row.unitPriceTon?.toFixed(6) ?? null,
    sourceItemTotal: row.sourceItemTotal?.toFixed(6) ?? null,
    receivedDate: row.receivedDate?.toISOString().slice(0, 10) ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
  });
  return { ...row, index, raw: raw as Prisma.InputJsonValue, contentHash };
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
export function normalizeUsinaOperationalCostRows(
  rows: unknown[],
  envelope: NormalizedOperationalCostEnvelope,
) {
  const accepted: NormalizedOperationalCostRow[] = [];
  const rejected: { index: number; key: string | null; reason: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    let key: string | null = null;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('Linha deve ser objeto');
      const row = value as AnyRow;
      const normalized =
        envelope.dataset === 'VEHICLE_EXPENSES'
          ? vehicle(row, index)
          : envelope.dataset === 'PAYABLE_EXPENSES'
            ? payable(row, index)
            : envelope.dataset === 'LABOR_COSTS'
              ? labor(row, index)
              : envelope.dataset === 'INTERNAL_CONSUMPTION_EXPENSES'
                ? internalConsumption(row, index)
                : materialPurchase(row, index);
      key = normalized.sourceRecordId;
      if (seen.has(key))
        throw new BadRequestException('Chave repetida no lote');
      seen.add(key);
      if (
        normalized.competence < envelope.scope.dateFrom ||
        normalized.competence > envelope.scope.dateTo
      )
        throw new BadRequestException('Competencia fora do scope');
      accepted.push(normalized);
    } catch (error) {
      rejected.push({ index, key, reason: errorMessage(error) });
    }
  });
  return { accepted, rejected };
}
