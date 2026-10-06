import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_ROLES = new Set(['admin', 'administrativo', 'gestor', 'ceo']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SYNC_ROWS = 5000;
const SLA_UNITS = new Set(['BUSINESS_DAYS', 'CALENDAR_DAYS']);

const MANUAL_FIELDS = [
  'engineerDeliveryDate',
  'engineerDeliveryTargetDate',
  'engineerDelayReason',
  'measurementApproved',
  'rejectionReason',
  'resolutionDate',
  'zanandraDeliveryDate',
  'invoiceRequestDate',
  'contractorDocumentsDeliveryDate',
  'zanandraDeliveryTargetDate',
  'invoiceRequestTargetDate',
  'actualPaymentDate',
  'type',
  'administrativeNotes',
] as const;

type ManualField = (typeof MANUAL_FIELDS)[number];
type Row = Record<string, unknown>;

type OperationalStatus =
  | 'PENDENTE'
  | 'NO_PRAZO'
  | 'VENCENDO'
  | 'ATRASADO'
  | 'CONCLUIDO'
  | 'REPROVADO'
  | 'RESOLVIDO';

interface NormalizedItem {
  aethosMeasurementItemId: string;
  aethosContractId: string;
  measurementNumber: string | null;
  aethosWorkId: string;
  aethosContractItemId: string | null;
  aethosBudgetItemId: string | null;
  itemDescription: string;
  contractQuantity: Prisma.Decimal | null;
  contractValue: Prisma.Decimal | null;
  measuredQuantity: Prisma.Decimal | null;
  measuredPercentage: Prisma.Decimal | null;
  measuredValue: Prisma.Decimal | null;
  balanceQuantity: Prisma.Decimal | null;
  balanceValue: Prisma.Decimal | null;
  raw: Prisma.InputJsonValue;
}

interface NormalizedMeasurement {
  aethosMeasurementId: string;
  aethosContractId: string;
  aethosWorkId: string;
  workName: string;
  workContract: string | null;
  contractorAethosId: string;
  contractorName: string;
  engineerAethosId: string | null;
  engineerName: string | null;
  measurementNumber: string | null;
  measurementDescription: string | null;
  registeredAt: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  competenceDate: Date | null;
  dueDate: Date | null;
  finalizedAt: Date | null;
  finalized: boolean;
  measurementValue: Prisma.Decimal | null;
  discountValue: Prisma.Decimal | null;
  retentionValue: Prisma.Decimal | null;
  totalValue: Prisma.Decimal | null;
  contractValue: Prisma.Decimal | null;
  totalMeasuredValue: Prisma.Decimal | null;
  contractStatus: string | null;
  measurementNotes: string | null;
  contractNotes: string | null;
  source: string;
  raw: Prisma.InputJsonValue;
  contentHash: string;
  items: NormalizedItem[];
  itemsProvided: boolean;
}

function normalizeRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

export function ensureThirdPartyMeasurementAccess(role?: string | null) {
  if (!ALLOWED_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException('Sem permissao para acessar Medicao Terceiro');
  }
}

function text(value: unknown, maxLength = 4000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value: unknown, maxLength = 4000) {
  return text(value, maxLength) || null;
}

function pick(row: Row, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function listFromBody(body: unknown) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const payload = body as Row;
  for (const key of [
    'measurements',
    'medicoes',
    'medicoesTerceiro',
    'rows',
    'data',
  ]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  return [];
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toUpperCase();
  if (['S', 'SIM', 'TRUE', '1', 'Y', 'YES'].includes(normalized)) return true;
  if (['N', 'NAO', 'NÃO', 'FALSE', '0', 'NO'].includes(normalized))
    return false;
  return fallback;
}

function nullableBoolean(value: unknown) {
  if (value === null || value === undefined || text(value) === '') return null;
  return booleanValue(value);
}

function dateValue(value: unknown, fieldName: string) {
  if (value === null || value === undefined || text(value) === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const normalized = text(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T12:00:00.000Z`
    : normalized;
  const parsed = new Date(dateOnly);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} invalida`);
  }
  return parsed;
}

function decimalValue(value: unknown) {
  if (value === null || value === undefined || text(value) === '') return null;
  if (value instanceof Prisma.Decimal) return value;
  let normalized = text(value).replace(/\s|R\$/gi, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Prisma.Decimal(parsed);
}

function decimalNumber(value: Prisma.Decimal | null | undefined) {
  return value ? value.toNumber() : 0;
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function canonicalHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeItem(row: Row, measurement: Row): NormalizedItem | null {
  const aethosMeasurementItemId = text(
    pick(row, [
      'aethos_id_obra_contrato_ite_med',
      'aethosMeasurementItemId',
      'id_obra_contrato_ite_med',
      'ID_OBRA_CONTRATO_ITE_MED',
    ]),
    160,
  );
  const aethosContractId = text(
    pick(row, [
      'aethos_id_obra_contrato',
      'aethosContractId',
      'id_obra_contrato',
      'ID_OBRA_CONTRATO',
    ]) ??
      pick(measurement, [
        'aethos_id_obra_contrato',
        'aethosContractId',
        'id_obra_contrato',
      ]),
    160,
  );
  const aethosWorkId = text(
    pick(row, ['aethos_id_obra', 'aethosWorkId', 'id_obra', 'ID_OBRA']) ??
      pick(measurement, ['aethos_id_obra', 'aethosWorkId', 'id_obra']),
    160,
  );
  const itemDescription = text(
    pick(row, ['descricao_item', 'itemDescription', 'ds_item', 'DS_ITEM']),
    12000,
  );

  if (
    !aethosMeasurementItemId ||
    !aethosContractId ||
    !aethosWorkId ||
    !itemDescription
  ) {
    return null;
  }

  return {
    aethosMeasurementItemId,
    aethosContractId,
    measurementNumber: nullableText(
      pick(row, ['nr_medicao', 'measurementNumber', 'NR_MEDICAO']),
      120,
    ),
    aethosWorkId,
    aethosContractItemId: nullableText(
      pick(row, [
        'aethos_id_obra_contrato_item',
        'aethosContractItemId',
        'id_obra_contrato_item',
      ]),
      160,
    ),
    aethosBudgetItemId: nullableText(
      pick(row, [
        'aethos_id_obra_orcamento',
        'aethosBudgetItemId',
        'id_obra_orcamento',
      ]),
      160,
    ),
    itemDescription,
    contractQuantity: decimalValue(
      pick(row, ['qt_contrato', 'contractQuantity', 'QT_CONTRATO']),
    ),
    contractValue: decimalValue(
      pick(row, ['vl_contrato', 'contractValue', 'VL_CONTRATO']),
    ),
    measuredQuantity: decimalValue(
      pick(row, ['qt_medicao', 'measuredQuantity', 'QT_MEDICAO']),
    ),
    measuredPercentage: decimalValue(
      pick(row, ['pe_medicao', 'measuredPercentage', 'PE_MEDICAO']),
    ),
    measuredValue: decimalValue(
      pick(row, ['vl_medicao', 'measuredValue', 'VL_MEDICAO']),
    ),
    balanceQuantity: decimalValue(
      pick(row, ['qt_saldo', 'balanceQuantity', 'QT_SALDO']),
    ),
    balanceValue: decimalValue(
      pick(row, ['vl_saldo', 'balanceValue', 'VL_SALDO']),
    ),
    raw: row as Prisma.InputJsonValue,
  };
}

function normalizeMeasurement(row: Row): NormalizedMeasurement | null {
  const aethosMeasurementId = text(
    pick(row, [
      'aethos_id_obra_contrato_medicao',
      'aethosMeasurementId',
      'id_obra_contrato_medicao',
      'ID_OBRA_CONTRATO_MEDICAO',
    ]),
    160,
  );
  const aethosContractId = text(
    pick(row, [
      'aethos_id_obra_contrato',
      'aethosContractId',
      'id_obra_contrato',
      'ID_OBRA_CONTRATO',
    ]),
    160,
  );
  const aethosWorkId = text(
    pick(row, ['aethos_id_obra', 'aethosWorkId', 'id_obra', 'ID_OBRA']),
    160,
  );
  const workName = text(
    pick(row, ['nome_obra', 'workName', 'nm_obra', 'NM_OBRA']),
    500,
  );
  const contractorAethosId = text(
    pick(row, [
      'aethos_id_empreiteiro',
      'contractorAethosId',
      'id_empreiteiro',
      'ID_EMPREITEIRO',
    ]),
    160,
  );
  const contractorName = text(
    pick(row, ['empreiteiro', 'contractorName', 'nm_empreiteiro']),
    500,
  );

  if (
    !aethosMeasurementId ||
    !aethosContractId ||
    !aethosWorkId ||
    !workName ||
    !contractorAethosId ||
    !contractorName
  ) {
    return null;
  }

  const rawItems = pick(row, ['items', 'itens', 'detalhes', 'details']);
  const itemsProvided = Array.isArray(rawItems);
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? normalizeItem(item as Row, row)
        : null,
    )
    .filter((item): item is NormalizedItem => Boolean(item));

  const automaticData = {
    aethosMeasurementId,
    aethosContractId,
    aethosWorkId,
    workName,
    workContract: nullableText(
      pick(row, ['contrato_obra', 'workContract', 'nr_contrato']),
      300,
    ),
    contractorAethosId,
    contractorName,
    engineerAethosId: nullableText(
      pick(row, ['aethos_id_engenheiro', 'engineerAethosId', 'id_engenheiro']),
      160,
    ),
    engineerName: nullableText(
      pick(row, ['engenheiro', 'engineerName', 'nm_engenheiro']),
      500,
    ),
    measurementNumber: nullableText(
      pick(row, ['nr_medicao', 'measurementNumber', 'NR_MEDICAO']),
      120,
    ),
    measurementDescription: nullableText(
      pick(row, ['ds_medicao', 'measurementDescription', 'DS_MEDICAO']),
      12000,
    ),
    registeredAt: dateValue(
      pick(row, ['dt_cadastro', 'registeredAt', 'DT_CADASTRO']),
      'dt_cadastro',
    ),
    startDate: dateValue(
      pick(row, ['dt_inicial', 'startDate', 'DT_INICIAL']),
      'dt_inicial',
    ),
    endDate: dateValue(
      pick(row, ['dt_final', 'endDate', 'DT_FINAL']),
      'dt_final',
    ),
    competenceDate: dateValue(
      pick(row, ['dt_competencia', 'competenceDate', 'DT_COMPETENCIA']),
      'dt_competencia',
    ),
    dueDate: dateValue(
      pick(row, ['dt_vencimento', 'dueDate', 'DT_VENCIMENTO']),
      'dt_vencimento',
    ),
    finalizedAt: dateValue(
      pick(row, ['dt_finalizacao', 'finalizedAt', 'DT_FINALIZACAO']),
      'dt_finalizacao',
    ),
    finalized: booleanValue(
      pick(row, ['fl_finalizado', 'finalized', 'FL_FINALIZADO']),
    ),
    measurementValue: decimalValue(
      pick(row, ['vl_medicao', 'measurementValue', 'VL_MEDICAO']),
    ),
    discountValue: decimalValue(
      pick(row, ['vl_desconto', 'discountValue', 'VL_DESCONTO']),
    ),
    retentionValue: decimalValue(
      pick(row, ['vl_retencao', 'retentionValue', 'VL_RETENCAO']),
    ),
    totalValue: decimalValue(pick(row, ['vl_total', 'totalValue', 'VL_TOTAL'])),
    contractValue: decimalValue(
      pick(row, ['vl_contrato', 'contractValue', 'VL_CONTRATO']),
    ),
    totalMeasuredValue: decimalValue(
      pick(row, ['vl_total_medicao', 'totalMeasuredValue', 'VL_TOTAL_MEDICAO']),
    ),
    contractStatus: nullableText(
      pick(row, ['fl_status_contrato', 'contractStatus', 'FL_STATUS_CONTRATO']),
      120,
    ),
    measurementNotes: nullableText(
      pick(row, ['obs_medicao', 'measurementNotes', 'OBS_MEDICAO']),
      20000,
    ),
    contractNotes: nullableText(
      pick(row, ['obs_contrato', 'contractNotes', 'OBS_CONTRATO']),
      20000,
    ),
    source: nullableText(pick(row, ['source', 'origem']), 120) || 'AETHOS',
  };

  return {
    ...automaticData,
    raw: row as Prisma.InputJsonValue,
    contentHash: canonicalHash({
      ...automaticData,
      registeredAt: iso(automaticData.registeredAt),
      startDate: iso(automaticData.startDate),
      endDate: iso(automaticData.endDate),
      competenceDate: iso(automaticData.competenceDate),
      dueDate: iso(automaticData.dueDate),
      finalizedAt: iso(automaticData.finalizedAt),
      measurementValue: automaticData.measurementValue?.toString() ?? null,
      discountValue: automaticData.discountValue?.toString() ?? null,
      retentionValue: automaticData.retentionValue?.toString() ?? null,
      totalValue: automaticData.totalValue?.toString() ?? null,
      contractValue: automaticData.contractValue?.toString() ?? null,
      totalMeasuredValue: automaticData.totalMeasuredValue?.toString() ?? null,
      items: items.map((item) => ({
        ...item,
        raw: undefined,
        contractQuantity: item.contractQuantity?.toString() ?? null,
        contractValue: item.contractValue?.toString() ?? null,
        measuredQuantity: item.measuredQuantity?.toString() ?? null,
        measuredPercentage: item.measuredPercentage?.toString() ?? null,
        measuredValue: item.measuredValue?.toString() ?? null,
        balanceQuantity: item.balanceQuantity?.toString() ?? null,
        balanceValue: item.balanceValue?.toString() ?? null,
      })),
    }),
    items,
    itemsProvided,
  };
}

function toDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function daysUntil(target: Date, reference: Date) {
  return Math.ceil(
    (toDay(target).getTime() - toDay(reference).getTime()) / 86400000,
  );
}

function addCalendarDays(base: Date, days: number) {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addBusinessDays(base: Date, days: number) {
  const result = new Date(base);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

export function calculateContractorDocumentsTargetDate(
  deliveryDate?: Date | null,
  type?: string | null,
) {
  if (!deliveryDate || !text(type)) return null;
  const normalizedType = text(type).trim().toUpperCase();
  return addBusinessDays(deliveryDate, normalizedType === 'DIFERENCIADO' ? 2 : 5);
}

export function buildMeasurementOperationalStatus(
  measurement: {
    measurementApproved?: boolean | null;
    resolutionDate?: Date | null;
    engineerDeliveryDate?: Date | null;
    engineerDeliveryTargetDate?: Date | null;
    zanandraDeliveryDate?: Date | null;
    zanandraDeliveryTargetDate?: Date | null;
    invoiceRequestDate?: Date | null;
    invoiceRequestTargetDate?: Date | null;
    contractorDocumentsDeliveryDate?: Date | null;
    contractorDocumentsTargetDate?: Date | null;
  },
  reference = new Date(),
): {
  status: OperationalStatus;
  currentStage: string;
  daysToTarget: number | null;
} {
  if (measurement.measurementApproved === false) {
    return measurement.resolutionDate
      ? {
          status: 'RESOLVIDO',
          currentStage: 'Resolucao registrada',
          daysToTarget: null,
        }
      : {
          status: 'REPROVADO',
          currentStage: 'Medicao reprovada',
          daysToTarget: null,
        };
  }

  const stages = [
    {
      label: 'Entrega ao engenheiro',
      completed: measurement.engineerDeliveryDate,
      target: measurement.engineerDeliveryTargetDate,
    },
    {
      label: 'Entrega para Zanandra',
      completed: measurement.zanandraDeliveryDate,
      target: measurement.zanandraDeliveryTargetDate,
    },
    {
      label: 'Solicitacao da NF',
      completed: measurement.invoiceRequestDate,
      target: measurement.invoiceRequestTargetDate,
    },
    {
      label: 'Documentos dos empreiteiros',
      completed: measurement.contractorDocumentsDeliveryDate,
      target: measurement.contractorDocumentsTargetDate,
    },
  ];
  const current = stages.find((stage) => !stage.completed);
  if (!current) {
    return {
      status: 'CONCLUIDO',
      currentStage: 'Fluxo concluido',
      daysToTarget: null,
    };
  }
  if (!current.target) {
    return {
      status: 'PENDENTE',
      currentStage: current.label,
      daysToTarget: null,
    };
  }

  const remaining = daysUntil(current.target, reference);
  if (remaining < 0) {
    return {
      status: 'ATRASADO',
      currentStage: current.label,
      daysToTarget: remaining,
    };
  }
  if (remaining <= 2) {
    return {
      status: 'VENCENDO',
      currentStage: current.label,
      daysToTarget: remaining,
    };
  }
  return {
    status: 'NO_PRAZO',
    currentStage: current.label,
    daysToTarget: remaining,
  };
}

function mapSummary(measurement: any, reference = new Date()) {
  const operational = buildMeasurementOperationalStatus(measurement, reference);
  return {
    id: measurement.id,
    aethosMeasurementId: measurement.aethosMeasurementId,
    aethosContractId: measurement.aethosContractId,
    aethosWorkId: measurement.aethosWorkId,
    workName: measurement.workName,
    workContract: measurement.workContract,
    contractorAethosId: measurement.contractorAethosId,
    contractorName: measurement.contractorName,
    engineerAethosId: measurement.engineerAethosId,
    engineerName: measurement.engineerName,
    measurementNumber: measurement.measurementNumber,
    measurementDescription: measurement.measurementDescription,
    competenceDate: iso(measurement.competenceDate),
    dueDate: iso(measurement.dueDate),
    finalizedAt: iso(measurement.finalizedAt),
    finalized: measurement.finalized,
    totalValue: decimalNumber(measurement.totalValue),
    measurementValue: decimalNumber(measurement.measurementValue),
    type: measurement.type,
    measurementApproved: measurement.measurementApproved,
    resolutionDate: iso(measurement.resolutionDate),
    syncedAt: iso(measurement.syncedAt),
    updatedAt: iso(measurement.updatedAt),
    ...operational,
  };
}

function serializeMeasurement(measurement: any) {
  return {
    ...measurement,
    registeredAt: iso(measurement.registeredAt),
    startDate: iso(measurement.startDate),
    endDate: iso(measurement.endDate),
    competenceDate: iso(measurement.competenceDate),
    dueDate: iso(measurement.dueDate),
    finalizedAt: iso(measurement.finalizedAt),
    engineerDeliveryDate: iso(measurement.engineerDeliveryDate),
    engineerDeliveryTargetDate: iso(measurement.engineerDeliveryTargetDate),
    resolutionDate: iso(measurement.resolutionDate),
    zanandraDeliveryDate: iso(measurement.zanandraDeliveryDate),
    invoiceRequestDate: iso(measurement.invoiceRequestDate),
    contractorDocumentsDeliveryDate: iso(
      measurement.contractorDocumentsDeliveryDate,
    ),
    zanandraDeliveryTargetDate: iso(measurement.zanandraDeliveryTargetDate),
    invoiceRequestTargetDate: iso(measurement.invoiceRequestTargetDate),
    contractorDocumentsTargetDate: iso(
      measurement.contractorDocumentsTargetDate,
    ),
    actualPaymentDate: iso(measurement.actualPaymentDate),
    syncedAt: iso(measurement.syncedAt),
    createdAt: iso(measurement.createdAt),
    updatedAt: iso(measurement.updatedAt),
    measurementValue: decimalNumber(measurement.measurementValue),
    discountValue: decimalNumber(measurement.discountValue),
    retentionValue: decimalNumber(measurement.retentionValue),
    totalValue: decimalNumber(measurement.totalValue),
    contractValue: decimalNumber(measurement.contractValue),
    totalMeasuredValue: decimalNumber(measurement.totalMeasuredValue),
    items: (measurement.items || []).map((item: any) => ({
      ...item,
      contractQuantity: decimalNumber(item.contractQuantity),
      contractValue: decimalNumber(item.contractValue),
      measuredQuantity: decimalNumber(item.measuredQuantity),
      measuredPercentage: decimalNumber(item.measuredPercentage),
      measuredValue: decimalNumber(item.measuredValue),
      balanceQuantity: decimalNumber(item.balanceQuantity),
      balanceValue: decimalNumber(item.balanceValue),
      syncedAt: iso(item.syncedAt),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
    })),
    history: (measurement.history || []).map((entry: any) => ({
      ...entry,
      createdAt: iso(entry.createdAt),
    })),
    operational: buildMeasurementOperationalStatus(measurement),
  };
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function commaValues(value: unknown) {
  return text(value)
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

@Injectable()
export class ThirdPartyMeasurementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async applyConfiguredTargets(
    tx: Prisma.TransactionClient,
    measurementId: string,
  ) {
    const [measurement, slas] = await Promise.all([
      tx.thirdPartyMeasurement.findUnique({ where: { id: measurementId } }),
      tx.thirdPartyMeasurementSla.findMany({
        where: { active: true, days: { not: null } },
      }),
    ]);
    if (!measurement || !slas.length) return;

    const measurementRecord = measurement as unknown as Record<string, unknown>;
    const targetUpdates: Record<string, Date> = {};
    for (const sla of slas) {
      const currentTarget = measurementRecord[sla.targetDateField];
      const base = measurementRecord[sla.baseDateField];
      if (currentTarget || !(base instanceof Date) || sla.days === null)
        continue;
      targetUpdates[sla.targetDateField] =
        sla.unit === 'CALENDAR_DAYS'
          ? addCalendarDays(base, sla.days)
          : addBusinessDays(base, sla.days);
    }
    if (!Object.keys(targetUpdates).length) return;

    await tx.thirdPartyMeasurement.update({
      where: { id: measurementId },
      data: targetUpdates as Prisma.ThirdPartyMeasurementUpdateInput,
    });
  }

  async syncFromAethos(body: unknown) {
    const sourceRows = listFromBody(body);
    if (!sourceRows.length) {
      throw new BadRequestException('Nenhuma medicao terceiro recebida');
    }
    if (sourceRows.length > MAX_SYNC_ROWS) {
      throw new BadRequestException(
        `O lote excede o limite de ${MAX_SYNC_ROWS} medicoes`,
      );
    }

    const normalized = sourceRows
      .map((row) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? normalizeMeasurement(row as Row)
          : null,
      )
      .filter((row): row is NormalizedMeasurement => Boolean(row));
    if (!normalized.length) {
      throw new BadRequestException(
        'Nenhuma medicao valida. Confira os campos obrigatorios do payload.',
      );
    }
    const ids = normalized.map((row) => row.aethosMeasurementId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'O lote contem IDs de medicao Aethos duplicados',
      );
    }
    const allItemIds = normalized.flatMap((row) =>
      row.items.map((item) => item.aethosMeasurementItemId),
    );
    if (new Set(allItemIds).size !== allItemIds.length) {
      throw new BadRequestException(
        'O lote contem IDs de itens de medicao Aethos duplicados',
      );
    }

    const execute =
      body && typeof body === 'object' && !Array.isArray(body)
        ? booleanValue((body as Row).execute, false)
        : false;
    const current = await this.prisma.thirdPartyMeasurement.findMany({
      where: { aethosMeasurementId: { in: ids } },
      select: { aethosMeasurementId: true, contentHash: true },
    });
    const currentById = new Map(
      current.map((row) => [row.aethosMeasurementId, row.contentHash]),
    );
    const createdCount = normalized.filter(
      (row) => !currentById.has(row.aethosMeasurementId),
    ).length;
    const updatedCount = normalized.filter(
      (row) =>
        currentById.has(row.aethosMeasurementId) &&
        currentById.get(row.aethosMeasurementId) !== row.contentHash,
    ).length;
    const unchangedCount = normalized.length - createdCount - updatedCount;

    if (execute) {
      const syncedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        for (const row of normalized) {
          const { items, itemsProvided, ...automatic } = row;
          const saved = await tx.thirdPartyMeasurement.upsert({
            where: { aethosMeasurementId: row.aethosMeasurementId },
            create: { ...automatic, syncedAt },
            update: { ...automatic, syncedAt },
            select: { id: true },
          });

          await this.applyConfiguredTargets(tx, saved.id);

          if (!itemsProvided) continue;
          const itemIds = items.map((item) => item.aethosMeasurementItemId);
          if (itemIds.length) {
            await tx.thirdPartyMeasurementItem.deleteMany({
              where: {
                measurementId: saved.id,
                aethosMeasurementItemId: { notIn: itemIds },
              },
            });
          } else {
            await tx.thirdPartyMeasurementItem.deleteMany({
              where: { measurementId: saved.id },
            });
          }

          for (const item of items) {
            await tx.thirdPartyMeasurementItem.upsert({
              where: {
                aethosMeasurementItemId: item.aethosMeasurementItemId,
              },
              create: { ...item, measurementId: saved.id, syncedAt },
              update: { ...item, measurementId: saved.id, syncedAt },
            });
          }
        }
      });
    }

    return {
      ok: true,
      executed: execute,
      received: sourceRows.length,
      validCount: normalized.length,
      rejectedCount: sourceRows.length - normalized.length,
      createdCount,
      updatedCount,
      unchangedCount,
      itemCount: normalized.reduce((sum, row) => sum + row.items.length, 0),
      message: execute
        ? 'Medicoes terceiro sincronizadas com sucesso.'
        : 'Dry-run concluido. Repita o payload com execute=true para gravar.',
    };
  }

  async findAll(query: Record<string, unknown>, role?: string | null) {
    ensureThirdPartyMeasurementAccess(role);
    const rows = await this.prisma.thirdPartyMeasurement.findMany({
      orderBy: [{ competenceDate: 'desc' }, { registeredAt: 'desc' }],
    });
    const search = text(query.search).toLowerCase();
    const work = text(query.work).toLowerCase();
    const contractor = text(query.contractor).toLowerCase();
    const engineer = text(query.engineer).toLowerCase();
    const competence = text(query.competence);
    const dueFrom = dateValue(query.dueFrom, 'dueFrom');
    const dueTo = dateValue(query.dueTo, 'dueTo');
    const finalizedFilter = text(query.finalized).toLowerCase();
    const statuses = new Set(commaValues(query.status));

    const mapped = rows.map((row) => mapSummary(row));
    const filtered = mapped.filter((row) => {
      const haystack = [
        row.workName,
        row.workContract,
        row.contractorName,
        row.engineerName,
        row.measurementNumber,
        row.measurementDescription,
        row.aethosMeasurementId,
      ]
        .join(' ')
        .toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (work && !row.workName.toLowerCase().includes(work)) return false;
      if (
        contractor &&
        !row.contractorName.toLowerCase().includes(contractor)
      ) {
        return false;
      }
      if (
        engineer &&
        !(row.engineerName || '').toLowerCase().includes(engineer)
      ) {
        return false;
      }
      if (
        competence &&
        !String(row.competenceDate || '').startsWith(competence)
      ) {
        return false;
      }
      if (dueFrom && (!row.dueDate || new Date(row.dueDate) < dueFrom))
        return false;
      if (dueTo && (!row.dueDate || new Date(row.dueDate) > dueTo))
        return false;
      if (finalizedFilter === 'true' && !row.finalized) return false;
      if (finalizedFilter === 'false' && row.finalized) return false;
      if (statuses.size && !statuses.has(row.status)) return false;
      if (
        text(query.late).toLowerCase() === 'true' &&
        row.status !== 'ATRASADO'
      ) {
        return false;
      }
      return true;
    });
    const page = positiveInteger(query.page, 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      positiveInteger(query.pageSize, DEFAULT_PAGE_SIZE),
    );
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const statusCounts = filtered.reduce<Record<string, number>>(
      (counts, row) => {
        counts[row.status] = (counts[row.status] || 0) + 1;
        return counts;
      },
      {},
    );

    return {
      rows: pageRows,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      },
      summary: {
        total: filtered.length,
        totalValue: filtered.reduce((sum, row) => sum + row.totalValue, 0),
        statusCounts,
      },
      options: {
        works: [...new Set(rows.map((row) => row.workName))].sort(),
        contractors: [...new Set(rows.map((row) => row.contractorName))].sort(),
        engineers: [
          ...new Set(rows.map((row) => row.engineerName).filter(Boolean)),
        ].sort(),
      },
    };
  }

  async findOne(id: string, role?: string | null) {
    ensureThirdPartyMeasurementAccess(role);
    const measurement = await this.prisma.thirdPartyMeasurement.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ itemDescription: 'asc' }] },
        history: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!measurement) throw new NotFoundException('Medicao nao encontrada');
    return serializeMeasurement(measurement);
  }

  async listItems(id: string, role?: string | null) {
    const measurement = await this.findOne(id, role);
    return measurement.items;
  }

  async updateAdministrativeData(
    id: string,
    body: Record<string, unknown>,
    role: string | null | undefined,
    actor: { id?: string | null; name?: string | null },
  ) {
    ensureThirdPartyMeasurementAccess(role);
    const current = await this.prisma.thirdPartyMeasurement.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Medicao nao encontrada');

    const data: Record<string, unknown> = {};
    const changedFields: Record<string, { before: unknown; after: unknown }> =
      {};
    const dateFields = new Set<ManualField>([
      'engineerDeliveryDate',
      'engineerDeliveryTargetDate',
      'resolutionDate',
      'zanandraDeliveryDate',
      'invoiceRequestDate',
      'contractorDocumentsDeliveryDate',
      'zanandraDeliveryTargetDate',
      'invoiceRequestTargetDate',
      'actualPaymentDate',
    ]);

    for (const field of MANUAL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      const value = dateFields.has(field)
        ? dateValue(body[field], field)
        : field === 'measurementApproved'
          ? nullableBoolean(body[field])
          : nullableText(body[field], 20000);
      const before = (current as any)[field];
      const beforeComparable =
        before instanceof Date ? before.toISOString() : before;
      const afterComparable =
        value instanceof Date ? value.toISOString() : value;
      if (beforeComparable === afterComparable) continue;
      data[field] = value;
      changedFields[field] = {
        before: beforeComparable,
        after: afterComparable,
      };
    }

    const contractorDocumentsRuleChanged =
      Object.prototype.hasOwnProperty.call(
        data,
        'contractorDocumentsDeliveryDate',
      ) || Object.prototype.hasOwnProperty.call(data, 'type');
    if (contractorDocumentsRuleChanged) {
      const nextDeliveryDate = Object.prototype.hasOwnProperty.call(
        data,
        'contractorDocumentsDeliveryDate',
      )
        ? (data.contractorDocumentsDeliveryDate as Date | null)
        : current.contractorDocumentsDeliveryDate;
      const nextType = Object.prototype.hasOwnProperty.call(data, 'type')
        ? (data.type as string | null)
        : current.type;
      const calculatedTarget = calculateContractorDocumentsTargetDate(
        nextDeliveryDate,
        nextType,
      );
      const beforeTarget = current.contractorDocumentsTargetDate?.toISOString() ?? null;
      const afterTarget = calculatedTarget?.toISOString() ?? null;
      if (beforeTarget !== afterTarget) {
        data.contractorDocumentsTargetDate = calculatedTarget;
        changedFields.contractorDocumentsTargetDate = {
          before: beforeTarget,
          after: afterTarget,
        };
      }
    }

    const nextApproved = Object.prototype.hasOwnProperty.call(
      data,
      'measurementApproved',
    )
      ? (data.measurementApproved as boolean | null)
      : current.measurementApproved;
    const nextRejectionReason = Object.prototype.hasOwnProperty.call(
      data,
      'rejectionReason',
    )
      ? data.rejectionReason
      : current.rejectionReason;
    if (nextApproved === false && !text(nextRejectionReason)) {
      throw new BadRequestException(
        'Informe o motivo da reprovacao da medicao.',
      );
    }
    if (!Object.keys(data).length) return this.findOne(id, role);

    await this.prisma.$transaction(async (tx) => {
      await tx.thirdPartyMeasurement.update({ where: { id }, data });
      await this.applyConfiguredTargets(tx, id);
      await tx.thirdPartyMeasurementHistory.create({
        data: {
          measurementId: id,
          action: 'ADMINISTRATIVE_UPDATE',
          changedFields: changedFields as Prisma.InputJsonValue,
          actorId: nullableText(actor.id, 160),
          actorName: nullableText(actor.name, 500),
        },
      });
    });
    return this.findOne(id, role);
  }

  async listSlas(role?: string | null) {
    ensureThirdPartyMeasurementAccess(role);
    return this.prisma.thirdPartyMeasurementSla.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateSla(
    key: string,
    body: Record<string, unknown>,
    role?: string | null,
  ) {
    ensureThirdPartyMeasurementAccess(role);
    const current = await this.prisma.thirdPartyMeasurementSla.findUnique({
      where: { key },
    });
    if (!current) throw new NotFoundException('Regra de prazo nao encontrada');
    const unit = text(body.unit || current.unit).toUpperCase();
    if (!SLA_UNITS.has(unit)) {
      throw new BadRequestException('Unidade de prazo invalida');
    }
    const days =
      body.days === null || text(body.days) === ''
        ? null
        : Math.max(0, Number(body.days));
    if (days !== null && (!Number.isFinite(days) || !Number.isInteger(days))) {
      throw new BadRequestException('Quantidade de dias invalida');
    }
    return this.prisma.thirdPartyMeasurementSla.update({
      where: { key },
      data: {
        days,
        unit,
        active: booleanValue(body.active, current.active),
      },
    });
  }
}
