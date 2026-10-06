import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const TIME_ZONE = 'America/Sao_Paulo';
const SYNC_CRON = process.env.BUCKET_ACTIVATION_SYNC_CRON || '*/5 * * * *';
const SOURCE_URL =
  process.env.BUCKET_ACTIVATION_SOURCE_URL ||
  'https://app.jrconstrucoes.net.br/api/bucket-activations/daily';
const SOURCE_TIMEOUT_MS = 120_000;
const GEOCODE_TIMEOUT_MS = 7_000;
const GEOCODE_DELAY_MS = 1_100;
const UNRESOLVED_ADDRESS = 'Endereco nao identificado';
const NULL_ISLAND_EPSILON = 0.0001;
const READ_ROLES = new Set([
  'admin',
  'administrator',
  'administrador',
  'gestor',
  'ceo',
  'administrativo',
  'financeiro',
]);

type JsonRecord = Record<string, unknown>;

export interface CachedEvent extends JsonRecord {
  eventAt?: string;
  startAt?: string;
  endAt?: string;
  durationSeconds?: number | null;
  alarmType?: string;
  restAlarmType?: string;
  address?: string | null;
  locationLabel?: string;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
  locationStatus?: string;
  locationTimeDifferenceSeconds?: number | null;
  activationSource?: string;
}

export interface CachedRow extends JsonRecord {
  vehicleId: string;
  vehiclePlate: string;
  vehicleName: string;
  date: string;
  activations: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  alarmTypes: string[];
  locationSummary: string;
  events: CachedEvent[];
}

export interface VehicleOption extends JsonRecord {
  id: string;
  plate: string;
  name: string;
}

interface SourceResponse extends JsonRecord {
  filters?: JsonRecord;
  summary?: JsonRecord;
  days?: Array<{ date: string; total: number }>;
  rows?: CachedRow[];
  vehicles?: JsonRecord[];
  vehicleOptions?: VehicleOption[];
  source?: JsonRecord;
}

export interface SnapshotPayload extends JsonRecord {
  rows: CachedRow[];
  vehicleOptions: VehicleOption[];
  source: JsonRecord;
}

export interface DateRange {
  from: string;
  to: string;
}

@Injectable()
export class BucketActivationCacheService implements OnModuleInit {
  private syncPromise: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const timer = setTimeout(() => void this.warmCacheOnStartup(), 5_000);
    timer.unref?.();
  }

  @Cron(SYNC_CRON, {
    name: 'bucket-activation-cache-incremental-sync',
    timeZone: TIME_ZONE,
  })
  async syncIncremental() {
    const today = formatLocalDay(new Date());
    const yesterday = shiftDate(today, -1);
    await this.synchronize(yesterday, today);
  }

  async getDaily(query: Record<string, unknown>, role?: string | null) {
    this.ensureReadAccess(role);
    const range = resolveRange(query);
    const expectedDays = buildDays(range.from, range.to);
    let snapshots = await this.readSnapshots(range);
    const availableDays = new Set(snapshots.map((item) => item.date));
    const missingDays = expectedDays.filter((day) => !availableDays.has(day));

    if (missingDays.length) {
      await this.synchronize(missingDays[0], missingDays.at(-1) as string);
      snapshots = await this.readSnapshots(range);
    }

    if (!snapshots.length) {
      throw new ServiceUnavailableException(
        'A sincronizacao dos acionamentos ainda nao esta disponivel',
      );
    }

    return composeCachedResponse(
      snapshots.map((item) => ({
        date: item.date,
        payload: asRecord(item.payload) as SnapshotPayload,
        sourceSyncedAt: item.sourceSyncedAt,
      })),
      range,
      cleanString(query.vehicleId),
      cleanString(query.search),
    );
  }

  private async warmCacheOnStartup() {
    const today = formatLocalDay(new Date());
    const currentMonthStart = `${today.slice(0, 7)}-01`;

    try {
      await this.synchronize(currentMonthStart, today);

      const configuredStart = cleanString(
        process.env.BUCKET_ACTIVATION_BACKFILL_FROM,
      );
      const defaultStart = `${today.slice(0, 4)}-01-01`;
      const backfillFrom = normalizeDateOnly(configuredStart) || defaultStart;
      const historicalRanges = splitIntoMonthRanges(backfillFrom, today)
        .filter((range) => range.to < currentMonthStart)
        .reverse();

      for (const range of historicalRanges) {
        const count = await this.prisma.bucketActivationDailySnapshot.count({
          where: { date: { gte: range.from, lte: range.to } },
        });
        if (count === buildDays(range.from, range.to).length) continue;
        await this.synchronize(range.from, range.to);
      }
    } catch (error) {
      console.error(
        '[BucketActivationCache] falha no aquecimento inicial:',
        error,
      );
    }
  }

  private async synchronize(from: string, to: string) {
    if (this.syncPromise) await this.syncPromise;

    const task = this.synchronizeRange(from, to);
    this.syncPromise = task;
    try {
      await task;
    } finally {
      if (this.syncPromise === task) this.syncPromise = null;
    }
  }

  private async synchronizeRange(from: string, to: string) {
    const ranges = splitIntoMonthRanges(from, to);
    for (const range of ranges) {
      const source = await this.fetchSource(range);
      await this.hydrateAddresses(source.rows || []);
      await this.storeDailySnapshots(source, range);
      console.log(
        `[BucketActivationCache] ${range.from} a ${range.to} sincronizado`,
      );
    }
  }

  private async fetchSource(range: DateRange): Promise<SourceResponse> {
    const secret = cleanString(process.env.JWT_SECRET);
    if (!secret) {
      throw new ServiceUnavailableException(
        'JWT_SECRET indisponivel para sincronizar acionamentos',
      );
    }

    const url = new URL(SOURCE_URL);
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${createInternalJwt(secret)}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`fonte respondeu HTTP ${response.status}`);
      }
      return (await response.json()) as SourceResponse;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Nao foi possivel atualizar o cache de acionamentos: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async hydrateAddresses(rows: CachedRow[]) {
    const coordinates = new Map<
      string,
      { key: string; latitude: number; longitude: number }
    >();
    const directAddresses = new Map<
      string,
      { key: string; latitude: number; longitude: number; address: string }
    >();

    for (const row of rows) {
      for (const event of row.events || []) {
        const latitude = toNumber(event.latitude);
        const longitude = toNumber(event.longitude);
        if (
          latitude === null ||
          longitude === null ||
          !isUsableCoordinate(latitude, longitude)
        ) {
          continue;
        }
        const key = geocodeKey(latitude, longitude);
        coordinates.set(key, { key, latitude, longitude });
        const address = cleanAddress(event.address);
        if (address) {
          directAddresses.set(key, { key, latitude, longitude, address });
        }
      }
    }

    for (const item of directAddresses.values()) {
      await this.prisma.bucketActivationAddress.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          latitude: item.latitude,
          longitude: item.longitude,
          address: item.address,
          source: 'moovsec',
          resolvedAt: new Date(),
        },
        update: {
          latitude: item.latitude,
          longitude: item.longitude,
          address: item.address,
          source: 'moovsec',
          resolvedAt: new Date(),
        },
      });
    }

    const cached = coordinates.size
      ? await this.prisma.bucketActivationAddress.findMany({
          where: { key: { in: Array.from(coordinates.keys()) } },
        })
      : [];
    const addressByKey = new Map(
      cached.map((item) => [item.key, item.address]),
    );

    for (const item of coordinates.values()) {
      if (addressByKey.has(item.key)) continue;
      const resolved = await this.reverseGeocodeAddress(
        item.latitude,
        item.longitude,
      );
      if (resolved.address) {
        const raw =
          resolved.raw === null
            ? Prisma.JsonNull
            : (resolved.raw as Prisma.InputJsonValue);
        await this.prisma.bucketActivationAddress.upsert({
          where: { key: item.key },
          create: {
            key: item.key,
            latitude: item.latitude,
            longitude: item.longitude,
            address: resolved.address,
            source: 'nominatim',
            raw,
            resolvedAt: new Date(),
          },
          update: {
            latitude: item.latitude,
            longitude: item.longitude,
            address: resolved.address,
            source: 'nominatim',
            raw,
            resolvedAt: new Date(),
          },
        });
        addressByKey.set(item.key, resolved.address);
      }
      await sleep(GEOCODE_DELAY_MS);
    }

    for (const row of rows) {
      for (const event of row.events || []) {
        const latitude = toNumber(event.latitude);
        const longitude = toNumber(event.longitude);
        if (
          latitude === null ||
          longitude === null ||
          !isUsableCoordinate(latitude, longitude)
        ) {
          continue;
        }
        const address =
          addressByKey.get(geocodeKey(latitude, longitude)) ||
          UNRESOLVED_ADDRESS;
        event.address = address;
        event.locationLabel = address;
      }
      row.locationSummary = summarizeLocations(row.events || []);
    }
  }

  private async reverseGeocodeAddress(latitude: number, longitude: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('zoom', '18');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('layer', 'address');
      url.searchParams.set('accept-language', 'pt-BR');
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://app.jrconstrucoes.net.br',
          'User-Agent': 'JR-Construcoes-Sistema/1.0 (app.jrconstrucoes.net.br)',
        },
        signal: controller.signal,
      });
      if (!response.ok) return { address: null, raw: null };
      const raw = asRecord(await response.json());
      return { address: formatGeocodeAddress(raw), raw };
    } catch {
      return { address: null, raw: null };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async storeDailySnapshots(source: SourceResponse, range: DateRange) {
    const syncedAt = new Date();
    const rows = source.rows || [];
    const vehicleOptions = source.vehicleOptions || [];
    const sourceMetadata = source.source || {};

    for (const date of buildDays(range.from, range.to)) {
      const dayRows = rows.filter((row) => row.date === date);
      const events = dayRows.flatMap((row) => row.events || []);
      const addressCount = events.filter((event) =>
        Boolean(cleanAddress(event.address)),
      ).length;
      const unresolvedAddressCount = events.filter(
        (event) => cleanString(event.address) === UNRESOLVED_ADDRESS,
      ).length;
      const payload: SnapshotPayload = {
        rows: dayRows,
        vehicleOptions,
        source: sourceMetadata,
      };
      const jsonPayload = payload as unknown as Prisma.InputJsonValue;

      await this.prisma.bucketActivationDailySnapshot.upsert({
        where: { date },
        create: {
          date,
          payload: jsonPayload,
          eventCount: events.length,
          addressCount,
          unresolvedAddressCount,
          sourceSyncedAt: syncedAt,
        },
        update: {
          payload: jsonPayload,
          eventCount: events.length,
          addressCount,
          unresolvedAddressCount,
          sourceSyncedAt: syncedAt,
        },
      });
    }
  }

  private readSnapshots(range: DateRange) {
    return this.prisma.bucketActivationDailySnapshot.findMany({
      where: { date: { gte: range.from, lte: range.to } },
      orderBy: { date: 'asc' },
    });
  }

  private ensureReadAccess(role?: string | null) {
    if (!READ_ROLES.has(cleanString(role).toLowerCase())) {
      throw new ForbiddenException(
        'Sem permissao para acessar o rastreamento de frota',
      );
    }
  }
}

export function composeCachedResponse(
  snapshots: Array<{
    date: string;
    payload: SnapshotPayload;
    sourceSyncedAt: Date;
  }>,
  range: DateRange,
  selectedVehicleId = '',
  search = '',
) {
  const normalizedSearch = normalizeText(search);
  const rows = snapshots
    .flatMap((snapshot) => snapshot.payload.rows || [])
    .filter((row) => {
      if (selectedVehicleId && row.vehicleId !== selectedVehicleId)
        return false;
      if (!normalizedSearch) return true;
      return normalizeText(`${row.vehiclePlate} ${row.vehicleName}`).includes(
        normalizedSearch,
      );
    })
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.vehiclePlate.localeCompare(right.vehiclePlate, 'pt-BR', {
          numeric: true,
          sensitivity: 'base',
        }),
    );
  const optionsById = new Map<string, VehicleOption>();
  for (const snapshot of snapshots) {
    for (const option of snapshot.payload.vehicleOptions || []) {
      optionsById.set(option.id, option);
    }
  }
  for (const row of rows) {
    if (!optionsById.has(row.vehicleId)) {
      optionsById.set(row.vehicleId, {
        id: row.vehicleId,
        plate: row.vehiclePlate,
        name: row.vehicleName,
      });
    }
  }
  const vehicleOptions = Array.from(optionsById.values())
    .filter((vehicle) => {
      if (selectedVehicleId && vehicle.id !== selectedVehicleId) return false;
      if (!normalizedSearch) return true;
      return normalizeText(`${vehicle.plate} ${vehicle.name}`).includes(
        normalizedSearch,
      );
    })
    .sort((left, right) =>
      left.plate.localeCompare(right.plate, 'pt-BR', {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  const vehicleTotals = new Map<
    string,
    {
      vehicleId: string;
      vehiclePlate: string;
      vehicleName: string;
      total: number;
      days: Set<string>;
      lastEventAt: string | null;
    }
  >();
  for (const row of rows) {
    const current = vehicleTotals.get(row.vehicleId) || {
      vehicleId: row.vehicleId,
      vehiclePlate: row.vehiclePlate,
      vehicleName: row.vehicleName,
      total: 0,
      days: new Set<string>(),
      lastEventAt: null,
    };
    current.total += Number(row.activations) || 0;
    current.days.add(row.date);
    if (
      row.lastEventAt &&
      (!current.lastEventAt || row.lastEventAt > current.lastEventAt)
    ) {
      current.lastEventAt = row.lastEventAt;
    }
    vehicleTotals.set(row.vehicleId, current);
  }
  const vehicles = Array.from(vehicleTotals.values())
    .map((vehicle) => ({
      vehicleId: vehicle.vehicleId,
      vehiclePlate: vehicle.vehiclePlate,
      vehicleName: vehicle.vehicleName,
      total: vehicle.total,
      daysWithEvents: vehicle.days.size,
      lastEventAt: vehicle.lastEventAt,
    }))
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.vehiclePlate.localeCompare(right.vehiclePlate, 'pt-BR', {
          numeric: true,
          sensitivity: 'base',
        }),
    );
  const days = buildDays(range.from, range.to).map((date) => ({
    date,
    total: rows
      .filter((row) => row.date === date)
      .reduce((sum, row) => sum + (Number(row.activations) || 0), 0),
  }));
  const totalActivations = rows.reduce(
    (sum, row) => sum + (Number(row.activations) || 0),
    0,
  );
  const activeDays = days.filter((day) => day.total > 0).length;
  const latestEventAt = rows.reduce<string | null>(
    (latest, row) =>
      row.lastEventAt && (!latest || row.lastEventAt > latest)
        ? row.lastEventAt
        : latest,
    null,
  );
  const lastSync = snapshots.reduce(
    (latest, item) =>
      item.sourceSyncedAt > latest ? item.sourceSyncedAt : latest,
    new Date(0),
  );
  const latestSource = snapshots.at(-1)?.payload.source || {};

  return {
    filters: {
      from: range.from,
      to: range.to,
      vehicleId: selectedVehicleId || null,
      search: search || null,
    },
    summary: {
      vehicles: vehicleOptions.length,
      vehiclesWithEvents: vehicles.length,
      totalActivations,
      averagePerDay: days.length
        ? Number((totalActivations / days.length).toFixed(1))
        : 0,
      averagePerActiveDay: activeDays
        ? Number((totalActivations / activeDays).toFixed(1))
        : 0,
      latestEventAt,
      lastSync: lastSync.toISOString(),
    },
    days,
    rows,
    vehicles,
    vehicleOptions,
    source: {
      ...latestSource,
      cache: 'jr-database',
      cachedDays: snapshots.length,
    },
  };
}

function createInternalJwt(secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'bucket-cache-sync',
      role: 'admin',
      iat: now,
      exp: now + 300,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function resolveRange(query: Record<string, unknown>): DateRange {
  const today = formatLocalDay(new Date());
  const currentMonth = today.slice(0, 7);
  const from =
    normalizeDateOnly(cleanString(query.from)) || `${currentMonth}-01`;
  const to = normalizeDateOnly(cleanString(query.to)) || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

function splitIntoMonthRanges(from: string, to: string): DateRange[] {
  const ranges: DateRange[] = [];
  let cursor = from;
  while (cursor <= to) {
    const monthEnd = endOfMonth(cursor);
    const rangeEnd = monthEnd < to ? monthEnd : to;
    ranges.push({ from: cursor, to: rangeEnd });
    cursor = shiftDate(rangeEnd, 1);
  }
  return ranges;
}

function endOfMonth(date: string) {
  const [year, month] = date.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  nextMonth.setUTCDate(0);
  return nextMonth.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildDays(from: string, to: string) {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return days;
}

function formatLocalDay(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function geocodeKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function isUsableCoordinate(latitude: number | null, longitude: number | null) {
  return (
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(
      Math.abs(latitude) < NULL_ISLAND_EPSILON &&
      Math.abs(longitude) < NULL_ISLAND_EPSILON
    )
  );
}

function summarizeLocations(events: CachedEvent[]) {
  const locations = Array.from(
    new Set(
      events
        .map((event) => cleanString(event.address || event.locationLabel))
        .filter(Boolean),
    ),
  );
  if (!locations.length) return 'Localizacao nao informada';
  if (locations.length === 1) return locations[0];
  return `${locations.length} locais registrados`;
}

function formatGeocodeAddress(payload: JsonRecord) {
  const address = asRecord(payload.address);
  const road = cleanString(
    address.road ??
      address.pedestrian ??
      address.footway ??
      address.cycleway ??
      address.path,
  );
  const number = cleanString(address.house_number);
  const neighborhood = cleanString(
    address.neighbourhood ??
      address.suburb ??
      address.hamlet ??
      address.village ??
      address.city_district,
  );
  const city = cleanString(
    address.city ?? address.town ?? address.municipality ?? address.county,
  );
  const state = cleanString(address.state);
  const postcode = cleanString(address.postcode);
  const roadWithNumber = [road, number].filter(Boolean).join(', ');
  return (
    [roadWithNumber, neighborhood, city, state, postcode]
      .filter(Boolean)
      .join(', ') ||
    cleanString(payload.display_name) ||
    null
  );
}

function cleanAddress(value: unknown) {
  const address = cleanString(value);
  if (!address || address === UNRESOLVED_ADDRESS) return '';
  return address;
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanString(value: unknown) {
  if (Array.isArray(value)) return cleanString(value[0]);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value).trim();
  }
  return '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
