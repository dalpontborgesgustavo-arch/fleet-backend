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
const LIVE_LOCATION_WINDOW_SECONDS = 5 * 60;
const RECENT_LOCATION_WINDOW_SECONDS = 30 * 60;
const VIDEO_FLEET_PATTERN = /dashcam/i;
const VIDEO_CHANNEL_MIN = 1;
const VIDEO_CHANNEL_MAX = 4;
const VIDEO_LINK_TTL_MS = 5 * 60 * 1000;

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

  async getFleetTracking(
    query: Record<string, unknown>,
    role?: string | null,
  ) {
    this.ensureReadAccess(role);

    const vehicleId = cleanString(query.vehicleId);
    if (vehicleId) {
      const parsedHours = Number(query.hours);
      const hours = Number.isFinite(parsedHours)
        ? Math.min(24, Math.max(1, Math.round(parsedHours)))
        : 6;
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const payload = await this.moovsecFetch('/gps/gpsByVehicle', {
        method: 'POST',
        body: JSON.stringify({
          vehicleIdList: [vehicleId],
          initialDate: from.toISOString(),
          finalDate: to.toISOString(),
          timeZone: '-03:00',
        }),
      });

      return buildFleetHistory(
        vehicleId,
        hours,
        from.toISOString(),
        to.toISOString(),
        unwrapArray<MoovsecRecord>(payload),
      );
    }

    const [vehiclePayload, devicePayload, fleetPayload] = await Promise.all([
      this.moovsecFetch('/vehicle/all/true'),
      this.moovsecFetch('/device/all/true'),
      this.moovsecFetch('/fleet/all/false'),
    ]);

    return buildFleetSnapshot(
      unwrapArray<MoovsecRecord>(vehiclePayload),
      unwrapArray<MoovsecRecord>(devicePayload),
      unwrapArray<MoovsecRecord>(fleetPayload),
    );
  }

  async getLiveVideo(
    query: Record<string, unknown>,
    role?: string | null,
  ) {
    this.ensureReadAccess(role);

    const [vehiclePayload, devicePayload, fleetPayload] = await Promise.all([
      this.moovsecFetch('/vehicle/all/true'),
      this.moovsecFetch('/device/all/true'),
      this.moovsecFetch('/fleet/all/false'),
    ]);
    const snapshot = buildFleetSnapshot(
      unwrapArray<MoovsecRecord>(vehiclePayload),
      unwrapArray<MoovsecRecord>(devicePayload),
      unwrapArray<MoovsecRecord>(fleetPayload),
    );
    const cameraVehicles = snapshot.vehicles.filter((vehicle) =>
      vehicle.fleetNames.some((fleetName) =>
        VIDEO_FLEET_PATTERN.test(fleetName),
      ),
    );
    const vehicleId = cleanString(query.vehicleId);

    if (!vehicleId) {
      return {
        summary: {
          cameraVehicles: cameraVehicles.length,
          connectedVehicles: cameraVehicles.filter(
            (vehicle) => vehicle.connectionStatus === 'connected',
          ).length,
        },
        vehicles: cameraVehicles.map((vehicle) => ({
          id: vehicle.id,
          plate: vehicle.plate,
          name: vehicle.name,
          connectionStatus: vehicle.connectionStatus,
          connectionAt: vehicle.connectionAt,
          fleetNames: vehicle.fleetNames,
        })),
        channels: Array.from(
          { length: VIDEO_CHANNEL_MAX },
          (_, index) => ({
            id: index + VIDEO_CHANNEL_MIN,
            label: `Camera ${index + VIDEO_CHANNEL_MIN}`,
          }),
        ),
        generatedAt: new Date().toISOString(),
      };
    }

    const vehicle = cameraVehicles.find((item) => item.id === vehicleId);
    if (!vehicle) {
      throw new BadRequestException(
        'Veiculo sem camera liberada para video ao vivo',
      );
    }

    const channel = Number(query.channel ?? VIDEO_CHANNEL_MIN);
    if (
      !Number.isInteger(channel) ||
      channel < VIDEO_CHANNEL_MIN ||
      channel > VIDEO_CHANNEL_MAX
    ) {
      throw new BadRequestException('Canal de camera invalido');
    }

    const hdQuality = parseBoolean(query.hdQuality, false);
    const payload = asRecord(
      await this.moovsecFetch(
        `/video/realTimeStreaming/${encodeURIComponent(vehicleId)}/${channel}/${hdQuality}/true/true`,
      ),
    );
    const data = asRecord(payload.data ?? payload);
    const rawAddress = cleanString(data.address ?? payload.address);
    const address = normalizeLiveVideoAddress(
      rawAddress,
      process.env.MOOVSEC_BASE_URL?.trim() || DEFAULT_BASE_URL,
    );
    if (!address) {
      throw new BadGatewayException(
        'Moovsec nao retornou um endereco de video valido',
      );
    }

    return {
      vehicle: {
        id: vehicle.id,
        plate: vehicle.plate,
        name: vehicle.name,
        connectionStatus: vehicle.connectionStatus,
      },
      channel,
      quality: hdQuality ? 'hd' : 'standard',
      isThumbnail: data.isThumbnail === true,
      address,
      format: detectLiveVideoFormat(address, data.isThumbnail === true),
      expiresAt: new Date(Date.now() + VIDEO_LINK_TTL_MS).toISOString(),
    };
  }

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
        'Sem permissao para acessar o rastreamento de frota',
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

function parseBoolean(value: unknown, fallback: boolean) {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

export function normalizeLiveVideoAddress(
  value: string,
  moovsecBaseUrl: string,
) {
  if (!value) return '';
  try {
    const address = new URL(value);
    if (!['http:', 'https:'].includes(address.protocol)) return '';
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(address.hostname)) {
      address.hostname = new URL(moovsecBaseUrl).hostname;
    }
    return address.toString();
  } catch {
    return '';
  }
}

function detectLiveVideoFormat(address: string, isThumbnail: boolean) {
  if (isThumbnail) return 'image';
  const pathname = new URL(address).pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'hls';
  if (pathname.endsWith('.mp4')) return 'mp4';
  return 'stream';
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

interface FleetHistoryPoint {
  latitude: number;
  longitude: number;
  time: string;
  speed: number | null;
  directionDegrees: number | null;
  altitude: number | null;
  stoppedInPlace: boolean | null;
}

export function buildFleetSnapshot(
  rawVehicles: MoovsecRecord[],
  rawDevices: MoovsecRecord[],
  rawFleets: MoovsecRecord[],
  nowMs = Date.now(),
) {
  const fleetNamesById = new Map<string, string>();
  const fleetVehicleCounts = new Map<string, number>();

  for (const rawFleet of rawFleets) {
    const fleet = asRecord(rawFleet);
    const id = cleanString(fleet._id ?? fleet.id);
    const name = cleanString(fleet.name ?? fleet.label) || 'Frota sem nome';
    if (id) fleetNamesById.set(id, name);
    fleetVehicleCounts.set(name, arrayFromUnknown(fleet.vehicleList).length);
  }

  const devicesByVehicle = new Map<string, number>();
  for (const rawDevice of rawDevices) {
    const device = asRecord(rawDevice);
    const register = asRecord(device.register);
    const linkedVehicle = asRecord(device.vehicle);
    const vehicleId = cleanString(
      register.vehicleId ??
        device.vehicleId ??
        linkedVehicle._id ??
        linkedVehicle.id,
    );
    if (vehicleId) {
      devicesByVehicle.set(
        vehicleId,
        (devicesByVehicle.get(vehicleId) || 0) + 1,
      );
    }
  }

  const vehicles = rawVehicles
    .map((rawVehicle) => {
      const vehicle = asRecord(rawVehicle);
      const id = cleanString(vehicle._id ?? vehicle.id ?? vehicle.vehicleId);
      if (!id) return null;

      const plate =
        cleanString(
          vehicle.plate ?? vehicle.vehiclePlate ?? vehicle.prefix,
        ) || id;
      const name =
        cleanString(vehicle.name ?? vehicle.description ?? vehicle.label) ||
        plate;
      const location = asRecord(vehicle.lastKnownLocation);
      const position = asRecord(location.position);
      const coordinates = arrayFromUnknown(position.coordinates);
      const rawLongitude = toNumber(coordinates[0]);
      const rawLatitude = toNumber(coordinates[1]);
      const usable = isUsableFleetCoordinate(rawLatitude, rawLongitude);
      const latitude = usable ? rawLatitude : null;
      const longitude = usable ? rawLongitude : null;
      const locationAt = toIsoString(location.time);
      const locationAgeSeconds = locationAt
        ? Math.max(
            0,
            Math.round((nowMs - new Date(locationAt).getTime()) / 1000),
          )
        : null;
      const locationFreshness =
        !usable || locationAgeSeconds === null
          ? 'missing'
          : locationAgeSeconds <= LIVE_LOCATION_WINDOW_SECONDS
            ? 'live'
            : locationAgeSeconds <= RECENT_LOCATION_WINDOW_SECONDS
              ? 'recent'
              : 'stale';
      const connection = asRecord(vehicle.lastConnectionStatus);
      const rawConnectionStatus = normalizeRole(
        cleanString(connection.status),
      );
      const connectionStatus =
        rawConnectionStatus === 'connected'
          ? 'connected'
          : rawConnectionStatus === 'disconnected'
            ? 'disconnected'
            : 'unknown';
      const stoppedInPlace =
        typeof location.stoppedInPlace === 'boolean'
          ? location.stoppedInPlace
          : null;
      const movementStatus =
        stoppedInPlace === true
          ? 'stopped'
          : stoppedInPlace === false
            ? 'moving'
            : 'unknown';
      const lastDriver = asRecord(vehicle.lastDriver);
      const fleetNames = arrayFromUnknown(vehicle.fleetList)
        .map((value) => {
          const fleetRecord = asRecord(value);
          const directName = cleanString(fleetRecord.name);
          if (directName) return directName;
          const fleetId = cleanString(
            fleetRecord._id ?? fleetRecord.id ?? value,
          );
          return fleetNamesById.get(fleetId) || '';
        })
        .filter(Boolean);

      return {
        id,
        plate,
        name,
        latitude,
        longitude,
        mapsUrl: usable
          ? `https://www.google.com/maps?q=${latitude},${longitude}`
          : null,
        locationAt,
        locationAgeSeconds,
        locationFreshness,
        connectionStatus,
        connectionAt: toIsoString(connection.time),
        network: cleanString(connection.network) || null,
        movementStatus,
        stoppedInPlace,
        directionDegrees: toNumber(location.direction),
        ignitionStatus: cleanString(vehicle.lastIgnitionStatus) || null,
        driverName:
          cleanString(
            lastDriver.name ??
              lastDriver.driverName ??
              vehicle.lastDriverName,
          ) || null,
        fleetNames: Array.from(new Set(fleetNames)),
        deviceCount:
          devicesByVehicle.get(id) ||
          arrayFromUnknown(vehicle.deviceList).length,
      };
    })
    .filter((vehicle): vehicle is NonNullable<typeof vehicle> => Boolean(vehicle))
    .sort((left, right) => {
      const freshnessRank: Record<string, number> = {
        live: 0,
        recent: 1,
        stale: 2,
        missing: 3,
      };
      const freshnessDifference =
        freshnessRank[left.locationFreshness] -
        freshnessRank[right.locationFreshness];
      if (freshnessDifference) return freshnessDifference;
      if (left.connectionStatus !== right.connectionStatus) {
        return left.connectionStatus === 'connected' ? -1 : 1;
      }
      return left.plate.localeCompare(right.plate, 'pt-BR', {
        numeric: true,
      });
    });

  const liveVehicles = vehicles.filter(
    (vehicle) => vehicle.locationFreshness === 'live',
  );

  return {
    summary: {
      totalVehicles: vehicles.length,
      locatedVehicles: vehicles.filter(
        (vehicle) => vehicle.latitude !== null,
      ).length,
      liveLocations: liveVehicles.length,
      connectedVehicles: vehicles.filter(
        (vehicle) => vehicle.connectionStatus === 'connected',
      ).length,
      disconnectedVehicles: vehicles.filter(
        (vehicle) => vehicle.connectionStatus === 'disconnected',
      ).length,
      movingVehicles: liveVehicles.filter(
        (vehicle) => vehicle.movementStatus === 'moving',
      ).length,
      stoppedVehicles: liveVehicles.filter(
        (vehicle) => vehicle.movementStatus === 'stopped',
      ).length,
      staleLocations: vehicles.filter(
        (vehicle) => vehicle.locationFreshness === 'stale',
      ).length,
      lastSync: new Date(nowMs).toISOString(),
    },
    vehicles,
    fleets: Array.from(fleetVehicleCounts.entries())
      .map(([name, vehicleCount]) => ({ name, vehicleCount }))
      .sort((left, right) => right.vehicleCount - left.vehicleCount),
    source: {
      fetchedVehicles: rawVehicles.length,
      fetchedDevices: rawDevices.length,
      fetchedFleets: rawFleets.length,
      liveWindowMinutes: LIVE_LOCATION_WINDOW_SECONDS / 60,
      recentWindowMinutes: RECENT_LOCATION_WINDOW_SECONDS / 60,
    },
  };
}

export function buildFleetHistory(
  vehicleId: string,
  hours: number,
  from: string,
  to: string,
  rawGroups: MoovsecRecord[],
) {
  const matchedGroup = rawGroups.find((rawGroup) => {
    const candidate = asRecord(rawGroup);
    return cleanString(candidate._id ?? candidate.vehicleId) === vehicleId;
  });
  const group = asRecord(matchedGroup ?? rawGroups[0]);
  const points = arrayFromUnknown(group.gps)
    .map((rawPoint): FleetHistoryPoint | null => {
      const point = asRecord(rawPoint);
      const position = asRecord(point.position);
      const coordinates = arrayFromUnknown(position.coordinates);
      const longitude = toNumber(coordinates[0]);
      const latitude = toNumber(coordinates[1]);
      const time = toIsoString(point.time);
      if (!isUsableFleetCoordinate(latitude, longitude) || !time) return null;

      return {
        latitude: latitude as number,
        longitude: longitude as number,
        time,
        speed: toNumber(point.speed),
        directionDegrees: toNumber(point.direction),
        altitude: toNumber(point.altitude),
        stoppedInPlace:
          typeof point.stoppedInPlace === 'boolean'
            ? point.stoppedInPlace
            : null,
      };
    })
    .filter((point): point is FleetHistoryPoint => Boolean(point))
    .sort((left, right) => left.time.localeCompare(right.time));
  const speeds = points
    .map((point) => point.speed)
    .filter((speed): speed is number => speed !== null);

  return {
    vehicle: {
      id: vehicleId,
      plate: cleanString(group.plate ?? group.vehiclePlate) || vehicleId,
    },
    period: { hours, from, to },
    summary: {
      points: points.length,
      distanceKm: Number(routeDistanceKm(points).toFixed(2)),
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      lastSpeed: points.length ? points[points.length - 1].speed : null,
    },
    points,
  };
}

function routeDistanceKm(points: FleetHistoryPoint[]) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += haversineKm(points[index - 1], points[index]);
  }
  return distance;
}

function haversineKm(first: FleetHistoryPoint, second: FleetHistoryPoint) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = radians(second.latitude - first.latitude);
  const deltaLon = radians(second.longitude - first.longitude);
  const lat1 = radians(first.latitude);
  const lat2 = radians(second.latitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function isUsableFleetCoordinate(
  latitude: number | null,
  longitude: number | null,
) {
  return (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(
      Math.abs(latitude) < 0.0001 &&
      Math.abs(longitude) < 0.0001
    )
  );
}

function toIsoString(value: unknown) {
  if (!value) return null;
  const date = new Date(cleanString(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
