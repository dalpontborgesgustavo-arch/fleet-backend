import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const READ_ROLES = new Set([
  'admin',
  'administrator',
  'administrador',
  'gestor',
  'ceo',
  'administrativo',
  'financeiro',
]);
const TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_BASE_URL = 'https://moovsec.itsmil.com:5000';
const DEFAULT_FALLBACK_TYPES = ['6'];
const MAX_ALARM_PAGES = 120;
const ALARM_PAGE_SIZE = 500;
const GEOCODE_TIMEOUT_MS = 7000;
const UNRESOLVED_ADDRESS = 'Endereco nao identificado';

type MoovsecRecord = Record<string, unknown>;

interface VehicleInfo {
  id: string;
  plate: string;
  name: string;
}

interface AlarmRecord {
  _id?: string;
  vehicleId?: string;
  vehiclePlate?: string;
  time?: string;
  type?: string | number;
  title?: string;
  location?: unknown;
}

interface BucketActivationEvent {
  eventAt: string;
  alarmType: string;
  address: string | null;
  locationLabel: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
}

interface DailyRow {
  vehicleId: string;
  vehiclePlate: string;
  vehicleName: string;
  date: string;
  activations: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  alarmTypes: string[];
  locationSummary: string;
  events: BucketActivationEvent[];
}

@Injectable()
export class BucketActivationsService {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getDaily(query: Record<string, unknown>, role?: string | null) {
    this.ensureReadAccess(role);

    const range = this.resolveRange(query);
    const search = cleanString(query.search);
    const selectedVehicleId = cleanString(query.vehicleId);
    const vehicles = await this.fetchVehicles();
    const devices = await this.fetchDevices();
    const vehicleMap = new Map(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const bucketTypesByVehicle = this.mapBucketTypesByVehicle(devices);
    const fallbackTypes = this.getFallbackAlarmTypes();
    const candidateAlarmTypes = Array.from(
      new Set([
        ...fallbackTypes,
        ...Array.from(bucketTypesByVehicle.values()).flatMap((types) =>
          Array.from(types),
        ),
      ]),
    ).filter(Boolean);

    const filteredVehicles = vehicles.filter((vehicle) => {
      if (selectedVehicleId && vehicle.id !== selectedVehicleId) return false;
      if (!search) return true;
      const haystack = normalizeText(`${vehicle.plate} ${vehicle.name}`);
      return haystack.includes(normalizeText(search));
    });

    if (!filteredVehicles.length) {
      return this.emptyResponse(
        range,
        vehicles,
        devices,
        bucketTypesByVehicle,
        {
          search,
          vehicleId: selectedVehicleId,
          candidateAlarmTypes,
        },
      );
    }

    const alarms = await this.fetchAlarms({
      vehicleIds: filteredVehicles.map((vehicle) => vehicle.id),
      alarmTypes: candidateAlarmTypes.length
        ? candidateAlarmTypes
        : fallbackTypes,
      initialDate: range.initialDate,
      finalDate: range.finalDate,
    });

    const rowsByKey = new Map<string, DailyRow>();
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

    for (const alarm of alarms) {
      if (!this.isBucketActivation(alarm, bucketTypesByVehicle, fallbackTypes))
        continue;

      const vehicleId = cleanString(alarm.vehicleId);
      if (!vehicleId) continue;

      const eventDate = parseEventDate(alarm.time);
      if (!eventDate) continue;

      const day = formatLocalDay(eventDate);
      if (day < range.from || day > range.to) continue;

      const vehicle = vehicleMap.get(vehicleId);
      const vehiclePlate =
        cleanString(alarm.vehiclePlate) || vehicle?.plate || vehicleId;
      const vehicleName = vehicle?.name || vehiclePlate;
      const key = `${vehicleId}|${day}`;
      const alarmType = cleanString(alarm.type);
      const eventIso = eventDate.toISOString();

      const row =
        rowsByKey.get(key) ||
        ({
          vehicleId,
          vehiclePlate,
          vehicleName,
          date: day,
          activations: 0,
          firstEventAt: null,
          lastEventAt: null,
          alarmTypes: [],
          locationSummary: '-',
          events: [],
        } satisfies DailyRow);

      const location = extractAlarmLocation(alarm);
      row.activations += 1;
      row.firstEventAt =
        !row.firstEventAt || eventIso < row.firstEventAt
          ? eventIso
          : row.firstEventAt;
      row.lastEventAt =
        !row.lastEventAt || eventIso > row.lastEventAt
          ? eventIso
          : row.lastEventAt;
      if (alarmType && !row.alarmTypes.includes(alarmType)) {
        row.alarmTypes.push(alarmType);
      }
      row.events.push({
        eventAt: eventIso,
        alarmType,
        address: location?.address || null,
        locationLabel: location?.label || 'Localizacao nao informada',
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        mapsUrl: location?.mapsUrl || null,
      });
      rowsByKey.set(key, row);

      const current = vehicleTotals.get(vehicleId) || {
        vehicleId,
        vehiclePlate,
        vehicleName,
        total: 0,
        days: new Set<string>(),
        lastEventAt: null,
      };
      current.total += 1;
      current.days.add(day);
      current.lastEventAt =
        !current.lastEventAt || eventIso > current.lastEventAt
          ? eventIso
          : current.lastEventAt;
      vehicleTotals.set(vehicleId, current);
    }

    const rows = Array.from(rowsByKey.values())
      .map((row) => ({
        ...row,
        locationSummary: summarizeLocations(row.events),
        events: row.events.sort((left, right) =>
          left.eventAt.localeCompare(right.eventAt),
        ),
      }))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.vehiclePlate.localeCompare(b.vehiclePlate, 'pt-BR', {
            numeric: true,
            sensitivity: 'base',
          }),
      );
    await this.applyStoredAddresses(rows);
    const days = buildDays(range.from, range.to).map((date) => ({
      date,
      total: rows
        .filter((row) => row.date === date)
        .reduce((sum, row) => sum + row.activations, 0),
    }));
    const vehiclesSummary = Array.from(vehicleTotals.values())
      .map((vehicle) => ({
        vehicleId: vehicle.vehicleId,
        vehiclePlate: vehicle.vehiclePlate,
        vehicleName: vehicle.vehicleName,
        total: vehicle.total,
        daysWithEvents: vehicle.days.size,
        lastEventAt: vehicle.lastEventAt,
      }))
      .sort(
        (a, b) =>
          b.total - a.total ||
          a.vehiclePlate.localeCompare(b.vehiclePlate, 'pt-BR', {
            numeric: true,
            sensitivity: 'base',
          }),
      );
    const totalActivations = rows.reduce(
      (sum, row) => sum + row.activations,
      0,
    );

    return {
      filters: {
        from: range.from,
        to: range.to,
        vehicleId: selectedVehicleId || null,
        search: search || null,
      },
      summary: {
        vehicles: filteredVehicles.length,
        vehiclesWithEvents: vehiclesSummary.length,
        totalActivations,
        averagePerActiveDay: days.length
          ? Number((totalActivations / days.length).toFixed(1))
          : 0,
        lastSync: new Date().toISOString(),
      },
      days,
      rows,
      vehicles: vehiclesSummary,
      vehicleOptions: filteredVehicles,
      source: {
        fetchedVehicles: vehicles.length,
        fetchedDevices: devices.length,
        mappedVehicles: bucketTypesByVehicle.size,
        candidateAlarmTypes,
      },
    };
  }

  async resolveAddress(query: Record<string, unknown>, role?: string | null) {
    this.ensureReadAccess(role);

    const latitude = toNumber(query.lat);
    const longitude = toNumber(query.lon);
    if (
      latitude === null ||
      longitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException('Coordenada invalida');
    }

    const key = geocodeKey(latitude, longitude);
    const cached = await this.prisma.bucketActivationAddress.findUnique({
      where: { key },
    });
    if (cached) {
      return {
        key,
        address: cached.address,
        source: 'cache',
      };
    }

    const resolved = await this.reverseGeocodeAddress(latitude, longitude);
    const address = resolved.address || UNRESOLVED_ADDRESS;
    const source = resolved.address ? 'nominatim' : 'unresolved';

    if (resolved.cacheable) {
      const raw =
        resolved.raw === null
          ? Prisma.JsonNull
          : (resolved.raw as Prisma.InputJsonValue);

      await this.prisma.bucketActivationAddress.upsert({
        where: { key },
        create: {
          key,
          latitude,
          longitude,
          address,
          source,
          raw,
          resolvedAt: new Date(),
        },
        update: {
          latitude,
          longitude,
          address,
          source,
          raw,
          resolvedAt: new Date(),
        },
      });
    }

    return {
      key,
      address,
      source,
    };
  }

  private async applyStoredAddresses(rows: DailyRow[]) {
    const keys = new Set<string>();

    for (const row of rows) {
      for (const event of row.events) {
        if (event.address) continue;
        if (event.latitude === null || event.longitude === null) continue;
        keys.add(geocodeKey(event.latitude, event.longitude));
      }
    }

    if (!keys.size) return;

    const cachedAddresses = await this.prisma.bucketActivationAddress.findMany({
      where: {
        key: {
          in: Array.from(keys),
        },
      },
    });
    const addressByKey = new Map(
      cachedAddresses.map((item) => [item.key, item.address]),
    );

    for (const row of rows) {
      for (const event of row.events) {
        if (event.address) continue;
        if (event.latitude === null || event.longitude === null) continue;
        const address = addressByKey.get(
          geocodeKey(event.latitude, event.longitude),
        );
        if (!address) continue;
        event.address = address;
        event.locationLabel = address;
      }
      row.locationSummary = summarizeLocations(row.events);
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

      if (!response.ok) {
        return {
          address: null,
          raw: null,
          cacheable: false,
        };
      }

      const raw = (await response.json()) as MoovsecRecord;
      return {
        address: formatGeocodeAddress(raw),
        raw,
        cacheable: true,
      };
    } catch {
      return {
        address: null,
        raw: null,
        cacheable: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private ensureReadAccess(role?: string | null) {
    if (!READ_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException(
        'Sem permissao para acessar acionamentos de cacamba',
      );
    }
  }

  private async fetchVehicles(): Promise<VehicleInfo[]> {
    const payload = await this.moovsecFetch('/vehicle/all/true');
    return unwrapArray<MoovsecRecord>(payload)
      .map((vehicle) => {
        const id = cleanString(
          vehicle._id ?? vehicle.id ?? vehicle.vehicleId ?? vehicle.uid,
        );
        const plate =
          cleanString(
            vehicle.plate ?? vehicle.vehiclePlate ?? vehicle.prefix,
          ) || id;
        const name =
          cleanString(vehicle.name ?? vehicle.description ?? vehicle.label) ||
          plate;

        return { id, plate, name };
      })
      .filter((vehicle) => vehicle.id);
  }

  private async fetchDevices(): Promise<MoovsecRecord[]> {
    const payload = await this.moovsecFetch('/device/all/true');
    return unwrapArray<MoovsecRecord>(payload);
  }

  private mapBucketTypesByVehicle(devices: MoovsecRecord[]) {
    const typesByVehicle = new Map<string, Set<string>>();

    for (const device of devices) {
      const register = asRecord(device.register);
      const vehicle = asRecord(device.vehicle);
      const vehicleId = cleanString(
        register.vehicleId ??
          device.vehicleId ??
          vehicle._id ??
          vehicle.id ??
          device.vehicle,
      );
      if (!vehicleId) continue;

      const customInfo = arrayFromUnknown(
        register.customIOAlarmInfo ?? device.customIOAlarmInfo,
      );

      for (const item of customInfo) {
        const info = asRecord(item);
        const title = cleanString(info.title ?? info.name ?? info.label);
        const alarmType = cleanString(
          info.alarmType ?? info.type ?? info.alarm_type,
        );
        const normalizedTitle = normalizeText(title);

        if (
          alarmType &&
          normalizedTitle.includes('cacamba') &&
          normalizedTitle.includes('levant')
        ) {
          if (!typesByVehicle.has(vehicleId)) {
            typesByVehicle.set(vehicleId, new Set<string>());
          }
          typesByVehicle.get(vehicleId)?.add(alarmType);
        }
      }
    }

    return typesByVehicle;
  }

  private getFallbackAlarmTypes() {
    return (
      process.env.MOOVSEC_BUCKET_FALLBACK_ALARM_TYPES?.split(',') ||
      DEFAULT_FALLBACK_TYPES
    )
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isBucketActivation(
    alarm: AlarmRecord,
    bucketTypesByVehicle: Map<string, Set<string>>,
    fallbackTypes: string[],
  ) {
    const vehicleId = cleanString(alarm.vehicleId);
    const alarmType = cleanString(alarm.type);
    const title = normalizeText(cleanString(alarm.title));
    const vehicleTypes = vehicleId ? bucketTypesByVehicle.get(vehicleId) : null;

    if (vehicleTypes?.has(alarmType)) return true;
    if (title.includes('cacamba') && title.includes('levant')) return true;
    return !vehicleTypes?.size && fallbackTypes.includes(alarmType);
  }

  private async fetchAlarms(input: {
    vehicleIds: string[];
    alarmTypes: string[];
    initialDate: string;
    finalDate: string;
  }): Promise<AlarmRecord[]> {
    const alarms: AlarmRecord[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const payload = await this.moovsecFetch('/alarm/all', {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            vehicleIdList: input.vehicleIds,
            driversIdList: [],
            initialDate: input.initialDate,
            finalDate: input.finalDate,
            search: '',
            alarmTypes: input.alarmTypes,
            status: [0, 1, 2],
            criticality: [],
            order: 'descendingTime',
          },
          pagination: {
            page,
            limit: ALARM_PAGE_SIZE,
          },
        }),
      });
      const extracted = extractAlarmPage(payload, ALARM_PAGE_SIZE);
      alarms.push(...extracted.rows);
      totalPages = extracted.totalPages || totalPages;

      if (!extracted.rows.length) break;
      page += 1;
    } while (page <= totalPages && page <= MAX_ALARM_PAGES);

    return alarms;
  }

  private resolveRange(query: Record<string, unknown>) {
    const today = formatLocalDay(new Date());
    const currentMonth = today.slice(0, 7);
    const from =
      normalizeDateOnly(cleanString(query.from)) || `${currentMonth}-01`;
    const to = normalizeDateOnly(cleanString(query.to)) || today;
    const safeFrom = from <= to ? from : to;
    const safeTo = from <= to ? to : from;

    return {
      from: safeFrom,
      to: safeTo,
      initialDate: localDateToIso(safeFrom, false),
      finalDate: localDateToIso(safeTo, true),
    };
  }

  private emptyResponse(
    range: ReturnType<BucketActivationsService['resolveRange']>,
    vehicles: VehicleInfo[],
    devices: MoovsecRecord[],
    bucketTypesByVehicle: Map<string, Set<string>>,
    filters: {
      search: string;
      vehicleId: string;
      candidateAlarmTypes: string[];
    },
  ) {
    return {
      filters: {
        from: range.from,
        to: range.to,
        vehicleId: filters.vehicleId || null,
        search: filters.search || null,
      },
      summary: {
        vehicles: 0,
        vehiclesWithEvents: 0,
        totalActivations: 0,
        averagePerActiveDay: 0,
        lastSync: new Date().toISOString(),
      },
      days: buildDays(range.from, range.to).map((date) => ({ date, total: 0 })),
      rows: [],
      vehicles: [],
      vehicleOptions: [],
      source: {
        fetchedVehicles: vehicles.length,
        fetchedDevices: devices.length,
        mappedVehicles: bucketTypesByVehicle.size,
        candidateAlarmTypes: filters.candidateAlarmTypes,
      },
    };
  }

  private async moovsecFetch(path: string, init?: RequestInit, retry = true) {
    const baseUrl = (
      process.env.MOOVSEC_BASE_URL?.trim() || DEFAULT_BASE_URL
    ).replace(/\/$/, '');
    const token = await this.getToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });

      if (response.status === 401 && retry) {
        this.token = null;
        this.tokenExpiresAt = 0;
        return this.moovsecFetch(path, init, false);
      }

      if (!response.ok) {
        throw new BadGatewayException(
          `Moovsec retornou erro ${response.status}`,
        );
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const login = process.env.MOOVSEC_LOGIN?.trim();
    const password = process.env.MOOVSEC_PASSWORD;
    const baseUrl = (
      process.env.MOOVSEC_BASE_URL?.trim() || DEFAULT_BASE_URL
    ).replace(/\/$/, '');

    if (!login || !password) {
      throw new ServiceUnavailableException(
        'Credenciais do Moovsec nao configuradas',
      );
    }

    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login, password }),
    });

    if (!response.ok) {
      throw new BadGatewayException('Nao foi possivel autenticar no Moovsec');
    }

    const payload = (await response.json()) as MoovsecRecord;
    const token = cleanString(
      payload.data ?? payload.token ?? payload.accessToken,
    );

    if (!token) {
      throw new BadGatewayException('Moovsec nao retornou token de acesso');
    }

    this.token = token;
    this.tokenExpiresAt = Date.now() + 25 * 60 * 1000;
    return token;
  }
}

function normalizeRole(role?: string | null) {
  return String(role || '')
    .trim()
    .toLowerCase();
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

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function asRecord(value: unknown): MoovsecRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as MoovsecRecord;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractAlarmLocation(alarm: AlarmRecord) {
  const location = asRecord(alarm.location);
  const position = asRecord(location.position);
  const coordinates = arrayFromUnknown(position.coordinates);
  const address = extractLocationAddress(alarm, location);
  let longitude = toNumber(coordinates[0]);
  let latitude = toNumber(coordinates[1]);

  if (latitude === null || longitude === null) {
    latitude = toNumber(
      (alarm as MoovsecRecord).latitude ?? (alarm as MoovsecRecord).lat,
    );
    longitude = toNumber(
      (alarm as MoovsecRecord).longitude ?? (alarm as MoovsecRecord).lng,
    );
  }

  if (latitude === null || longitude === null) return null;

  const label = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  return {
    address,
    latitude,
    longitude,
    label,
    mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
  };
}

function extractLocationAddress(alarm: AlarmRecord, location: MoovsecRecord) {
  const candidates = [
    location.address,
    location.formattedAddress,
    location.formatted_address,
    location.fullAddress,
    location.full_address,
    location.description,
    location.label,
    location.name,
    (alarm as MoovsecRecord).address,
    (alarm as MoovsecRecord).locationAddress,
    (alarm as MoovsecRecord).formattedAddress,
  ];

  for (const candidate of candidates) {
    const address = formatAddressCandidate(candidate);
    if (address) return address;
  }

  return null;
}

function formatAddressCandidate(value: unknown): string | null {
  const direct = cleanString(value);
  if (
    direct &&
    direct !== '[object Object]' &&
    !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(direct)
  ) {
    return direct;
  }

  const record = asRecord(value);
  if (!Object.keys(record).length) return null;

  for (const key of [
    'formattedAddress',
    'formatted_address',
    'displayName',
    'display_name',
    'fullAddress',
    'full_address',
    'description',
    'label',
    'name',
  ]) {
    const nested = cleanString(record[key]);
    if (nested && nested !== '[object Object]') return nested;
  }

  const parts = [
    record.street ?? record.road ?? record.route ?? record.logradouro,
    record.number ?? record.houseNumber ?? record.house_number ?? record.numero,
    record.neighborhood ?? record.suburb ?? record.district ?? record.bairro,
    record.city ??
      record.town ??
      record.municipality ??
      record.locality ??
      record.cidade,
    record.state ?? record.uf,
  ]
    .map(cleanString)
    .filter(Boolean);

  return parts.length ? parts.join(', ') : null;
}

function summarizeLocations(events: BucketActivationEvent[]) {
  const locations = Array.from(
    new Map(
      events
        .filter((event) => event.latitude !== null && event.longitude !== null)
        .map((event) => [event.locationLabel, event]),
    ).values(),
  );

  if (!locations.length) return 'Localizacao nao informada';
  if (locations.length === 1) return locations[0].locationLabel;
  return `${locations.length} locais registrados`;
}

function toNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function geocodeKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function formatGeocodeAddress(payload: MoovsecRecord) {
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
  const compact = [roadWithNumber, neighborhood, city, state, postcode]
    .filter(Boolean)
    .join(', ');

  return compact || cleanString(payload.display_name) || null;
}

function unwrapArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];

  const record = asRecord(payload);
  for (const key of ['data', 'items', 'result', 'results', 'docs', 'list']) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
    const nested = asRecord(value);
    for (const nestedKey of [
      'docs',
      'items',
      'result',
      'results',
      'data',
      'list',
    ]) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as T[];
    }
  }

  return [];
}

function extractAlarmPage(payload: unknown, limit: number) {
  const data = Array.isArray(payload)
    ? { rows: payload as AlarmRecord[] }
    : asRecord(asRecord(payload).data ?? payload);
  const rows = unwrapArray<AlarmRecord>(data);
  const total =
    Number(
      data.totalDocs ??
        data.total ??
        data.count ??
        data.totalItems ??
        data.totalItens,
    ) || 0;
  const totalPages =
    Number(data.totalPages ?? data.pages) ||
    (total ? Math.ceil(total / limit) : rows.length === limit ? 2 : 1);

  return {
    rows,
    totalPages,
  };
}

function normalizeDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function localDateToIso(date: string, endOfDay: boolean) {
  const suffix = endOfDay ? 'T23:59:59.999-03:00' : 'T00:00:00.000-03:00';
  return new Date(`${date}${suffix}`).toISOString();
}

function parseEventDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function buildDays(from: string, to: string) {
  const days: string[] = [];
  const current = new Date(`${from}T12:00:00.000-03:00`);
  const last = new Date(`${to}T12:00:00.000-03:00`);

  while (current <= last) {
    days.push(formatLocalDay(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}
