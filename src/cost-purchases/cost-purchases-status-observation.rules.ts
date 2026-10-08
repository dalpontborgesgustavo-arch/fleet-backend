import { BadRequestException } from '@nestjs/common';

export const ASPHALT_STATUS_OBSERVATION_DATASET =
  'cost-purchases-asphalt-status-observations';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${name} deve ser objeto`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(`${name} invalido`);
  }
  return value.trim();
}

function sha(value: unknown, name: string): string {
  const parsed = requiredText(value, name, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new BadRequestException(`${name} deve ser SHA-256`);
  }
  return parsed;
}

function isoInstant(value: unknown, name: string): Date {
  const parsed = requiredText(value, name, 40);
  const date = new Date(parsed);
  if (
    !/\d{4}-\d{2}-\d{2}T.*Z$/.test(parsed) ||
    !Number.isFinite(date.getTime())
  ) {
    throw new BadRequestException(`${name} invalido`);
  }
  return date;
}

function nullableId(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredText(value, name, 120);
}

export type AsphaltStatusObservationRow = {
  sourceRecordId: string;
  sourceHeaderId: string;
  sourceItemId: string;
  aethosItemId: number;
  mappingId: string;
  expectedContentHash: string;
  expectedUpdatedAt: Date;
  expectedRowVersion: string;
  sourceStatus: 'F' | 'C';
  active: boolean;
  orderId: string | null;
  orderItemId: string | null;
  orderStatus: string | null;
};

export function parseAsphaltStatusObservations(body: unknown) {
  const input = record(body, 'payload');
  if (input.schemaVersion !== 1) {
    throw new BadRequestException('schemaVersion deve ser 1');
  }
  const runId = requiredText(input.runId, 'runId', 120);
  const snapshotId = sha(input.snapshotId, 'snapshotId');
  const mappingRevision = sha(input.mappingRevision, 'mappingRevision');
  const snapshotAt = isoInstant(input.snapshotAt, 'snapshotAt');
  const generatedAt = isoInstant(input.generatedAt, 'generatedAt');
  if (
    generatedAt < snapshotAt ||
    generatedAt.getTime() > Date.now() + 5 * 60000
  ) {
    throw new BadRequestException('generatedAt fora da janela do snapshot');
  }
  if (
    !Array.isArray(input.rows) ||
    input.rows.length < 1 ||
    input.rows.length > 100
  ) {
    throw new BadRequestException('rows deve conter de 1 a 100 observacoes');
  }
  const seen = new Set<string>();
  const rows: AsphaltStatusObservationRow[] = input.rows.map((value, index) => {
    const row = record(value, `rows[${index}]`);
    const sourceRecordId = requiredText(
      row.sourceRecordId,
      'sourceRecordId',
      220,
    );
    if (seen.has(sourceRecordId)) {
      throw new BadRequestException('sourceRecordId duplicado no lote');
    }
    seen.add(sourceRecordId);
    const expectedContentHash = sha(
      row.expectedContentHash,
      'expectedContentHash',
    );
    const expectedUpdatedAt = isoInstant(
      row.expectedUpdatedAt,
      'expectedUpdatedAt',
    );
    const expectedRowVersion = requiredText(
      row.expectedRowVersion,
      'expectedRowVersion',
      130,
    );
    if (
      expectedRowVersion !==
      `${expectedUpdatedAt.toISOString()}/${expectedContentHash}`
    ) {
      throw new BadRequestException('expectedRowVersion divergente');
    }
    const sourceStatus = requiredText(
      row.sourceStatus,
      'sourceStatus',
      1,
    ).toUpperCase();
    if (sourceStatus !== 'F' && sourceStatus !== 'C') {
      throw new BadRequestException('sourceStatus deve ser F ou C');
    }
    if (
      typeof row.active !== 'boolean' ||
      row.active !== (sourceStatus === 'F')
    ) {
      throw new BadRequestException('active diverge do status da NF');
    }
    if (
      !Object.prototype.hasOwnProperty.call(row, 'orderId') ||
      !Object.prototype.hasOwnProperty.call(row, 'orderItemId') ||
      !Object.prototype.hasOwnProperty.call(row, 'orderStatus')
    ) {
      throw new BadRequestException('contrato OC completo e obrigatorio');
    }
    const orderId = nullableId(row.orderId, 'orderId');
    const orderItemId = nullableId(row.orderItemId, 'orderItemId');
    const orderStatus =
      row.orderStatus === null
        ? null
        : requiredText(row.orderStatus, 'orderStatus', 10).toUpperCase();
    if (orderStatus && (!orderId || !orderItemId)) {
      throw new BadRequestException('orderStatus exige IDs oficiais da OC');
    }
    if (
      !Number.isSafeInteger(row.aethosItemId) ||
      Number(row.aethosItemId) <= 0
    ) {
      throw new BadRequestException('aethosItemId invalido');
    }
    return {
      sourceRecordId,
      sourceHeaderId: requiredText(row.sourceHeaderId, 'sourceHeaderId', 120),
      sourceItemId: requiredText(row.sourceItemId, 'sourceItemId', 120),
      aethosItemId: Number(row.aethosItemId),
      mappingId: requiredText(row.mappingId, 'mappingId', 120),
      expectedContentHash,
      expectedUpdatedAt,
      expectedRowVersion,
      sourceStatus,
      active: row.active,
      orderId,
      orderItemId,
      orderStatus,
    };
  });
  return { runId, snapshotId, mappingRevision, snapshotAt, generatedAt, rows };
}

