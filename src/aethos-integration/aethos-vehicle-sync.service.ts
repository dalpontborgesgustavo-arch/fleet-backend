import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { setVehicleAuditContext } from '../vehicles/vehicle-audit-context';

type AnyRow = Record<string, unknown>;

type FleetType = 'Terraplanagem' | 'Caminhões' | 'Asfalto' | 'Veiculos';
type Branch = 'MATRIZ' | 'NORTE' | 'MAFRA' | 'PEDRAFORTE';
type VehicleSubtype = 'truck' | 'van' | 'car' | 'bus' | 'other';

type NormalizedAethosVehicle = {
  aethosId: string;
  companyId: string;
  fleet: string;
  plate: string;
  name: string;
  model: string | null;
  group: string | null;
  subgroup: string | null;
  companyName: string;
  fleetType: FleetType | null;
  branch: Branch | null;
  subtype: VehicleSubtype;
  raw: Prisma.InputJsonValue;
};

type RejectedVehicle = {
  index: number;
  aethosId: string | null;
  fleet: string | null;
  reason: string;
};

type ExistingVehicle = {
  id: string;
  fleet: string | null;
  plate: string;
  active: boolean;
  aethosVehicleId: string | null;
  aethosManaged: boolean;
};

type PlannedUpsert = {
  row: NormalizedAethosVehicle;
  existing: ExistingVehicle | null;
  action: 'CREATE' | 'LINK' | 'UPDATE';
};

type SyncConflict = {
  aethosId: string;
  fleet: string;
  plate: string;
  reason: string;
};

type IgnoredTankReference = {
  aethosId: string;
  fleet: string;
  plate: string;
  reason: string;
};

type NormalizedVehicleStatusEvent = {
  eventId: string;
  aethosId: string;
  companyId: string;
  fleet: string | null;
  plate: string | null;
  previousStatus: 'S' | 'N';
  currentStatus: 'S' | 'N';
  changedAt: Date;
  changedByUserId: string | null;
  changedByLogin: string | null;
  changedByName: string | null;
  effectiveEndAt: Date | null;
  inactiveReason: string | null;
  source: string | null;
  raw: Prisma.InputJsonValue;
};

type RejectedVehicleStatusEvent = {
  index: number;
  eventId: string | null;
  aethosId: string | null;
  reason: string;
};

type VehicleStatusEventResolution = {
  event: NormalizedVehicleStatusEvent;
  vehicle: ExistingVehicle | null;
  status: 'APPLIED' | 'ALREADY_PROCESSED' | 'NOT_FOUND' | 'CONFLICT';
  message: string | null;
};

const JR_AETHOS_COMPANY_ID = '1';
const MAX_DEACTIVATIONS_WITHOUT_OVERRIDE = 5;
const MAX_DEACTIVATION_RATIO_WITHOUT_OVERRIDE = 0.2;

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return '';
  }

  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeFleetKey(value: unknown): string {
  return normalizeKey(normalizeText(value).replace(/^FROTA[\s-]*/i, ''));
}

function firstDefined(row: AnyRow, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }

  return undefined;
}

function pickText(row: AnyRow, names: string[]): string {
  for (const name of names) {
    const value = normalizeText(row[name]);
    if (value) return value;
  }

  return '';
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const key = normalizeKey(value);
  if (['TRUE', '1', 'SIM', 'S', 'ATIVO', 'A'].includes(key)) return true;
  if (['FALSE', '0', 'NAO', 'N', 'INATIVO', 'I'].includes(key)) return false;
  return null;
}

function normalizeFleetType(value: unknown): FleetType | null {
  const key = normalizeKey(value);
  if (key === 'TERRAPLANAGEM') return 'Terraplanagem';
  if (key === 'CAMINHOES' || key === 'CAMINHAO') return 'Caminhões';
  if (key === 'ASFALTO') return 'Asfalto';
  if (key === 'VEICULOS' || key === 'VEICULO') return 'Veiculos';
  return null;
}

function normalizeBranch(value: unknown): Branch | null {
  const key = normalizeKey(value);
  if (key === 'MATRIZ' || key === 'FILIALMATRIZ') return 'MATRIZ';
  if (key === 'NORTE' || key === 'FILIALNORTE') return 'NORTE';
  if (key === 'MAFRA' || key === 'FILIALMAFRA') return 'MAFRA';
  if (key === 'PEDRAFORTE' || key === 'FILIALPEDRAFORTE') {
    return 'PEDRAFORTE';
  }
  return null;
}

function normalizeSubtype(
  value: unknown,
  fleetType: FleetType | null,
): VehicleSubtype {
  const key = normalizeKey(value).toLowerCase();
  if (['truck', 'van', 'car', 'bus'].includes(key)) {
    return key as VehicleSubtype;
  }
  if (fleetType === 'Veiculos') return 'car';
  if (fleetType) return 'truck';
  return 'other';
}

function vehicleTypeForFleetType(fleetType: FleetType | null): string {
  if (fleetType === 'Caminhões') return 'caminhao';
  if (fleetType === 'Asfalto') return 'asfalto';
  if (fleetType === 'Veiculos') return 'veiculos';
  if (fleetType === 'Terraplanagem') return 'equipamento';
  return 'nao_classificado';
}

function listFromBody(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const row = body as AnyRow;
  for (const key of ['vehicles', 'veiculos', 'rows', 'data']) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function statusEventsFromBody(body: unknown): unknown[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const row = body as AnyRow;
  for (const key of [
    'inativacoesVeiculos',
    'inativacoes_veiculos',
    'vehicleStatusEvents',
    'vehicle_status_events',
  ]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function normalizeStatus(value: unknown): 'S' | 'N' | null {
  const key = normalizeKey(value);
  if (['S', 'ATIVO', 'ACTIVE', 'TRUE', '1'].includes(key)) return 'S';
  if (['N', 'INATIVO', 'INACTIVE', 'FALSE', '0'].includes(key)) return 'N';
  return null;
}

function normalizeDate(value: unknown): Date | null {
  const text = normalizeText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeVehicleStatusEvents(body: unknown): {
  events: NormalizedVehicleStatusEvent[];
  rejected: RejectedVehicleStatusEvent[];
} {
  const events: NormalizedVehicleStatusEvent[] = [];
  const rejected: RejectedVehicleStatusEvent[] = [];

  statusEventsFromBody(body).forEach((rawEvent, index) => {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      rejected.push({
        index,
        eventId: null,
        aethosId: null,
        reason: 'Evento nao e um objeto valido.',
      });
      return;
    }

    const row = rawEvent as AnyRow;
    const eventId = pickText(row, [
      'idEventoAethos',
      'id_evento_aethos',
      'eventId',
      'event_id',
    ]);
    const aethosId = pickText(row, [
      'idVeiculoAethos',
      'id_veiculo_aethos',
      'idVeiculo',
      'id_veiculo',
    ]);
    const companyId = pickText(row, [
      'idEmpresa',
      'id_empresa',
      'codigoEmpresa',
      'codigo_empresa',
    ]);
    const previousStatus = normalizeStatus(
      firstDefined(row, ['statusAnterior', 'status_anterior', 'previousStatus']),
    );
    const currentStatus = normalizeStatus(
      firstDefined(row, ['statusAtual', 'status_atual', 'currentStatus']),
    );
    const changedAt = normalizeDate(
      firstDefined(row, [
        'dataInativacaoAethos',
        'dataAlteracaoStatus',
        'data_alteracao_status',
        'changedAt',
        'changed_at',
      ]),
    );

    const reason = !eventId
      ? 'ID oficial do evento do Aethos ausente.'
      : !aethosId
        ? 'ID oficial do veiculo no evento ausente.'
        : companyId !== JR_AETHOS_COMPANY_ID
          ? `Empresa ${companyId || '(vazia)'} nao e a empresa JR permitida (${JR_AETHOS_COMPANY_ID}).`
          : !previousStatus || !currentStatus
            ? 'Status anterior ou atual invalido; use S ou N.'
            : previousStatus === currentStatus
              ? 'Evento nao representa uma transicao de status.'
              : !changedAt
                ? 'Data/hora oficial da alteracao ausente ou invalida.'
                : '';

    if (reason) {
      rejected.push({
        index,
        eventId: eventId || null,
        aethosId: aethosId || null,
        reason,
      });
      return;
    }

    const effectiveEndValue = firstDefined(row, [
      'dataFimVinculoJR',
      'data_fim_vinculo_jr',
      'effectiveEndAt',
      'effective_end_at',
    ]);
    const effectiveEndAt = normalizeDate(effectiveEndValue);
    if (normalizeText(effectiveEndValue) && !effectiveEndAt) {
      rejected.push({
        index,
        eventId,
        aethosId,
        reason: 'Data efetiva de fim de vinculo invalida.',
      });
      return;
    }

    events.push({
      eventId,
      aethosId,
      companyId,
      fleet:
        pickText(row, ['frota', 'numeroFrota', 'numero_frota']).replace(
          /^FROTA[\s-]*/i,
          '',
        ) || null,
      plate:
        pickText(row, ['placaSistema', 'placa_sistema', 'placa']).toUpperCase() ||
        null,
      previousStatus: previousStatus!,
      currentStatus: currentStatus!,
      changedAt: changedAt!,
      changedByUserId:
        pickText(row, [
          'usuarioInativacaoId',
          'usuarioAlteracaoId',
          'changedByUserId',
        ]) || null,
      changedByLogin:
        pickText(row, [
          'usuarioInativacaoLogin',
          'usuarioAlteracaoLogin',
          'changedByLogin',
        ]) || null,
      changedByName:
        pickText(row, [
          'usuarioInativacaoNome',
          'usuarioAlteracaoNome',
          'changedByName',
        ]) || null,
      effectiveEndAt,
      inactiveReason:
        pickText(row, [
          'motivoInativacao',
          'motivo_inativacao',
          'inactiveReason',
        ]) || null,
      source:
        pickText(row, ['origemHistorico', 'origem_historico', 'source']) || null,
      raw: toJsonValue(row),
    });
  });

  const duplicatedIds = new Set<string>();
  const seenIds = new Set<string>();
  events.forEach((event) => {
    if (seenIds.has(event.eventId)) duplicatedIds.add(event.eventId);
    seenIds.add(event.eventId);
  });
  const uniqueEvents = events.filter((event) => {
    if (!duplicatedIds.has(event.eventId)) return true;
    rejected.push({
      index: -1,
      eventId: event.eventId,
      aethosId: event.aethosId,
      reason: 'ID de evento duplicado no mesmo payload.',
    });
    return false;
  });

  uniqueEvents.sort(
    (left, right) =>
      left.changedAt.getTime() - right.changedAt.getTime() ||
      left.eventId.localeCompare(right.eventId),
  );

  return { events: uniqueEvents, rejected };
}

function toJsonValue(row: AnyRow): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

export function normalizeAethosVehicleSnapshot(body: unknown): {
  snapshotId: string;
  generatedAt: Date;
  expectedCount: number;
  execute: boolean;
  allowLargeDeactivation: boolean;
  receivedCount: number;
  vehicles: NormalizedAethosVehicle[];
  rejected: RejectedVehicle[];
  statusEvents: NormalizedVehicleStatusEvent[];
  rejectedStatusEvents: RejectedVehicleStatusEvent[];
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Payload da fotografia de frotas invalido.');
  }

  const envelope = body as AnyRow;
  const snapshotId = pickText(envelope, [
    'snapshotId',
    'snapshot_id',
    'syncId',
    'sync_id',
  ]);
  if (!snapshotId || snapshotId.length > 200) {
    throw new BadRequestException('snapshotId obrigatorio ou invalido.');
  }

  const generatedAtText = pickText(envelope, [
    'generatedAt',
    'generated_at',
    'geradoEm',
  ]);
  const generatedAt = new Date(generatedAtText);
  if (!generatedAtText || Number.isNaN(generatedAt.getTime())) {
    throw new BadRequestException('generatedAt obrigatorio ou invalido.');
  }

  const rawRows = listFromBody(body);
  const expectedCountValue = Number(
    firstDefined(envelope, [
      'expectedCount',
      'expected_count',
      'totalEsperado',
    ]),
  );
  const expectedCount = Number.isInteger(expectedCountValue)
    ? expectedCountValue
    : rawRows.length;

  if (!rawRows.length) {
    throw new BadRequestException(
      'A fotografia nao pode ser vazia; nenhuma inativacao foi executada.',
    );
  }
  if (expectedCount !== rawRows.length) {
    throw new BadRequestException(
      `Fotografia incompleta: esperado ${expectedCount}, recebido ${rawRows.length}.`,
    );
  }

  const vehicles: NormalizedAethosVehicle[] = [];
  const rejected: RejectedVehicle[] = [];

  rawRows.forEach((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      rejected.push({
        index,
        aethosId: null,
        fleet: null,
        reason: 'Linha nao e um objeto valido.',
      });
      return;
    }

    const row = rawRow as AnyRow;
    const aethosId = pickText(row, [
      'idVeiculoAethos',
      'id_veiculo_aethos',
      'idVeiculo',
      'id_veiculo',
    ]);
    const companyId = pickText(row, [
      'idEmpresa',
      'id_empresa',
      'codigoEmpresa',
      'codigo_empresa',
    ]);
    const fleet = pickText(row, [
      'frota',
      'numeroFrota',
      'numero_frota',
      'codigoFrota',
      'codigo_frota',
    ]).replace(/^FROTA[\s-]*/i, '');
    const plate = pickText(row, [
      'placaSistema',
      'placa_sistema',
      'placa',
      'identificadorSistema',
      'identificador_sistema',
    ]).toUpperCase();
    const fleetType = normalizeFleetType(
      firstDefined(row, [
        'tipoFrotaSistema',
        'tipo_frota_sistema',
        'tipoFrota',
        'tipo_frota',
      ]),
    );
    const branch = normalizeBranch(
      firstDefined(row, ['filialSistema', 'filial_sistema', 'filial']),
    );
    const active = normalizeBoolean(
      firstDefined(row, ['ativo', 'active', 'flAtivo', 'fl_ativo']),
    );
    const reason = !aethosId
      ? 'ID oficial do veiculo no Aethos ausente.'
      : companyId !== JR_AETHOS_COMPANY_ID
        ? `Empresa ${companyId || '(vazia)'} nao e a empresa JR permitida (${JR_AETHOS_COMPANY_ID}).`
        : active !== true
          ? 'A fotografia deve conter somente veiculos ativos.'
          : !fleet
            ? 'Numero de frota ausente.'
            : !plate || ['NA', 'N/A', 'SEMPLACA'].includes(normalizeKey(plate))
              ? 'Placa/identificador unico do Sistema JR ausente ou generico.'
              : '';

    if (reason) {
      rejected.push({
        index,
        aethosId: aethosId || null,
        fleet: fleet || null,
        reason,
      });
      return;
    }

    const model = pickText(row, [
      'modelo',
      'model',
      'descricaoModelo',
      'descricao_modelo',
    ]);
    const name =
      pickText(row, [
        'nome',
        'name',
        'descricao',
        'descricaoVeiculo',
        'descricao_veiculo',
      ]) ||
      model ||
      `Frota ${fleet}`;

    vehicles.push({
      aethosId,
      companyId,
      fleet,
      plate,
      name,
      model: model || null,
      // Aethos uses these fields for make/model. In JR they are managerial
      // classifications and must be filled explicitly by a user.
      group: null,
      subgroup: null,
      companyName:
        pickText(row, ['empresa', 'nomeEmpresa', 'nome_empresa', 'company']) ||
        'JR CONSTRUÇÕES',
      fleetType,
      branch,
      subtype: normalizeSubtype(
        firstDefined(row, [
          'subtipoSistema',
          'subtipo_sistema',
          'type',
          'tipoSistema',
        ]),
        fleetType,
      ),
      raw: toJsonValue(row),
    });
  });

  const duplicateMessages: RejectedVehicle[] = [];
  for (const [label, keyOf] of [
    ['ID Aethos', (row: NormalizedAethosVehicle) => row.aethosId],
    ['placa', (row: NormalizedAethosVehicle) => normalizeKey(row.plate)],
  ] as const) {
    const counts = new Map<string, number>();
    vehicles.forEach((row) =>
      counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1),
    );
    vehicles.forEach((row, index) => {
      if ((counts.get(keyOf(row)) ?? 0) > 1) {
        duplicateMessages.push({
          index,
          aethosId: row.aethosId,
          fleet: row.fleet,
          reason: `${label} duplicado na fotografia: ${keyOf(row)}.`,
        });
      }
    });
  }

  const normalizedStatusEvents = normalizeVehicleStatusEvents(body);

  return {
    snapshotId,
    generatedAt,
    expectedCount,
    execute: normalizeBoolean(envelope.execute) === true,
    allowLargeDeactivation:
      normalizeBoolean(envelope.allowLargeDeactivation) === true,
    receivedCount: rawRows.length,
    vehicles,
    rejected: [...rejected, ...duplicateMessages],
    statusEvents: normalizedStatusEvents.events,
    rejectedStatusEvents: normalizedStatusEvents.rejected,
  };
}

function mapByKey(
  vehicles: ExistingVehicle[],
  keyOf: (vehicle: ExistingVehicle) => string,
): Map<string, ExistingVehicle[]> {
  const result = new Map<string, ExistingVehicle[]>();
  vehicles.forEach((vehicle) => {
    const key = keyOf(vehicle);
    if (!key) return;
    result.set(key, [...(result.get(key) ?? []), vehicle]);
  });
  return result;
}

function resolveVehicleStatusEvents(
  events: NormalizedVehicleStatusEvent[],
  vehicles: ExistingVehicle[],
): VehicleStatusEventResolution[] {
  const byAethosId = mapByKey(
    vehicles,
    (vehicle) => vehicle.aethosVehicleId ?? '',
  );
  const byPlate = mapByKey(vehicles, (vehicle) => normalizeKey(vehicle.plate));
  const byFleet = mapByKey(vehicles, (vehicle) =>
    normalizeFleetKey(vehicle.fleet),
  );

  return events.map((event) => {
    const aethosMatches = byAethosId.get(event.aethosId) ?? [];
    if (aethosMatches.length === 1) {
      return {
        event,
        vehicle: aethosMatches[0],
        status: 'APPLIED',
        message: null,
      };
    }
    if (aethosMatches.length > 1) {
      return {
        event,
        vehicle: null,
        status: 'CONFLICT',
        message: 'Mais de um cadastro vinculado ao mesmo ID Aethos.',
      };
    }

    const plateMatches = event.plate
      ? (byPlate.get(normalizeKey(event.plate)) ?? [])
      : [];
    if (plateMatches.length === 1) {
      const candidate = plateMatches[0];
      if (
        candidate.aethosVehicleId &&
        candidate.aethosVehicleId !== event.aethosId
      ) {
        return {
          event,
          vehicle: null,
          status: 'CONFLICT',
          message: `Placa vinculada a outro ID Aethos (${candidate.aethosVehicleId}).`,
        };
      }
      return { event, vehicle: candidate, status: 'APPLIED', message: null };
    }
    if (plateMatches.length > 1) {
      return {
        event,
        vehicle: null,
        status: 'CONFLICT',
        message: 'Placa encontra mais de um cadastro interno.',
      };
    }

    const fleetMatches = event.fleet
      ? (byFleet.get(normalizeFleetKey(event.fleet)) ?? [])
      : [];
    if (fleetMatches.length === 1) {
      const candidate = fleetMatches[0];
      if (
        candidate.aethosVehicleId &&
        candidate.aethosVehicleId !== event.aethosId
      ) {
        return {
          event,
          vehicle: null,
          status: 'CONFLICT',
          message: `Frota vinculada a outro ID Aethos (${candidate.aethosVehicleId}).`,
        };
      }
      return { event, vehicle: candidate, status: 'APPLIED', message: null };
    }
    if (fleetMatches.length > 1) {
      return {
        event,
        vehicle: null,
        status: 'CONFLICT',
        message: 'Frota encontra mais de um cadastro interno.',
      };
    }

    return {
      event,
      vehicle: null,
      status: 'NOT_FOUND',
      message: 'Nenhum cadastro interno encontrado por ID Aethos, placa ou frota unica.',
    };
  });
}

function isComboioTankReferencePlate(value: unknown): boolean {
  return normalizeKey(value).startsWith('COM');
}

@Injectable()
export class AethosVehicleSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(body: unknown) {
    const snapshot = normalizeAethosVehicleSnapshot(body);

    if (snapshot.execute) {
      const previous = await this.prisma.aethosVehicleSyncRun.findUnique({
        where: { snapshotId: snapshot.snapshotId },
      });
      if (previous) {
        return {
          ...(previous.result as Record<string, unknown>),
          executed: true,
          replayed: true,
        };
      }
    }

    const existingVehicles = await this.prisma.vehicle.findMany({
      select: {
        id: true,
        fleet: true,
        plate: true,
        active: true,
        aethosVehicleId: true,
        aethosManaged: true,
      },
    });
    const byAethosId = mapByKey(
      existingVehicles,
      (vehicle) => vehicle.aethosVehicleId ?? '',
    );
    const byFleet = mapByKey(existingVehicles, (vehicle) =>
      normalizeFleetKey(vehicle.fleet),
    );
    const byPlate = mapByKey(existingVehicles, (vehicle) =>
      normalizeKey(vehicle.plate),
    );
    const incomingByFleet = new Map<string, NormalizedAethosVehicle[]>();
    snapshot.vehicles.forEach((vehicle) => {
      const key = normalizeFleetKey(vehicle.fleet);
      incomingByFleet.set(key, [...(incomingByFleet.get(key) ?? []), vehicle]);
    });
    const ignoredTankReferences: IgnoredTankReference[] = [];
    const incomingVehicles = snapshot.vehicles.filter((vehicle) => {
      if (!isComboioTankReferencePlate(vehicle.plate)) return true;

      const fleetKey = normalizeFleetKey(vehicle.fleet);
      const hasRealPlateInSnapshot = (incomingByFleet.get(fleetKey) ?? []).some(
        (candidate) =>
          candidate.aethosId !== vehicle.aethosId &&
          !isComboioTankReferencePlate(candidate.plate),
      );
      const hasRealPlateInDatabase = (byFleet.get(fleetKey) ?? []).some(
        (candidate) =>
          candidate.aethosVehicleId !== vehicle.aethosId &&
          !isComboioTankReferencePlate(candidate.plate),
      );

      if (!hasRealPlateInSnapshot && !hasRealPlateInDatabase) return true;

      ignoredTankReferences.push({
        aethosId: vehicle.aethosId,
        fleet: vehicle.fleet,
        plate: vehicle.plate,
        reason:
          'Referencia de tanque de comboio ignorada: placa COM com outra placa real na mesma frota.',
      });
      return false;
    });
    const incomingFleetCounts = new Map<string, number>();
    incomingVehicles.forEach((vehicle) => {
      const key = normalizeFleetKey(vehicle.fleet);
      incomingFleetCounts.set(key, (incomingFleetCounts.get(key) ?? 0) + 1);
    });

    const planned: PlannedUpsert[] = [];
    const conflicts: SyncConflict[] = [];

    incomingVehicles.forEach((row) => {
      const externalMatches = byAethosId.get(row.aethosId) ?? [];
      if (externalMatches.length > 1) {
        conflicts.push({
          aethosId: row.aethosId,
          fleet: row.fleet,
          plate: row.plate,
          reason: 'Mais de um veiculo vinculado ao mesmo ID Aethos.',
        });
        return;
      }
      if (externalMatches.length === 1) {
        planned.push({ row, existing: externalMatches[0], action: 'UPDATE' });
        return;
      }

      const plateMatches = byPlate.get(normalizeKey(row.plate)) ?? [];
      if (plateMatches.length > 1) {
        conflicts.push({
          aethosId: row.aethosId,
          fleet: row.fleet,
          plate: row.plate,
          reason: 'Placa encontra mais de um cadastro interno.',
        });
        return;
      }

      const plateMatch = plateMatches[0] ?? null;
      const fleetKey = normalizeFleetKey(row.fleet);
      const fleetIsUniqueInSnapshot = incomingFleetCounts.get(fleetKey) === 1;
      const fleetMatches = fleetIsUniqueInSnapshot
        ? (byFleet.get(fleetKey) ?? [])
        : [];
      if (!plateMatch && fleetMatches.length > 1) {
        conflicts.push({
          aethosId: row.aethosId,
          fleet: row.fleet,
          plate: row.plate,
          reason:
            'Frota unica na fotografia encontra mais de um cadastro interno.',
        });
        return;
      }

      // A placa oficial e unica no Aethos e, por isso, tem precedencia. A
      // frota so participa do primeiro vinculo quando tambem for unica na
      // fotografia completa.
      const existing = plateMatch || fleetMatches[0] || null;
      if (
        existing?.aethosVehicleId &&
        existing.aethosVehicleId !== row.aethosId
      ) {
        conflicts.push({
          aethosId: row.aethosId,
          fleet: row.fleet,
          plate: row.plate,
          reason: `Cadastro interno ja vinculado ao ID Aethos ${existing.aethosVehicleId}.`,
        });
        return;
      }

      planned.push({
        row,
        existing: existing ?? null,
        action: existing ? 'LINK' : 'CREATE',
      });
    });

    const incomingIds = new Set(incomingVehicles.map((row) => row.aethosId));
    const deactivate = existingVehicles.filter(
      (vehicle) =>
        vehicle.aethosManaged &&
        vehicle.active &&
        !!vehicle.aethosVehicleId &&
        !incomingIds.has(vehicle.aethosVehicleId),
    );
    const managedActiveBefore = existingVehicles.filter(
      (vehicle) => vehicle.aethosManaged && vehicle.active,
    ).length;
    const deactivationRatio = managedActiveBefore
      ? deactivate.length / managedActiveBefore
      : 0;
    const largeDeactivationBlocked =
      !snapshot.allowLargeDeactivation &&
      deactivate.length > MAX_DEACTIVATIONS_WITHOUT_OVERRIDE &&
      deactivationRatio > MAX_DEACTIVATION_RATIO_WITHOUT_OVERRIDE;
    const createdCount = planned.filter(
      (entry) => entry.action === 'CREATE',
    ).length;
    const linkedCount = planned.filter(
      (entry) => entry.action === 'LINK',
    ).length;
    const updatedCount = planned.filter(
      (entry) => entry.action === 'UPDATE',
    ).length;
    const reactivatedCount = planned.filter(
      (entry) => entry.existing && !entry.existing.active,
    ).length;
    const pendingClassificationCount = planned.filter(
      (entry) =>
        entry.action === 'CREATE' &&
        (!entry.row.fleetType || !entry.row.branch),
    ).length;

    const previouslyAppliedEvents = snapshot.statusEvents.length
      ? await this.prisma.aethosVehicleStatusEvent.findMany({
          where: {
            aethosEventId: {
              in: snapshot.statusEvents.map((event) => event.eventId),
            },
            applicationStatus: 'APPLIED',
          },
          select: { aethosEventId: true, vehicleId: true },
        })
      : [];
    const previouslyAppliedById = new Map(
      previouslyAppliedEvents.map((event) => [event.aethosEventId, event]),
    );
    const pendingStatusEvents = snapshot.statusEvents.filter(
      (event) => !previouslyAppliedById.has(event.eventId),
    );
    const previewVehicles: ExistingVehicle[] = [
      ...existingVehicles,
      ...planned
        .filter((entry) => !entry.existing)
        .map((entry) => ({
          id: `PENDING:${entry.row.aethosId}`,
          fleet: entry.row.fleet,
          plate: entry.row.plate,
          active: true,
          aethosVehicleId: entry.row.aethosId,
          aethosManaged: true,
        })),
    ];
    const previewStatusEventResolutions = [
      ...snapshot.statusEvents
        .filter((event) => previouslyAppliedById.has(event.eventId))
        .map<VehicleStatusEventResolution>((event) => ({
          event,
          vehicle: null,
          status: 'ALREADY_PROCESSED',
          message: null,
        })),
      ...resolveVehicleStatusEvents(pendingStatusEvents, previewVehicles),
    ];
    const previewStatusEventResults = previewStatusEventResolutions.map(
      (resolution) => ({
        idEventoAethos: resolution.event.eventId,
        idVeiculoAethos: resolution.event.aethosId,
        status: resolution.status,
        vehicleId:
          resolution.vehicle?.id.startsWith('PENDING:') === true
            ? null
            : (resolution.vehicle?.id ??
              previouslyAppliedById.get(resolution.event.eventId)?.vehicleId ??
              null),
        message: resolution.message,
      }),
    );

    const summary = {
      ok: true,
      snapshotId: snapshot.snapshotId,
      generatedAt: snapshot.generatedAt.toISOString(),
      received: snapshot.receivedCount,
      valid: incomingVehicles.length,
      ignoredTankReferenceCount: ignoredTankReferences.length,
      ignoredTankReferenceSample: ignoredTankReferences.slice(0, 20),
      rejectedCount: snapshot.rejected.length,
      rejectedSample: snapshot.rejected.slice(0, 20),
      conflictCount: conflicts.length,
      conflictSample: conflicts.slice(0, 20),
      createdCount,
      linkedCount,
      updatedCount,
      reactivatedCount,
      pendingClassificationCount,
      statusEventsReceived: statusEventsFromBody(body).length,
      statusEventsValid: snapshot.statusEvents.length,
      statusEventsRejectedCount: snapshot.rejectedStatusEvents.length,
      statusEventsRejectedSample: snapshot.rejectedStatusEvents.slice(0, 20),
      statusEventsWouldApplyCount: previewStatusEventResolutions.filter(
        (resolution) => resolution.status === 'APPLIED',
      ).length,
      statusEventsAlreadyProcessedCount: previouslyAppliedEvents.length,
      statusEventsNotFoundCount: previewStatusEventResolutions.filter(
        (resolution) => resolution.status === 'NOT_FOUND',
      ).length,
      statusEventsConflictCount: previewStatusEventResolutions.filter(
        (resolution) => resolution.status === 'CONFLICT',
      ).length,
      statusEventResults: previewStatusEventResults,
      deactivatedCount: deactivate.length,
      managedActiveBefore,
      deactivationRatio: Number(deactivationRatio.toFixed(4)),
      largeDeactivationBlocked,
      executed: false,
      replayed: false,
    };

    if (!snapshot.execute) return summary;

    if (
      snapshot.rejected.length ||
      snapshot.rejectedStatusEvents.length ||
      conflicts.length
    ) {
      throw new BadRequestException({
        message:
          'Fotografia rejeitada: corrija todas as linhas invalidas e conflitos antes da execucao.',
        ...summary,
      });
    }
    if (largeDeactivationBlocked) {
      throw new BadRequestException({
        message:
          'Fotografia bloqueada por queda anormal de veiculos. Valide a origem antes de autorizar inativacao em massa.',
        ...summary,
      });
    }

    const now = new Date();
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          vehicles: incomingVehicles.map((row) => ({
            id: row.aethosId,
            company: row.companyId,
            fleet: normalizeFleetKey(row.fleet),
            plate: normalizeKey(row.plate),
          })),
          statusEvents: snapshot.statusEvents.map((event) => ({
            id: event.eventId,
            vehicle: event.aethosId,
            from: event.previousStatus,
            to: event.currentStatus,
            changedAt: event.changedAt.toISOString(),
          })),
        }),
      )
      .digest('hex');
    let executedResult: Record<string, unknown> = {
      ...summary,
      executed: true,
      createdCount,
      linkedCount,
      updatedCount,
      reactivatedCount,
      deactivatedCount: deactivate.length,
    };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const replay = await tx.aethosVehicleSyncRun.findUnique({
            where: { snapshotId: snapshot.snapshotId },
          });
          if (replay) return;

          await setVehicleAuditContext(tx, {
            source: 'AETHOS',
            name: 'Integracao Aethos',
          });

          for (const entry of planned) {
            if (entry.existing) {
              await tx.vehicle.update({
                where: { id: entry.existing.id },
                data: {
                  active: true,
                  aethosVehicleId: entry.row.aethosId,
                  aethosManaged: true,
                  aethosCompanyId: entry.row.companyId,
                  aethosSyncedAt: now,
                  aethosRaw: entry.row.raw,
                },
              });
              continue;
            }

            await tx.vehicle.create({
              data: {
                fleet: entry.row.fleet,
                plate: entry.row.plate,
                name: entry.row.name,
                model: entry.row.model,
                group: entry.row.group,
                subgroup: entry.row.subgroup,
                company: entry.row.companyName,
                type: entry.row.subtype,
                vehicleType: vehicleTypeForFleetType(entry.row.fleetType),
                tipoFrota: entry.row.fleetType ?? 'Não classificado',
                filial: entry.row.branch ?? 'NAO_CLASSIFICADA',
                active: true,
                hasTimeClockDevice: false,
                veiculoManutencao: false,
                aethosVehicleId: entry.row.aethosId,
                aethosManaged: true,
                aethosCompanyId: entry.row.companyId,
                aethosSyncedAt: now,
                aethosRaw: entry.row.raw,
              },
            });
          }

          if (deactivate.length) {
            await tx.vehicle.updateMany({
              where: { id: { in: deactivate.map((vehicle) => vehicle.id) } },
              data: { active: false, aethosSyncedAt: now },
            });
          }

          const transactionVehicles = snapshot.statusEvents.length
            ? await tx.vehicle.findMany({
                select: {
                  id: true,
                  fleet: true,
                  plate: true,
                  active: true,
                  aethosVehicleId: true,
                  aethosManaged: true,
                },
              })
            : [];
          const storedAppliedEvents = snapshot.statusEvents.length
            ? await tx.aethosVehicleStatusEvent.findMany({
                where: {
                  aethosEventId: {
                    in: snapshot.statusEvents.map((event) => event.eventId),
                  },
                  applicationStatus: 'APPLIED',
                },
                select: { aethosEventId: true, vehicleId: true },
              })
            : [];
          const storedAppliedById = new Map(
            storedAppliedEvents.map((event) => [event.aethosEventId, event]),
          );
          const eventsToApply = snapshot.statusEvents.filter(
            (event) => !storedAppliedById.has(event.eventId),
          );
          const eventResolutions = resolveVehicleStatusEvents(
            eventsToApply,
            transactionVehicles,
          );
          const finalStatusEventResults: Array<{
            idEventoAethos: string;
            idVeiculoAethos: string;
            status: string;
            vehicleId: string | null;
            message: string | null;
          }> = snapshot.statusEvents
            .filter((event) => storedAppliedById.has(event.eventId))
            .map((event) => ({
              idEventoAethos: event.eventId,
              idVeiculoAethos: event.aethosId,
              status: 'ALREADY_PROCESSED',
              vehicleId: storedAppliedById.get(event.eventId)?.vehicleId ?? null,
              message: null,
            }));

          for (const resolution of eventResolutions) {
            const event = resolution.event;
            const vehicleId = resolution.vehicle?.id ?? null;
            let applicationStatus = resolution.status;
            let applicationMessage = resolution.message;

            if (resolution.status === 'APPLIED' && resolution.vehicle) {
              const shouldBeActive =
                event.currentStatus === 'S' && incomingIds.has(event.aethosId);
              if (event.currentStatus === 'S' && !shouldBeActive) {
                applicationStatus = 'CONFLICT';
                applicationMessage =
                  'Reativacao recebida, mas o veiculo nao consta na fotografia ativa atual.';
              } else {
                await setVehicleAuditContext(tx, {
                  source: 'AETHOS',
                  userId: event.changedByUserId,
                  name: event.changedByName || 'Integracao Aethos',
                  email: event.changedByLogin,
                });
                await tx.vehicle.update({
                  where: { id: resolution.vehicle.id },
                  data: {
                    active: shouldBeActive,
                    aethosVehicleId: event.aethosId,
                    aethosManaged: true,
                    aethosCompanyId: event.companyId,
                    aethosSyncedAt: now,
                  },
                });
              }
            }

            const applied = applicationStatus === 'APPLIED';
            await tx.aethosVehicleStatusEvent.upsert({
              where: { aethosEventId: event.eventId },
              create: {
                aethosEventId: event.eventId,
                aethosVehicleId: event.aethosId,
                vehicleId: applied ? vehicleId : null,
                companyId: event.companyId,
                fleet: event.fleet,
                plate: event.plate,
                previousStatus: event.previousStatus,
                currentStatus: event.currentStatus,
                changedAt: event.changedAt,
                changedByUserId: event.changedByUserId,
                changedByLogin: event.changedByLogin,
                changedByName: event.changedByName,
                effectiveEndAt: event.effectiveEndAt,
                inactiveReason: event.inactiveReason,
                source: event.source,
                applicationStatus,
                applicationMessage,
                appliedAt: applied ? now : null,
                raw: event.raw,
              },
              update: {
                vehicleId: applied ? vehicleId : null,
                companyId: event.companyId,
                fleet: event.fleet,
                plate: event.plate,
                previousStatus: event.previousStatus,
                currentStatus: event.currentStatus,
                changedAt: event.changedAt,
                changedByUserId: event.changedByUserId,
                changedByLogin: event.changedByLogin,
                changedByName: event.changedByName,
                effectiveEndAt: event.effectiveEndAt,
                inactiveReason: event.inactiveReason,
                source: event.source,
                applicationStatus,
                applicationMessage,
                appliedAt: applied ? now : null,
                raw: event.raw,
              },
            });

            finalStatusEventResults.push({
              idEventoAethos: event.eventId,
              idVeiculoAethos: event.aethosId,
              status: applicationStatus,
              vehicleId: applied ? vehicleId : null,
              message: applicationMessage,
            });
          }

          executedResult = {
            ...executedResult,
            statusEventsAppliedCount: finalStatusEventResults.filter(
              (event) => event.status === 'APPLIED',
            ).length,
            statusEventsAlreadyProcessedCount: finalStatusEventResults.filter(
              (event) => event.status === 'ALREADY_PROCESSED',
            ).length,
            statusEventsNotFoundCount: finalStatusEventResults.filter(
              (event) => event.status === 'NOT_FOUND',
            ).length,
            statusEventsConflictCount: finalStatusEventResults.filter(
              (event) => event.status === 'CONFLICT',
            ).length,
            confirmedStatusEventIds: finalStatusEventResults
              .filter((event) =>
                ['APPLIED', 'ALREADY_PROCESSED'].includes(event.status),
              )
              .map((event) => event.idEventoAethos),
            pendingStatusEventIds: finalStatusEventResults
              .filter((event) =>
                ['NOT_FOUND', 'CONFLICT'].includes(event.status),
              )
              .map((event) => event.idEventoAethos),
            statusEventResults: finalStatusEventResults,
          };

          await tx.aethosVehicleSyncRun.create({
            data: {
              snapshotId: snapshot.snapshotId,
              generatedAt: snapshot.generatedAt,
              payloadHash,
              receivedCount: snapshot.receivedCount,
              createdCount,
              linkedCount,
              updatedCount,
              reactivatedCount,
              deactivatedCount: deactivate.length,
              result: executedResult as Prisma.InputJsonValue,
            },
          });
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          message:
            'Conflito de identidade ao gravar a fotografia de veiculos. Revise placa, ID Aethos e regras de unicidade.',
          code: 'AETHOS_VEHICLE_IDENTITY_CONFLICT',
          target: error.meta?.target ?? null,
        });
      }
      throw error;
    }

    return executedResult;
  }
}
