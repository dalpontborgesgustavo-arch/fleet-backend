import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  USINA_COMPANY_ID,
  USINA_PRODUCTION_BATCH_LIMIT,
  USINA_UNIT_ID,
} from './usina-production-sync.rules';

export const USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET =
  'FLEET_MAINTENANCE_LABOR_ALLOCATIONS' as const;
export const USINA_FLEET_MAINTENANCE_LABOR_SOURCE_SENTENCE =
  'IND.BI.0035' as const;

type AnyRow = Record<string, unknown>;
export type FleetLaborTargetCostClass = 'CARREGADEIRAS' | 'VEICULO_USINA';
export type FleetLaborRateGroup = 'VEICULOS' | 'CAMINHOES' | 'MAQUINAS';

export interface NormalizedFleetMaintenanceLaborAllocationEnvelope {
  dataset: typeof USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET;
  syncMode: 'incremental' | 'full';
  syncRunId: string;
  generatedAt: Date;
  scope: {
    company: typeof USINA_COMPANY_ID;
    unit: typeof USINA_UNIT_ID;
    aethosVehicleIds: number[];
    monthlyConfigurationsHash: string;
    dateFrom: Date;
    dateTo: Date;
  };
  batchNumber: number;
  isLastBatch: boolean;
  rows: unknown[];
}

export interface NormalizedFleetMaintenanceLaborAllocationRow {
  index: number;
  source: 'AETHOS';
  sourceRecordId: string;
  competence: Date;
  aethosVehicleId: number;
  fleetNumber: number;
  targetCostClass: FleetLaborTargetCostClass;
  vehicleExpenseAmount: Prisma.Decimal;
  rateGroup: FleetLaborRateGroup;
  groupShare: Prisma.Decimal;
  groupExpenseBase: Prisma.Decimal;
  eligibleLaborPoolAmount: Prisma.Decimal;
  allocatedLaborAmount: Prisma.Decimal;
  expectedLineAmount: Prisma.Decimal;
  sourceSentence: typeof USINA_FLEET_MAINTENANCE_LABOR_SOURCE_SENTENCE;
  sourceGeneratedAt: Date;
  sourceUpdatedAt: Date | null;
  contentHash: string;
  active: boolean;
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

function decimal(value: unknown, field: string) {
  if (value === null || value === undefined || value === '')
    throw new BadRequestException(`${field} e obrigatorio`);
  const raw = String(value).trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,12})?$/.test(raw))
    throw new BadRequestException(`${field} deve ser decimal com ate 12 casas`);
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

function assertAlmostEqual(
  actual: Prisma.Decimal,
  expected: Prisma.Decimal,
  field: string,
) {
  if (actual.minus(expected).abs().gt(new Prisma.Decimal('0.000001')))
    throw new BadRequestException(`${field} diverge da formula do rateio`);
}

export function normalizeUsinaFleetMaintenanceLaborAllocationEnvelope(
  body: unknown,
): NormalizedFleetMaintenanceLaborAllocationEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Envelope invalido');
  const payload = body as AnyRow;
  if (
    text(payload.dataset, 'dataset', 80).toUpperCase() !==
    USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET
  )
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
  if (!Array.isArray(scope.aethosVehicleIds) || !scope.aethosVehicleIds.length)
    throw new BadRequestException('scope.aethosVehicleIds e obrigatorio');
  const aethosVehicleIds = scope.aethosVehicleIds.map((value) =>
    integer(value, 'scope.aethosVehicleIds'),
  );
  if (new Set(aethosVehicleIds).size !== aethosVehicleIds.length)
    throw new BadRequestException('scope.aethosVehicleIds contem duplicidade');
  const monthlyConfigurationsHash = text(
    scope.monthlyConfigurationsHash,
    'scope.monthlyConfigurationsHash',
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(monthlyConfigurationsHash))
    throw new BadRequestException(
      'scope.monthlyConfigurationsHash deve ser SHA-256 hexadecimal',
    );
  const dateFrom = dateOnly(scope.dateFrom, 'scope.dateFrom');
  const dateTo = dateOnly(scope.dateTo, 'scope.dateTo');
  if (dateFrom > dateTo) throw new BadRequestException('scope invalido');
  const batchNumber = integer(payload.batchNumber, 'batchNumber');
  if (
    !Array.isArray(payload.rows) ||
    payload.rows.length > USINA_PRODUCTION_BATCH_LIMIT
  )
    throw new BadRequestException('rows deve ter ate 500 linhas');
  return {
    dataset: USINA_FLEET_MAINTENANCE_LABOR_ALLOCATION_DATASET,
    syncMode,
    syncRunId: text(payload.syncRunId, 'syncRunId', 200),
    generatedAt: date(payload.generatedAt, 'generatedAt'),
    scope: {
      company: USINA_COMPANY_ID,
      unit: USINA_UNIT_ID,
      aethosVehicleIds,
      monthlyConfigurationsHash,
      dateFrom,
      dateTo,
    },
    batchNumber,
    isLastBatch: bool(payload.isLastBatch, 'isLastBatch'),
    rows: payload.rows,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Linha invalida';
}

export function normalizeUsinaFleetMaintenanceLaborAllocationRows(
  rows: unknown[],
  envelope: NormalizedFleetMaintenanceLaborAllocationEnvelope,
) {
  const accepted: NormalizedFleetMaintenanceLaborAllocationRow[] = [];
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
      const competence = dateOnly(row.competence, 'competence');
      if (competence.getUTCDate() !== 1)
        throw new BadRequestException(
          'competence deve ser o primeiro dia do mes',
        );
      if (
        competence < envelope.scope.dateFrom ||
        competence > envelope.scope.dateTo
      )
        throw new BadRequestException('competence fora do scope');
      const aethosVehicleId = integer(row.aethosVehicleId, 'aethosVehicleId');
      if (!envelope.scope.aethosVehicleIds.includes(aethosVehicleId))
        throw new BadRequestException('aethosVehicleId fora do scope');
      const sourceRecordId = text(row.sourceRecordId, 'sourceRecordId', 200);
      const canonicalId = `${competence.toISOString().slice(0, 10)}|${aethosVehicleId}`;
      if (sourceRecordId !== canonicalId)
        throw new BadRequestException(
          'sourceRecordId deve ser COMPETENCIA|ID_VEICULO_AETHOS',
        );
      key = `AETHOS|${sourceRecordId}`;
      if (seen.has(key))
        throw new BadRequestException('Chave repetida no lote');
      seen.add(key);
      const targetCostClass = text(
        row.targetCostClass,
        'targetCostClass',
        30,
      ).toUpperCase() as FleetLaborTargetCostClass;
      if (!['CARREGADEIRAS', 'VEICULO_USINA'].includes(targetCostClass))
        throw new BadRequestException('targetCostClass invalido');
      const rateGroup = text(
        row.rateGroup,
        'rateGroup',
        20,
      ).toUpperCase() as FleetLaborRateGroup;
      if (!['VEICULOS', 'CAMINHOES', 'MAQUINAS'].includes(rateGroup))
        throw new BadRequestException('rateGroup invalido');
      const expectedGroup =
        targetCostClass === 'CARREGADEIRAS' ? 'MAQUINAS' : 'VEICULOS';
      if (rateGroup !== expectedGroup)
        throw new BadRequestException(
          'rateGroup incompativel com targetCostClass',
        );
      const groupShare = decimal(row.groupShare, 'groupShare');
      const expectedShare = new Prisma.Decimal(
        targetCostClass === 'CARREGADEIRAS' ? '0.475000' : '0.050000',
      );
      if (!groupShare.equals(expectedShare))
        throw new BadRequestException('groupShare invalido para o grupo');
      const vehicleExpenseAmount = decimal(
        row.vehicleExpenseAmount,
        'vehicleExpenseAmount',
      );
      const groupExpenseBase = decimal(
        row.groupExpenseBase,
        'groupExpenseBase',
      );
      const eligibleLaborPoolAmount = decimal(
        row.eligibleLaborPoolAmount,
        'eligibleLaborPoolAmount',
      );
      const allocatedLaborAmount = decimal(
        row.allocatedLaborAmount,
        'allocatedLaborAmount',
      );
      const expectedLineAmount = decimal(
        row.expectedLineAmount,
        'expectedLineAmount',
      );
      if (
        [
          vehicleExpenseAmount,
          groupExpenseBase,
          eligibleLaborPoolAmount,
          allocatedLaborAmount,
          expectedLineAmount,
        ].some((amount) => amount.lt(0))
      )
        throw new BadRequestException(
          'Valores monetarios devem ser nao negativos',
        );
      if (groupExpenseBase.lte(0))
        throw new BadRequestException('groupExpenseBase deve ser positivo');
      assertAlmostEqual(
        allocatedLaborAmount,
        vehicleExpenseAmount
          .div(groupExpenseBase)
          .mul(eligibleLaborPoolAmount)
          .mul(groupShare),
        'allocatedLaborAmount',
      );
      assertAlmostEqual(
        expectedLineAmount,
        vehicleExpenseAmount.plus(allocatedLaborAmount),
        'expectedLineAmount',
      );
      const sourceSentence = text(
        row.sourceSentence,
        'sourceSentence',
        30,
      ).toUpperCase();
      if (sourceSentence !== USINA_FLEET_MAINTENANCE_LABOR_SOURCE_SENTENCE)
        throw new BadRequestException('sourceSentence deve ser IND.BI.0035');
      const contentHash = text(
        row.contentHash,
        'contentHash',
        64,
      ).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(contentHash))
        throw new BadRequestException(
          'contentHash deve ser SHA-256 hexadecimal',
        );
      accepted.push({
        index,
        source: 'AETHOS',
        sourceRecordId,
        competence,
        aethosVehicleId,
        fleetNumber: integer(row.fleetNumber, 'fleetNumber'),
        targetCostClass,
        vehicleExpenseAmount,
        rateGroup,
        groupShare,
        groupExpenseBase,
        eligibleLaborPoolAmount,
        allocatedLaborAmount,
        expectedLineAmount,
        sourceSentence: USINA_FLEET_MAINTENANCE_LABOR_SOURCE_SENTENCE,
        sourceGeneratedAt:
          row.sourceGeneratedAt === null || row.sourceGeneratedAt === undefined
            ? envelope.generatedAt
            : date(row.sourceGeneratedAt, 'sourceGeneratedAt'),
        sourceUpdatedAt:
          row.sourceUpdatedAt === null || row.sourceUpdatedAt === undefined
            ? null
            : date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
        contentHash,
        active: row.active === undefined ? true : bool(row.active, 'active'),
        raw: row as Prisma.InputJsonValue,
      });
    } catch (error) {
      rejected.push({ index, key, reason: errorMessage(error) });
    }
  });
  return { accepted, rejected };
}
