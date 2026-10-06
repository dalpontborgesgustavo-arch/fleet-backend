import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export const LUCAS_FLEET_REVENUE_SCHEMA = 'lucas-fleet-revenue.v1';
export const LUCAS_FLEET_REVENUE_DATASET = 'FLEET_REVENUE_PBI';
export const LUCAS_FLEET_REVENUE_SOURCE = 'AETHOS';
export const LUCAS_FLEET_REVENUE_BATCH_LIMIT = 500;
// Prisma.Decimal defaults to 20 significant digits. Revenue reconciliation must
// retain the database's Decimal(65,30) precision across sums.
export const LucasFleetRevenueDecimal = Prisma.Decimal.clone({ precision: 65 });
export const LUCAS_FLEET_REVENUE_BRANCHES = [
  'AVI',
  'CTR',
  'FES',
  'FPE',
  'FRE',
  'OSE',
  'RVI',
  'VGI',
] as const;

type JsonObject = Record<string, unknown>;
type RevenueBranch = (typeof LUCAS_FLEET_REVENUE_BRANCHES)[number];
export type LucasFleetRevenueBranchCompanyScope = {
  sourceKind: RevenueBranch;
  selection: 'COMPANY_IDS' | 'ALL_NATIVE_COMPANIES';
  companyIds: string[] | null;
};

export function lucasFleetRevenueWireHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function object(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${field} deve ser um objeto`);
  }
  return value as JsonObject;
}

function json(value: unknown, field: string): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    throw new BadRequestException(`${field} deve ser JSON valido`);
  }
}

function text(value: unknown, field: string, max = 300): string {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(`${field} e obrigatorio`);
  if (result.length > max) {
    throw new BadRequestException(`${field} excede ${max} caracteres`);
  }
  return result;
}

function optionalText(value: unknown, field: string, max = 300) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return text(value, field, max);
}

function positiveInteger(value: unknown, field: string) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new BadRequestException(`${field} deve ser inteiro positivo`);
  }
  return result;
}

function nonNegativeInteger(value: unknown, field: string) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException(`${field} deve ser inteiro nao negativo`);
  }
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new BadRequestException(`${field} deve ser inteiro nao negativo`);
  }
  return result;
}

function boolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} deve ser booleano`);
  }
  return value;
}

function dateOnly(value: unknown, field: string) {
  const input = text(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const result = new Date(`${input}T00:00:00.000Z`);
  if (
    Number.isNaN(result.getTime()) ||
    result.toISOString().slice(0, 10) !== input
  ) {
    throw new BadRequestException(`${field} invalida`);
  }
  return result;
}

function competence(value: unknown, eventDate: Date) {
  const input = text(value, 'competence', 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input)) {
    throw new BadRequestException('competence deve estar no formato AAAA-MM');
  }
  if (input !== eventDate.toISOString().slice(0, 7)) {
    throw new BadRequestException('competence diverge de eventDate');
  }
  return new Date(`${input}-01T00:00:00.000Z`);
}

function instant(value: unknown, field: string) {
  const input = text(value, field, 80);
  const result = new Date(input);
  if (Number.isNaN(result.getTime())) {
    throw new BadRequestException(`${field} invalida`);
  }
  return result;
}

function optionalInstant(value: unknown, field: string) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return instant(value, field);
}

function sha256(value: unknown, field: string) {
  const result = text(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new BadRequestException(`${field} deve ser SHA-256 hexadecimal`);
  }
  return result;
}

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException(`${field} deve ser uma lista nao vazia`);
  }
  const result = [
    ...new Set(
      value.map((entry, index) => text(entry, `${field}[${index}]`, 100)),
    ),
  ];
  return result.sort();
}

function optionalStringArray(value: unknown, field: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} deve ser uma lista`);
  }
  return [
    ...new Set(
      value.map((entry, index) => text(entry, `${field}[${index}]`, 700)),
    ),
  ].sort();
}

function nullableDecimal(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null;
  const input = String(value).trim();
  if (!/^-?\d{1,35}(?:\.\d{1,30})?$/.test(input)) {
    throw new BadRequestException(
      `${field} deve ser decimal em string com ate 30 casas`,
    );
  }
  const integerDigits = input.replace('-', '').split('.')[0].length;
  if (integerDigits > 35) {
    throw new BadRequestException(`${field} excede a precisao decimal`);
  }
  try {
    const result = new Prisma.Decimal(input);
    if (!result.isFinite() || result.precision(true) > 65) throw new Error();
    return result;
  } catch {
    throw new BadRequestException(`${field} deve ser decimal valido`);
  }
}

function branch(value: unknown) {
  const result = text(value, 'sourceKind', 10).toUpperCase();
  if (!(LUCAS_FLEET_REVENUE_BRANCHES as readonly string[]).includes(result)) {
    throw new BadRequestException(
      'sourceKind deve ser AVI, CTR, FES, FPE, FRE, OSE, RVI ou VGI',
    );
  }
  return result as RevenueBranch;
}

function normalizeBranchCompanyScopes(
  value: unknown,
): LucasFleetRevenueBranchCompanyScope[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(
      'scope.branchCompanyScopes deve ser uma lista',
    );
  }
  const scopes = value.map((entry, index) => {
    const input = object(entry, `scope.branchCompanyScopes[${index}]`);
    const sourceKind = branch(input.sourceKind);
    const selection = text(
      input.selection,
      `scope.branchCompanyScopes[${index}].selection`,
      30,
    ).toUpperCase();
    if (selection !== 'COMPANY_IDS' && selection !== 'ALL_NATIVE_COMPANIES') {
      throw new BadRequestException(
        'branchCompanyScopes.selection deve ser COMPANY_IDS ou ALL_NATIVE_COMPANIES',
      );
    }
    const rawCompanyIds = input.companyIds;
    const companyIds =
      rawCompanyIds === null || rawCompanyIds === undefined
        ? null
        : Array.isArray(rawCompanyIds)
          ? [
              ...new Set(
                rawCompanyIds.map((companyId, companyIndex) =>
                  String(
                    positiveInteger(
                      companyId,
                      `scope.branchCompanyScopes[${index}].companyIds[${companyIndex}]`,
                    ),
                  ),
                ),
              ),
            ].sort()
          : (() => {
              throw new BadRequestException(
                `scope.branchCompanyScopes[${index}].companyIds deve ser lista ou null`,
              );
            })();
    if (selection === 'COMPANY_IDS' && (!companyIds || !companyIds.length)) {
      throw new BadRequestException(
        `scope.branchCompanyScopes[${index}] exige companyIds`,
      );
    }
    if (selection === 'ALL_NATIVE_COMPANIES' && companyIds !== null) {
      throw new BadRequestException(
        `scope.branchCompanyScopes[${index}] deve usar companyIds null`,
      );
    }
    return {
      sourceKind,
      selection: selection as 'COMPANY_IDS' | 'ALL_NATIVE_COMPANIES',
      companyIds,
    };
  });
  const uniqueBranches = new Set(scopes.map((entry) => entry.sourceKind));
  if (
    uniqueBranches.size !== LUCAS_FLEET_REVENUE_BRANCHES.length ||
    LUCAS_FLEET_REVENUE_BRANCHES.some(
      (sourceKind) => !uniqueBranches.has(sourceKind),
    )
  ) {
    throw new BadRequestException(
      'scope.branchCompanyScopes deve definir exatamente os oito ramos',
    );
  }
  for (const entry of scopes) {
    const isUnfiltered =
      entry.sourceKind === 'OSE' || entry.sourceKind === 'VGI';
    if (isUnfiltered && entry.selection !== 'ALL_NATIVE_COMPANIES') {
      throw new BadRequestException(
        `${entry.sourceKind} deve manter todas as empresas nativas`,
      );
    }
    if (
      !isUnfiltered &&
      (entry.selection !== 'COMPANY_IDS' ||
        entry.companyIds?.join(',') !== '1,4')
    ) {
      throw new BadRequestException(
        `${entry.sourceKind} deve manter somente empresas 1 e 4`,
      );
    }
  }
  return scopes;
}

function canonicalRecord(value: JsonObject) {
  return {
    source: value.source,
    sourceKind: value.sourceKind,
    nativeKey: value.nativeKey,
    nativeLocator: value.nativeLocator,
    companyId: value.companyId,
    sourceKey: value.sourceKey,
    vehicleId: value.vehicleId,
    eventDate: value.eventDate,
    competence: value.competence,
    amount: value.amount,
    sourceStatus: value.sourceStatus,
    active: value.active,
    sourceUpdatedAt: value.sourceUpdatedAt,
    planAccountId: value.planAccountId,
  };
}

export type NormalizedLucasFleetRevenueRecord = {
  source: typeof LUCAS_FLEET_REVENUE_SOURCE;
  nativeLocator: string;
  sourceKind: RevenueBranch;
  nativeKey: Prisma.InputJsonValue;
  companyId: string;
  sourceKey: string;
  aethosVehicleId: string;
  eventDate: Date;
  competence: Date;
  amount: Prisma.Decimal | null;
  sourceStatus: string | null;
  active: boolean;
  sourceUpdatedAt: Date | null;
  planAccountId: string | number | null;
  recordHash: string;
  raw: Prisma.InputJsonValue;
};

function normalizeRecord(
  value: unknown,
  scope: {
    dateFrom: Date;
    dateToExclusive: Date;
    branches: string[];
    branchCompanyScopes: LucasFleetRevenueBranchCompanyScope[];
    recheckedNativeLocators: string[];
  },
): NormalizedLucasFleetRevenueRecord {
  const row = object(value, 'record');
  const sourceKind = branch(row.sourceKind);
  if (!scope.branches.includes(sourceKind)) {
    throw new BadRequestException(`sourceKind ${sourceKind} fora do scope`);
  }
  const nativeKey = json(object(row.nativeKey, 'nativeKey'), 'nativeKey');
  const nativeLocator = text(row.nativeLocator, 'nativeLocator', 700);
  const source = text(row.source, 'record.source', 40);
  if (source !== LUCAS_FLEET_REVENUE_SOURCE) {
    throw new BadRequestException(
      `record.source deve ser ${LUCAS_FLEET_REVENUE_SOURCE}`,
    );
  }
  if (typeof row.companyId !== 'number') {
    throw new BadRequestException('companyId deve ser numero no wire');
  }
  const companyId = String(positiveInteger(row.companyId, 'companyId'));
  const companyScope = scope.branchCompanyScopes.find(
    (entry) => entry.sourceKind === sourceKind,
  );
  if (
    !companyScope ||
    (companyScope.selection === 'COMPANY_IDS' &&
      !companyScope.companyIds?.includes(companyId))
  ) {
    throw new BadRequestException(`companyId ${companyId} fora do scope`);
  }
  const sourceKey = text(row.sourceKey, 'sourceKey', 800);
  if (typeof row.vehicleId !== 'number') {
    throw new BadRequestException('vehicleId deve ser numero no wire');
  }
  const aethosVehicleId = String(positiveInteger(row.vehicleId, 'vehicleId'));
  const eventDate = dateOnly(row.eventDate, 'eventDate');
  if (
    (eventDate < scope.dateFrom || eventDate >= scope.dateToExclusive) &&
    !scope.recheckedNativeLocators.includes(nativeLocator)
  ) {
    throw new BadRequestException('eventDate fora do scope');
  }
  if (row.amount !== null && typeof row.amount !== 'string') {
    throw new BadRequestException('amount deve ser string decimal ou null');
  }
  const planAccountId =
    row.planAccountId === undefined || row.planAccountId === null
      ? null
      : typeof row.planAccountId === 'string' ||
          typeof row.planAccountId === 'number'
        ? row.planAccountId
        : (() => {
            throw new BadRequestException(
              'planAccountId deve ser string, numero ou null',
            );
          })();
  const normalized: Omit<
    NormalizedLucasFleetRevenueRecord,
    'recordHash' | 'raw'
  > = {
    source: LUCAS_FLEET_REVENUE_SOURCE,
    nativeLocator,
    sourceKind,
    nativeKey,
    companyId,
    sourceKey,
    aethosVehicleId,
    eventDate,
    competence: competence(row.competence, eventDate),
    amount: nullableDecimal(row.amount, 'amount'),
    sourceStatus: optionalText(row.sourceStatus, 'sourceStatus', 80),
    active: boolean(row.active, 'active'),
    sourceUpdatedAt: optionalInstant(row.sourceUpdatedAt, 'sourceUpdatedAt'),
    planAccountId,
  };
  // Hash the producer's validated wire values. Converting IDs to strings,
  // decimals to Decimal or 7-digit timestamps to Date changes JSON bytes.
  const computedHash = lucasFleetRevenueWireHash(canonicalRecord(row));
  const producerHash = sha256(row.recordHash, 'recordHash');
  if (producerHash !== computedHash) {
    throw new BadRequestException(
      `recordHash divergente para ${nativeLocator}`,
    );
  }
  return {
    ...normalized,
    recordHash: computedHash,
    raw: json(row, 'record'),
  };
}

export function normalizeLucasFleetRevenueBatch(body: unknown) {
  const input = object(body, 'payload');
  if (
    text(input.schemaVersion, 'schemaVersion', 80) !==
    LUCAS_FLEET_REVENUE_SCHEMA
  ) {
    throw new BadRequestException(
      `schemaVersion deve ser ${LUCAS_FLEET_REVENUE_SCHEMA}`,
    );
  }
  if (text(input.dataset, 'dataset', 80) !== LUCAS_FLEET_REVENUE_DATASET) {
    throw new BadRequestException(
      `dataset deve ser ${LUCAS_FLEET_REVENUE_DATASET}`,
    );
  }
  if (text(input.source, 'source', 40) !== LUCAS_FLEET_REVENUE_SOURCE) {
    throw new BadRequestException(
      `source deve ser ${LUCAS_FLEET_REVENUE_SOURCE}`,
    );
  }
  const mode = text(input.mode, 'mode', 20).toUpperCase();
  if (mode !== 'FULL' && mode !== 'INCREMENTAL') {
    throw new BadRequestException('mode deve ser FULL ou INCREMENTAL');
  }
  const dryRun = boolean(input.dryRun, 'dryRun');
  const allowedForPosting = boolean(
    input.allowedForPosting,
    'allowedForPosting',
  );
  if (dryRun || !allowedForPosting) {
    throw new BadRequestException(
      'Payload de dry-run ou nao autorizado nao pode ser postado',
    );
  }
  const scopeInput = object(input.scope, 'scope');
  const branchCompanyScopes = normalizeBranchCompanyScopes(
    scopeInput.branchCompanyScopes,
  );
  const scope = {
    dateFrom: dateOnly(scopeInput.dateFrom, 'scope.dateFrom'),
    dateToExclusive: dateOnly(
      scopeInput.dateToExclusive,
      'scope.dateToExclusive',
    ),
    branches: stringArray(scopeInput.branches, 'scope.branches').map((entry) =>
      entry.toUpperCase(),
    ),
    companies: [
      ...new Set(
        branchCompanyScopes.flatMap((entry) => entry.companyIds ?? []),
      ),
    ].sort(),
    branchCompanyScopes,
    recheckedNativeLocators: optionalStringArray(
      scopeInput.recheckedNativeLocators,
      'scope.recheckedNativeLocators',
    ),
    metadata: json(scopeInput, 'scope'),
  };
  if (scope.dateToExclusive <= scope.dateFrom) {
    throw new BadRequestException(
      'scope.dateToExclusive deve ser posterior a dateFrom',
    );
  }
  if (
    LUCAS_FLEET_REVENUE_BRANCHES.some(
      (entry) => !scope.branches.includes(entry),
    ) ||
    scope.branches.some(
      (entry) =>
        !(LUCAS_FLEET_REVENUE_BRANCHES as readonly string[]).includes(entry),
    )
  ) {
    throw new BadRequestException(
      'scope.branches deve conter exatamente AVI, CTR, FES, FPE, FRE, OSE, RVI e VGI',
    );
  }
  const snapshotInput = object(input.snapshot, 'snapshot');
  const snapshot = {
    startedAt: instant(snapshotInput.startedAt, 'snapshot.startedAt'),
    finishedAt: instant(snapshotInput.finishedAt, 'snapshot.finishedAt'),
    complete: boolean(snapshotInput.complete, 'snapshot.complete'),
  };
  if (snapshot.finishedAt < snapshot.startedAt) {
    throw new BadRequestException('snapshot.finishedAt anterior a startedAt');
  }
  if (!snapshot.complete) {
    throw new BadRequestException('snapshot incompleto nao pode ser postado');
  }
  const batchInput = object(input.batch, 'batch');
  const batch = {
    number: positiveInteger(batchInput.number, 'batch.number'),
    total: positiveInteger(batchInput.total, 'batch.total'),
    recordCount: nonNegativeInteger(
      batchInput.recordCount,
      'batch.recordCount',
    ),
    payloadHash: sha256(batchInput.payloadHash, 'batch.payloadHash'),
  };
  if (input.manifest !== undefined) {
    normalizeLucasFleetRevenueManifest({
      schemaVersion: input.schemaVersion,
      dataset: input.dataset,
      source: input.source,
      runId: input.runId,
      manifest: input.manifest,
    });
  }
  const wirePayload = JSON.parse(JSON.stringify(input)) as JsonObject;
  const wireBatch = object(wirePayload.batch, 'batch');
  wireBatch.payloadHash = null;
  const computedPayloadHash = lucasFleetRevenueWireHash(wirePayload);
  if (batch.payloadHash !== computedPayloadHash) {
    throw new BadRequestException('batch.payloadHash divergente');
  }
  if (batch.number > batch.total) {
    throw new BadRequestException('batch.number maior que batch.total');
  }
  if (!Array.isArray(input.records)) {
    throw new BadRequestException('records deve ser uma lista');
  }
  if (input.records.length > LUCAS_FLEET_REVENUE_BATCH_LIMIT) {
    throw new BadRequestException(
      `records excede o limite de ${LUCAS_FLEET_REVENUE_BATCH_LIMIT}`,
    );
  }
  if (batch.recordCount !== input.records.length) {
    throw new BadRequestException(
      'batch.recordCount diverge de records.length',
    );
  }
  const records = input.records.map((entry) => normalizeRecord(entry, scope));
  const locators = new Set(records.map((entry) => entry.nativeLocator));
  if (locators.size !== records.length) {
    throw new BadRequestException('nativeLocator duplicado no lote');
  }
  return {
    schemaVersion: LUCAS_FLEET_REVENUE_SCHEMA,
    dataset: LUCAS_FLEET_REVENUE_DATASET,
    source: LUCAS_FLEET_REVENUE_SOURCE,
    ruleVersion: text(input.ruleVersion, 'ruleVersion', 160),
    ruleHash: sha256(input.ruleHash, 'ruleHash'),
    runId: text(input.runId, 'runId', 200),
    generatedAt: instant(input.generatedAt, 'generatedAt'),
    dryRun,
    allowedForPosting,
    mode: mode as 'FULL' | 'INCREMENTAL',
    scope,
    snapshot,
    batch,
    records,
  };
}

export type NormalizedLucasFleetRevenueManifest = ReturnType<
  typeof normalizeLucasFleetRevenueManifest
>;

export function normalizeLucasFleetRevenueManifest(body: unknown) {
  const input = object(body, 'payload');
  if (
    text(input.schemaVersion, 'schemaVersion', 80) !==
    LUCAS_FLEET_REVENUE_SCHEMA
  ) {
    throw new BadRequestException(
      `schemaVersion deve ser ${LUCAS_FLEET_REVENUE_SCHEMA}`,
    );
  }
  if (text(input.dataset, 'dataset', 80) !== LUCAS_FLEET_REVENUE_DATASET) {
    throw new BadRequestException(
      `dataset deve ser ${LUCAS_FLEET_REVENUE_DATASET}`,
    );
  }
  if (text(input.source, 'source', 40) !== LUCAS_FLEET_REVENUE_SOURCE) {
    throw new BadRequestException(
      `source deve ser ${LUCAS_FLEET_REVENUE_SOURCE}`,
    );
  }
  const manifest = object(input.manifest, 'manifest');
  return {
    schemaVersion: LUCAS_FLEET_REVENUE_SCHEMA,
    dataset: LUCAS_FLEET_REVENUE_DATASET,
    source: LUCAS_FLEET_REVENUE_SOURCE,
    runId: text(input.runId, 'runId', 200),
    manifest: {
      recordCount: nonNegativeInteger(
        manifest.recordCount,
        'manifest.recordCount',
      ),
      uniqueNativeLocatorCount: nonNegativeInteger(
        manifest.uniqueNativeLocatorCount,
        'manifest.uniqueNativeLocatorCount',
      ),
      nullAmountCount: nonNegativeInteger(
        manifest.nullAmountCount,
        'manifest.nullAmountCount',
      ),
      duplicateNativeLocatorCount: nonNegativeInteger(
        manifest.duplicateNativeLocatorCount,
        'manifest.duplicateNativeLocatorCount',
      ),
      pendingCount: nonNegativeInteger(
        manifest.pendingCount,
        'manifest.pendingCount',
      ),
      missingRecheckedNativeLocators: optionalStringArray(
        manifest.missingRecheckedNativeLocators,
        'manifest.missingRecheckedNativeLocators',
      ),
      amountTotal: nullableDecimal(
        manifest.amountTotal,
        'manifest.amountTotal',
      ),
      datasetHash: sha256(manifest.datasetHash, 'manifest.datasetHash'),
      aggregates: json(manifest.aggregates ?? {}, 'manifest.aggregates'),
      raw: json(manifest, 'manifest'),
    },
  };
}

export function normalizeLucasFleetRevenueFinalize(body: unknown) {
  const normalized = normalizeLucasFleetRevenueManifest(body);
  const input = object(body, 'payload');
  const scope = object(input.scope, 'scope');
  const snapshot = object(input.snapshot, 'snapshot');
  if (!Array.isArray(input.batches) || input.batches.length === 0) {
    throw new BadRequestException('batches deve ser uma lista nao vazia');
  }
  if (
    boolean(input.dryRun, 'dryRun') ||
    !boolean(input.allowedForPosting, 'allowedForPosting')
  ) {
    throw new BadRequestException('Finalizacao dry-run ou nao autorizada');
  }
  const mode = text(input.mode, 'mode', 20).toUpperCase();
  if (mode !== 'FULL' && mode !== 'INCREMENTAL') {
    throw new BadRequestException('mode invalido');
  }
  return {
    ...normalized,
    ruleVersion: text(input.ruleVersion, 'ruleVersion', 160),
    ruleHash: sha256(input.ruleHash, 'ruleHash'),
    generatedAt: instant(input.generatedAt, 'generatedAt'),
    mode,
    scope: json(scope, 'scope'),
    snapshot: {
      startedAt: instant(snapshot.startedAt, 'snapshot.startedAt'),
      finishedAt: instant(snapshot.finishedAt, 'snapshot.finishedAt'),
      complete: boolean(snapshot.complete, 'snapshot.complete'),
    },
    batches: input.batches.map((value, index) => {
      const batch = object(value, `batches[${index}]`);
      return {
        number: positiveInteger(batch.number, 'batch.number'),
        total: positiveInteger(batch.total, 'batch.total'),
        recordCount: nonNegativeInteger(batch.recordCount, 'batch.recordCount'),
        payloadHash: sha256(batch.payloadHash, 'batch.payloadHash'),
      };
    }),
  };
}

export function canonicalLucasFleetRevenueRecord(
  record: NormalizedLucasFleetRevenueRecord,
) {
  return canonicalRecord(record.raw as JsonObject);
}

export function lucasFleetRevenueDatasetHash(
  rows: Array<{ nativeLocator: string; recordHash: string }>,
) {
  return lucasFleetRevenueWireHash(
    [...rows]
      .sort((left, right) =>
        left.nativeLocator < right.nativeLocator
          ? -1
          : left.nativeLocator > right.nativeLocator
            ? 1
            : 0,
      )
      .map((row) => `${row.nativeLocator}|${row.recordHash}`),
  );
}

export type LucasFleetRevenueAggregateRow = {
  competence: Date;
  sourceKind: string;
  companyId: string;
  aethosVehicleId: string;
  amount: Prisma.Decimal | null;
};

export function reconcileLucasFleetRevenueAggregates(
  rows: LucasFleetRevenueAggregateRow[],
  declared: unknown,
) {
  if (!Array.isArray(declared)) {
    throw new BadRequestException('manifest.aggregates deve ser uma lista');
  }
  const computed = new Map<
    string,
    { count: number; nullCount: number; amount: Prisma.Decimal }
  >();
  for (const row of rows) {
    const key = `${row.competence.toISOString().slice(0, 7)}|${row.sourceKind}|${row.companyId}|${row.aethosVehicleId}`;
    const current = computed.get(key) ?? {
      count: 0,
      nullCount: 0,
      amount: new LucasFleetRevenueDecimal(0),
    };
    current.count += 1;
    if (row.amount === null) current.nullCount += 1;
    else current.amount = current.amount.add(row.amount.toString());
    computed.set(key, current);
  }
  if (declared.length !== computed.size) {
    throw new BadRequestException(
      'manifest.aggregates diverge da quantidade de grupos',
    );
  }
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    const item = object(entry, `manifest.aggregates[${index}]`);
    const month = text(item.competence, 'aggregate.competence', 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('aggregate.competence invalida');
    }
    const sourceKind = branch(item.sourceKind);
    const companyId = positiveInteger(item.companyId, 'aggregate.companyId');
    const vehicleId = positiveInteger(item.vehicleId, 'aggregate.vehicleId');
    const key = `${month}|${sourceKind}|${companyId}|${vehicleId}`;
    if (item.key !== key || seen.has(key)) {
      throw new BadRequestException(
        'manifest.aggregates tem chave invalida ou duplicada',
      );
    }
    seen.add(key);
    const expected = computed.get(key);
    const count = nonNegativeInteger(item.count, 'aggregate.count');
    const nullCount = nonNegativeInteger(item.nullCount, 'aggregate.nullCount');
    if (typeof item.amount !== 'string') {
      throw new BadRequestException('aggregate.amount deve ser string decimal');
    }
    const amount = nullableDecimal(item.amount, 'aggregate.amount');
    if (
      !expected ||
      count !== expected.count ||
      nullCount !== expected.nullCount ||
      !amount?.equals(expected.amount)
    ) {
      throw new BadRequestException(`manifest.aggregates divergente: ${key}`);
    }
  }
}
