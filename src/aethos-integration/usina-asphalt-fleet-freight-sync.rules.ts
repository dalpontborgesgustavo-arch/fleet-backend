import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  USINA_ASPHALT_FLEET_FREIGHT_DATASET,
} from '../usina-asphalt-teams/usina-asphalt-team-fleet.rules';
import {
  hashCanonicalValue,
  USINA_COMPANY_ID,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

function object(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${field} deve ser um objeto`);
  }
  return value as Record<string, any>;
}

function text(value: unknown, field: string, max = 200) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max) throw new BadRequestException(`${field} excede ${max} caracteres`);
  return result;
}

function optionalText(value: unknown, max = 200) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const result = String(value).trim();
  if (result.length > max) throw new BadRequestException(`Texto excede ${max} caracteres`);
  return result;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  return parsed;
}

function dateOnly(value: unknown, field: string) {
  const input = text(value, field, 40).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException(`${field} invalida`);
  }
  const result = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== input) {
    throw new BadRequestException(`${field} invalida`);
  }
  return result;
}

function instant(value: unknown, field: string) {
  const input = text(value, field, 60);
  const result = new Date(input);
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${field} invalida`);
  return result;
}

function optionalInstant(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return instant(value, 'sourceUpdatedAt');
}

function decimal(value: unknown, field: string, nullable = false) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  try {
    const result = new Prisma.Decimal(value as any);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new BadRequestException(`${field} deve ser decimal`);
  }
}

export type NormalizedAsphaltFleetFreightRow = {
  source: 'AETHOS';
  dataset: typeof USINA_ASPHALT_FLEET_FREIGHT_DATASET;
  sourceRecordId: string;
  sourceKind: 'ENTRADA_SIMPLES' | 'NF_ENTRADA';
  sourceDocumentId: string;
  sourceInstallmentId: string | null;
  occurredAt: Date;
  occurredDate: Date;
  competence: Date;
  aethosVehicleId: number;
  fleetNumber: string | null;
  plate: string | null;
  freightTypeId: number;
  principalItemId: number | null;
  freightTypeDescription: string | null;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  amount: Prisma.Decimal;
  sourceStatus: 'F';
  sourceUpdatedAt: Date | null;
  contentHash: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

export function normalizeUsinaAsphaltFleetFreightEnvelope(body: unknown) {
  const input = object(body, 'payload');
  if (input.dataset !== USINA_ASPHALT_FLEET_FREIGHT_DATASET) {
    throw new BadRequestException(
      `dataset deve ser ${USINA_ASPHALT_FLEET_FREIGHT_DATASET}`,
    );
  }
  const syncMode = text(input.syncMode, 'syncMode', 20).toLowerCase();
  if (!['full', 'incremental'].includes(syncMode)) {
    throw new BadRequestException('syncMode deve ser full ou incremental');
  }
  const scope = object(input.scope, 'scope');
  const company = text(scope.company, 'scope.company', 80);
  const unit = text(scope.unit, 'scope.unit', 80);
  if (company !== USINA_COMPANY_ID || unit !== USINA_UNIT_ID) {
    throw new BadRequestException('Empresa/unidade fora do escopo da Usina');
  }
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateTo < dateFrom) throw new BadRequestException('scope.dateTo anterior a dateFrom');
  const batchNumber = positiveInteger(input.batchNumber, 'batchNumber');
  if (!Array.isArray(input.rows)) throw new BadRequestException('rows deve ser array');
  return {
    dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET,
    syncMode: syncMode as 'full' | 'incremental',
    syncRunId: text(input.syncRunId, 'syncRunId', 160),
    generatedAt: instant(input.generatedAt, 'generatedAt'),
    scope: { company, unit, dateFrom, dateTo },
    batchNumber,
    isLastBatch: Boolean(input.isLastBatch),
    rows: input.rows,
  };
}

function normalizeRow(
  value: unknown,
  scope: { dateFrom: Date; dateTo: Date },
): NormalizedAsphaltFleetFreightRow {
  const row = object(value, 'row');
  const sourceKind = text(row.sourceKind ?? row.SOURCE_KIND, 'sourceKind', 40).toUpperCase();
  if (!['ENTRADA_SIMPLES', 'NF_ENTRADA'].includes(sourceKind)) {
    throw new BadRequestException('sourceKind invalido');
  }
  const sourceDocumentId = text(
    row.sourceDocumentId ?? row.ID_DOCUMENTO,
    'sourceDocumentId',
    100,
  );
  const sourceInstallmentId = optionalText(
    row.sourceInstallmentId ?? row.ID_PARCELA,
    100,
  );
  const occurredText = text(
    row.occurredAt ?? row.DT_LANCAMENTO,
    'DT_LANCAMENTO',
    60,
  );
  const occurredAt = instant(occurredText, 'DT_LANCAMENTO');
  const occurredDate = dateOnly(occurredText, 'DT_LANCAMENTO');
  if (occurredDate < scope.dateFrom || occurredDate > scope.dateTo) {
    throw new BadRequestException('DT_LANCAMENTO fora do scope');
  }
  const status = text(row.sourceStatus ?? row.FL_STATUS, 'FL_STATUS', 10).toUpperCase();
  if (status !== 'F') throw new BadRequestException('Somente documentos finalizados F');
  const amount = decimal(row.amount ?? row.VL_FRETE, 'VL_FRETE')!;
  if (amount.isNegative()) throw new BadRequestException('VL_FRETE nao pode ser negativo');
  const sourceRecordId = optionalText(row.sourceRecordId ?? row.SOURCE_RECORD_ID, 220) ||
    `${sourceKind}|${sourceDocumentId}|${sourceInstallmentId || '0'}`;
  const raw = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
  const normalized = {
    source: 'AETHOS' as const,
    dataset: USINA_ASPHALT_FLEET_FREIGHT_DATASET,
    sourceRecordId,
    sourceKind: sourceKind as 'ENTRADA_SIMPLES' | 'NF_ENTRADA',
    sourceDocumentId,
    sourceInstallmentId,
    occurredAt,
    occurredDate,
    competence: new Date(
      Date.UTC(occurredDate.getUTCFullYear(), occurredDate.getUTCMonth(), 1),
    ),
    aethosVehicleId: positiveInteger(
      row.aethosVehicleId ?? row.ID_VEICULO,
      'ID_VEICULO',
    ),
    fleetNumber: optionalText(row.fleetNumber ?? row.NR_FROTA, 40),
    plate: optionalText(row.plate ?? row.PLACA, 20)?.toUpperCase() || null,
    freightTypeId: positiveInteger(
      row.freightTypeId ?? row.ID_TIPOFRETE,
      'ID_TIPOFRETE',
    ),
    principalItemId:
      row.principalItemId === null || row.principalItemId === undefined
        ? row.ID_ITEM_PRINCIPAL === null || row.ID_ITEM_PRINCIPAL === undefined
          ? null
          : positiveInteger(row.ID_ITEM_PRINCIPAL, 'ID_ITEM_PRINCIPAL')
        : positiveInteger(row.principalItemId, 'principalItemId'),
    freightTypeDescription: optionalText(
      row.freightTypeDescription ?? row.DS_TIPOFRETE,
      200,
    ),
    quantity: decimal(row.quantity ?? row.QUANTIDADE, 'QUANTIDADE', true),
    unit: optionalText(row.unit ?? row.UNIDADE, 30),
    amount,
    sourceStatus: 'F' as const,
    sourceUpdatedAt: optionalInstant(
      row.sourceUpdatedAt ?? row.SOURCE_UPDATED_AT,
    ),
    raw,
    active: row.active === undefined ? true : Boolean(row.active),
  };
  return {
    ...normalized,
    contentHash: hashCanonicalValue({
      ...normalized,
      occurredAt: occurredAt.toISOString(),
      occurredDate: occurredDate.toISOString().slice(0, 10),
      competence: normalized.competence.toISOString().slice(0, 10),
      amount: amount.toFixed(6),
      quantity: normalized.quantity?.toFixed(6) ?? null,
      sourceUpdatedAt: normalized.sourceUpdatedAt?.toISOString() ?? null,
      raw: undefined,
    }),
  };
}

export function normalizeUsinaAsphaltFleetFreightRows(
  rows: unknown[],
  scope: { dateFrom: Date; dateTo: Date },
) {
  const accepted: NormalizedAsphaltFleetFreightRow[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    try {
      const normalized = normalizeRow(row, scope);
      if (keys.has(normalized.sourceRecordId)) {
        throw new BadRequestException('sourceRecordId duplicado no lote');
      }
      keys.add(normalized.sourceRecordId);
      accepted.push(normalized);
    } catch (error: any) {
      rejected.push({ index, reason: String(error?.message || error) });
    }
  });
  return { accepted, rejected };
}
