import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dateKey, parseDate, USINA_ASPHALT_TEAM_CONTEXT } from './usina-asphalt-teams.rules';

const QUERY_CODE = 'IND.BI.0025';
const SOURCE = 'TOTVS_RM';
const QUERY_CONTEXT = '0/P';
const AUTH_TYPE = 'BASIC';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DAILY_SYNC_CRON = '0 0 4 * * *';
const DAILY_SYNC_TIME_ZONE = 'America/Sao_Paulo';
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type SourceRow = Record<string, unknown>;

type NormalizedRow = {
  companyCode: string;
  employeeNumber: string;
  employeeKey: string;
  competence: Date;
  period: number;
  displayName: string;
  jobName: string | null;
  departmentName: string | null;
  employmentStatus: string | null;
  admissionDate: Date | null;
  dismissalDate: Date | null;
  fixedAllocationValue: Prisma.Decimal | null;
  totalGeneralLine: Prisma.Decimal | null;
};

function canonicalHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function chunks<T>(values: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function text(row: SourceRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function decimal(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

function sourceDate(value: unknown, field: string) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0];
  if (iso) return parseDate(iso, field);
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (brazilian) return parseDate(`${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`, field);
  throw new BadRequestException(`${field} invalida no retorno da TOTVS`);
}

@Injectable()
export class TotvsEmployeeIntegrationService {
  private readonly logger = new Logger(TotvsEmployeeIntegrationService.name);
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private refreshPromise: Promise<unknown> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private config() {
    const baseUrl = String(process.env.TOTVS_RM_BASE_URL || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
      throw new ServiceUnavailableException('Integracao TOTVS IND.BI.0025 ainda nao provisionada');
    }
    const [company, system] = QUERY_CONTEXT.split('/');
    const timeoutMs = Math.max(1_000, Number(process.env.TOTVS_RM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
    const maxBytes = Math.max(1_024, Number(process.env.TOTVS_RM_MAX_RESPONSE_BYTES || DEFAULT_MAX_BYTES));
    const headers: Record<string, string> = { Accept: 'application/json' };
    const username = process.env.TOTVS_RM_USERNAME;
    const password = process.env.TOTVS_RM_PASSWORD;
    if (!username || !password) throw new ServiceUnavailableException('Credencial TOTVS BASIC incompleta');
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const url = `${baseUrl}/api/framework/v1/consultaSQLServer/RealizaConsulta/${encodeURIComponent(QUERY_CODE)}/${encodeURIComponent(company)}/${encodeURIComponent(system)}/`;
    return { url, context: QUERY_CONTEXT, authType: AUTH_TYPE, headers, timeoutMs, maxBytes };
  }

  async status() {
    const lastRun = await this.prisma.totvsEmployeeSyncRun.findFirst({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId, unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId },
      orderBy: { startedAt: 'desc' },
    });
    let provisioned = false;
    const authType = AUTH_TYPE;
    const context = QUERY_CONTEXT;
    try {
      this.config();
      provisioned = true;
    } catch {
      // O status informa apenas existencia/escopo; nunca devolve segredos.
    }
    return {
      queryCode: QUERY_CODE,
      mode: 'READ_ONLY_DAILY_AND_ON_DEMAND',
      provisioned,
      authType,
      context,
      scheduled: true,
      schedule: DAILY_SYNC_CRON,
      timeZone: DAILY_SYNC_TIME_ZONE,
      formulaEnabled: true,
      costRule: 'TOTAL_GERAL_LINHA_PERIODOS_20_30_40_SEM_PFRATEIOFIXO',
      lastRun,
    };
  }

  private normalizeRow(row: SourceRow): NormalizedRow {
    const companyCode = text(row, 'CODCOLIGADA');
    const sourceEmployeeKey = text(row, 'FK_FUNCIONARIO');
    const employeeNumber = text(row, 'CHAPA') || (
      companyCode && sourceEmployeeKey?.startsWith(`${companyCode}-`)
        ? sourceEmployeeKey.slice(companyCode.length + 1)
        : null
    );
    const displayName = text(row, 'NOME', 'NOMEFUNCIONARIO', 'FUNCIONARIO');
    const competenceValue = row.DT_MES;
    const periodValue = Number(text(row, 'NROPERIODO'));
    if (!companyCode || !employeeNumber || !displayName || !competenceValue) {
      throw new BadRequestException('Retorno IND.BI.0025 sem CODCOLIGADA, CHAPA, NOME ou DT_MES');
    }
    if (![20, 30, 40].includes(periodValue)) {
      throw new BadRequestException('Retorno IND.BI.0025 com NROPERIODO fora de 20/30/40');
    }
    const employeeKey = sourceEmployeeKey || `${companyCode}-${employeeNumber}`;
    if (employeeKey !== `${companyCode}-${employeeNumber}`) {
      throw new BadRequestException('FK_FUNCIONARIO nao corresponde a CODCOLIGADA + CHAPA');
    }
    const competenceRaw = sourceDate(competenceValue, 'DT_MES')!;
    const competence = new Date(Date.UTC(competenceRaw.getUTCFullYear(), competenceRaw.getUTCMonth(), 1));
    return {
      companyCode,
      employeeNumber,
      employeeKey,
      competence,
      period: periodValue,
      displayName,
      jobName: text(row, 'NOMEFUNCAO', 'FUNCAO', 'FUNÇÃO', 'DESCRICAOFUNCAO'),
      departmentName: text(row, 'NOMESECAO', 'SECAO', 'SEÇÃO', 'DEPARTAMENTO'),
      employmentStatus: text(row, 'SITUACAO', 'STATUSFUNCIONARIO', 'CODSITUACAO'),
      admissionDate: sourceDate(row.DATAADMISSAO ?? row.DTADMISSAO ?? row['DATA DE ADMISSÃO'], 'DATAADMISSAO'),
      dismissalDate: sourceDate(row.DATADEMISSAO ?? row.DTDEMISSAO, 'DATADEMISSAO'),
      fixedAllocationValue: decimal(row['PFRATEIOFIXO.VALOR'] ?? row.VALORRATEIOFIXO ?? row.VALOR_RATEIO_FIXO),
      totalGeneralLine: decimal(row['TOTAL GERAL LINHA'] ?? row.TOTALGERALLINHA ?? row.TOTAL_GERAL_LINHA),
    };
  }

  private async requestRows() {
    if (Date.now() < this.circuitOpenUntil) {
      throw new ServiceUnavailableException('Circuit breaker TOTVS temporariamente aberto');
    }
    const config = this.config();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(config.url, {
          method: 'GET',
          headers: config.headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          if (TRANSIENT_STATUSES.has(response.status) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new BadGatewayException(`TOTVS respondeu HTTP ${response.status}`);
        }
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > config.maxBytes) throw new BadGatewayException('Resposta TOTVS excedeu o limite permitido');
        const body = await response.text();
        const bytes = Buffer.byteLength(body);
        if (bytes > config.maxBytes) throw new BadGatewayException('Resposta TOTVS excedeu o limite permitido');
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new BadGatewayException('Resposta TOTVS nao e JSON valido');
        }
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as any)?.value)
            ? (parsed as any).value
            : Array.isArray((parsed as any)?.items)
              ? (parsed as any).items
              : null;
        if (!rows) throw new BadGatewayException('Resposta TOTVS nao contem lista JSON');
        this.consecutiveFailures = 0;
        return { rows: rows as SourceRow[], bytes, context: config.context };
      } catch (error) {
        lastError = error;
        if (attempt < 2 && (error as any)?.name === 'AbortError') continue;
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) this.circuitOpenUntil = Date.now() + 60_000;
    if ((lastError as any)?.name === 'AbortError') throw new ServiceUnavailableException('Timeout ao consultar a TOTVS');
    throw lastError;
  }

  async refresh(actorId?: string) {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshPromise = this.executeRefresh(actorId).finally(() => {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  @Cron(DAILY_SYNC_CRON, {
    name: 'totvs-ind-bi-0025-daily',
    timeZone: DAILY_SYNC_TIME_ZONE,
    waitForCompletion: true,
  })
  async runScheduledRefresh() {
    try {
      await this.refresh();
      this.logger.log('Sincronizacao diaria TOTVS IND.BI.0025 concluida');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida';
      this.logger.error(`Sincronizacao diaria TOTVS IND.BI.0025 falhou: ${message}`);
    }
  }

  private async executeRefresh(actorId?: string) {
    const fetched = await this.requestRows();
    const run = await this.prisma.totvsEmployeeSyncRun.create({
      data: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        queryCode: QUERY_CODE,
        contextCode: fetched.context,
        status: 'RUNNING',
        requestedById: actorId || null,
        receivedRows: fetched.rows.length,
        responseBytes: fetched.bytes,
      },
    });
    try {
      const normalized: NormalizedRow[] = [];
      let rejectedRows = 0;
      for (const row of fetched.rows) {
        try {
          normalized.push(this.normalizeRow(row));
        } catch {
          rejectedRows += 1;
        }
      }
      if (!normalized.length) throw new BadGatewayException('Nenhuma linha valida retornada pela IND.BI.0025');
      const groups = new Map<string, NormalizedRow[]>();
      for (const item of normalized) {
        const key = `${item.employeeKey}|${dateKey(item.competence)}|${item.period}`;
        groups.set(key, [...(groups.get(key) || []), item]);
      }
      const [currentEmployees, currentAggregates] = await Promise.all([
        this.prisma.totvsEmployeeSnapshot.findMany({
          where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId, unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, isCurrent: true },
        }),
        this.prisma.totvsEmployeeCostAggregate.findMany({
          where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId, unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, isCurrent: true },
        }),
      ]);
      const currentEmployeeByKey = new Map(currentEmployees.map((item) => [`${item.employeeKey}|${dateKey(item.competence)}|${item.period}`, item]));
      const currentAggregateByKey = new Map(currentAggregates.map((item) => [`${item.employeeKey}|${dateKey(item.competence)}|${item.period}`, item]));
      const employeeDeactivateIds: string[] = [];
      const aggregateDeactivateIds: string[] = [];
      const employeeCreates: any[] = [];
      const aggregateCreates: any[] = [];
      let employeeVersions = 0;
      let aggregateVersions = 0;

      for (const [key, rows] of groups) {
        const first = rows[0];
        const employeeData = {
          displayName: first.displayName,
          jobName: first.jobName,
          departmentName: first.departmentName,
          employmentStatus: first.employmentStatus,
          admissionDate: first.admissionDate ? dateKey(first.admissionDate) : null,
          dismissalDate: first.dismissalDate ? dateKey(first.dismissalDate) : null,
        };
        const employeeHash = canonicalHash(employeeData);
        const currentEmployee = currentEmployeeByKey.get(key);
        if (!currentEmployee || currentEmployee.contentHash !== employeeHash) {
          if (currentEmployee) employeeDeactivateIds.push(currentEmployee.id);
          employeeCreates.push({
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            companyCode: first.companyCode,
            employeeNumber: first.employeeNumber,
            employeeKey: first.employeeKey,
            competence: first.competence,
            period: first.period,
            version: (currentEmployee?.version || 0) + 1,
            displayName: first.displayName,
            jobName: first.jobName,
            departmentName: first.departmentName,
            employmentStatus: first.employmentStatus,
            admissionDate: first.admissionDate,
            dismissalDate: first.dismissalDate,
            contentHash: employeeHash,
            syncRunId: run.id,
          });
          employeeVersions += 1;
        }

        const allocationValues = rows.map((row) => row.fixedAllocationValue).filter((value): value is Prisma.Decimal => value !== null);
        const totalValues = rows.map((row) => row.totalGeneralLine).filter((value): value is Prisma.Decimal => value !== null);
        const fixedAllocationValue = allocationValues.length ? allocationValues.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)) : null;
        const totalGeneralLine = totalValues.length ? totalValues.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)) : null;
        const aggregateData = {
          sourceRows: rows.length,
          allocationRows: allocationValues.length,
          fixedAllocationValue: fixedAllocationValue?.toFixed(6) || null,
          totalGeneralLine: totalGeneralLine?.toFixed(6) || null,
          allocationClosed: false,
          officialCostEligible: false,
          pendingReason: 'PFRATEIOFIXO_CARDINALIDADE_NAO_RECONCILIADA',
        };
        const aggregateHash = canonicalHash(aggregateData);
        const currentAggregate = currentAggregateByKey.get(key);
        if (!currentAggregate || currentAggregate.contentHash !== aggregateHash) {
          if (currentAggregate) aggregateDeactivateIds.push(currentAggregate.id);
          aggregateCreates.push({
            companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
            unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
            companyCode: first.companyCode,
            employeeNumber: first.employeeNumber,
            employeeKey: first.employeeKey,
            competence: first.competence,
            period: first.period,
            version: (currentAggregate?.version || 0) + 1,
            sourceRows: aggregateData.sourceRows,
            allocationRows: aggregateData.allocationRows,
            fixedAllocationValue,
            totalGeneralLine,
            allocationClosed: false,
            officialCostEligible: false,
            pendingReason: aggregateData.pendingReason,
            contentHash: aggregateHash,
            syncRunId: run.id,
          });
          aggregateVersions += 1;
        }
      }

      await this.prisma.$transaction(async (tx) => {
        for (const ids of chunks(employeeDeactivateIds)) {
          await tx.totvsEmployeeSnapshot.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false } });
        }
        for (const data of chunks(employeeCreates)) {
          await tx.totvsEmployeeSnapshot.createMany({ data });
        }
        for (const ids of chunks(aggregateDeactivateIds)) {
          await tx.totvsEmployeeCostAggregate.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false } });
        }
        for (const data of chunks(aggregateCreates)) {
          await tx.totvsEmployeeCostAggregate.createMany({ data });
        }
      }, { maxWait: 10_000, timeout: 120_000 });
      return await this.prisma.totvsEmployeeSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          acceptedRows: normalized.length,
          rejectedRows,
          employeeCount: new Set(normalized.map((item) => item.employeeKey)).size,
          aggregateCount: groups.size,
          replayed: employeeVersions === 0 && aggregateVersions === 0,
        },
      });
    } catch (error) {
      await this.prisma.totvsEmployeeSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCode: (error as any)?.name || 'SYNC_ERROR',
          errorDetail: String((error as any)?.message || 'Falha na sincronizacao').slice(0, 500),
        },
      });
      throw error;
    }
  }

  async listOperators(competenceInput?: string, searchInput?: string) {
    const competence = parseDate(String(competenceInput || ''), 'competence');
    const search = String(searchInput || '').trim();
    const rows = await this.prisma.totvsEmployeeSnapshot.findMany({
      where: {
        companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
        competence,
        isCurrent: true,
        active: true,
        ...(search
          ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { employeeNumber: { contains: search, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ displayName: 'asc' }, { employeeNumber: 'asc' }, { period: 'asc' }],
      take: 100,
    });
    const unique = new Map<string, any>();
    for (const row of rows) {
      if (!unique.has(row.employeeKey)) {
        unique.set(row.employeeKey, {
          employeeKey: row.employeeKey,
          employeeNumber: row.employeeNumber,
          displayName: row.displayName,
          jobName: row.jobName,
          departmentName: row.departmentName,
          employmentStatus: row.employmentStatus,
          admissionDate: row.admissionDate ? dateKey(row.admissionDate) : null,
          dismissalDate: row.dismissalDate ? dateKey(row.dismissalDate) : null,
          source: SOURCE,
          queryCode: QUERY_CODE,
        });
      }
    }
    return { competence: dateKey(competence), operators: [...unique.values()] };
  }

  async createAssignment(fleetAssignmentId: string, body: any, actorId: string) {
    const fleet = await this.prisma.usinaAsphaltTeamFleetAssignment.findFirst({
      where: { id: fleetAssignmentId, deletedAt: null },
    });
    if (!fleet) throw new NotFoundException('Vinculo mensal de frota nao encontrado');
    const validFrom = parseDate(body?.validFrom, 'validFrom');
    const validTo = parseDate(body?.validTo, 'validTo');
    if (validTo < validFrom || validFrom < fleet.validFrom || validTo > fleet.validTo) {
      throw new BadRequestException('Vigencia do operador deve estar dentro da vigencia da frota');
    }
    const employeeKey = String(body?.employeeKey || '').trim();
    const employee = await this.prisma.totvsEmployeeSnapshot.findFirst({
      where: { companyId: fleet.companyId, unitId: fleet.unitId, employeeKey, competence: fleet.competence, isCurrent: true, active: true },
      orderBy: { period: 'asc' },
    });
    if (!employee) throw new BadRequestException('Operador nao consta no snapshot TOTVS da competencia');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.usinaAsphaltFleetOperatorAssignment.create({
          data: {
            fleetAssignmentId: fleet.id,
            companyId: fleet.companyId,
            unitId: fleet.unitId,
            employeeKey,
            employeeDisplayName: employee.displayName,
            validFrom,
            validTo,
            observation: String(body?.observation || '').trim() || null,
            createdById: actorId,
          },
        });
        await tx.usinaAsphaltTeamAudit.create({
          data: { teamId: fleet.teamId, entityType: 'FLEET_OPERATOR_ASSIGNMENT', entityId: created.id, action: 'CREATE', actorId, after: created as any },
        });
        return { ...created, validFrom: dateKey(created.validFrom), validTo: dateKey(created.validTo) };
      });
    } catch (error: any) {
      if (error?.code === 'P2004' || String(error?.message || '').includes('no_fleet_overlap')) {
        throw new BadRequestException('Este colaborador ja esta vinculado a esta frota no periodo informado');
      }
      throw error;
    }
  }

  async replaceAssignments(
    fleetAssignmentId: string,
    body: any,
    actorId: string,
  ) {
    const requested = body?.assignments;
    if (!Array.isArray(requested)) {
      throw new BadRequestException('Lista de mao de obra invalida');
    }
    if (requested.length > 50) {
      throw new BadRequestException('Limite de 50 pessoas por frota excedido');
    }
    const fleet = await this.prisma.usinaAsphaltTeamFleetAssignment.findFirst({
      where: { id: fleetAssignmentId, deletedAt: null },
    });
    if (!fleet) {
      throw new NotFoundException('Vinculo mensal de frota nao encontrado');
    }

    const assignments = requested.map((item: any) => {
      const employeeKey = String(item?.employeeKey || '').trim();
      if (!employeeKey) {
        throw new BadRequestException('Pessoa da mao de obra e obrigatoria');
      }
      const validFrom = parseDate(item?.validFrom, 'validFrom');
      const validTo = parseDate(item?.validTo, 'validTo');
      if (
        validTo < validFrom ||
        validFrom < fleet.validFrom ||
        validTo > fleet.validTo
      ) {
        throw new BadRequestException(
          'Vigencia da mao de obra deve estar dentro da vigencia da frota',
        );
      }
      return {
        id: String(item?.id || '').trim() || null,
        employeeKey,
        validFrom,
        validTo,
        observation: String(item?.observation || '').trim() || null,
      };
    });

    for (let left = 0; left < assignments.length; left += 1) {
      for (let right = left + 1; right < assignments.length; right += 1) {
        const a = assignments[left];
        const b = assignments[right];
        if (
          a.employeeKey === b.employeeKey &&
          a.validFrom <= b.validTo &&
          b.validFrom <= a.validTo
        ) {
          throw new BadRequestException(
            'A mesma pessoa nao pode ter periodos sobrepostos na frota',
          );
        }
      }
    }

    const snapshots = assignments.length
      ? await this.prisma.totvsEmployeeSnapshot.findMany({
          where: {
            companyId: fleet.companyId,
            unitId: fleet.unitId,
            competence: fleet.competence,
            employeeKey: {
              in: [...new Set(assignments.map((item) => item.employeeKey))],
            },
            isCurrent: true,
            active: true,
          },
          orderBy: { period: 'asc' },
        })
      : [];
    const employeeByKey = new Map<string, any>();
    for (const snapshot of snapshots) {
      if (!employeeByKey.has(snapshot.employeeKey)) {
        employeeByKey.set(snapshot.employeeKey, snapshot);
      }
    }
    const missing = assignments.find(
      (item) => !employeeByKey.has(item.employeeKey),
    );
    if (missing) {
      throw new BadRequestException(
        'Pessoa nao consta no snapshot TOTVS da competencia',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const current =
          await tx.usinaAsphaltFleetOperatorAssignment.findMany({
            where: { fleetAssignmentId: fleet.id, deletedAt: null },
          });
        const currentById = new Map(
          current.map((item) => [item.id, item]),
        );
        const requestedIds = new Set(
          assignments.flatMap((item) => (item.id ? [item.id] : [])),
        );
        for (const id of requestedIds) {
          if (!currentById.has(id)) {
            throw new BadRequestException(
              'Vinculo de mao de obra nao pertence a esta frota',
            );
          }
        }

        for (const previous of current.filter(
          (item) => !requestedIds.has(item.id),
        )) {
          const deleted =
            await tx.usinaAsphaltFleetOperatorAssignment.update({
              where: { id: previous.id },
              data: {
                deletedAt: new Date(),
                deletedById: actorId,
                updatedById: actorId,
              },
            });
          await tx.usinaAsphaltTeamAudit.create({
            data: {
              teamId: fleet.teamId,
              entityType: 'FLEET_OPERATOR_ASSIGNMENT',
              entityId: previous.id,
              action: 'DELETE',
              note: 'Mao de obra removida no cadastro mensal de frotas',
              actorId,
              before: previous as any,
              after: deleted as any,
            },
          });
        }

        for (const item of assignments) {
          const employee = employeeByKey.get(item.employeeKey)!;
          const data = {
            employeeKey: item.employeeKey,
            employeeDisplayName: employee.displayName,
            validFrom: item.validFrom,
            validTo: item.validTo,
            observation: item.observation,
            updatedById: actorId,
          };
          if (item.id) {
            const previous = currentById.get(item.id)!;
            const updated =
              await tx.usinaAsphaltFleetOperatorAssignment.update({
                where: { id: item.id },
                data,
              });
            await tx.usinaAsphaltTeamAudit.create({
              data: {
                teamId: fleet.teamId,
                entityType: 'FLEET_OPERATOR_ASSIGNMENT',
                entityId: item.id,
                action: 'UPDATE',
                actorId,
                before: previous as any,
                after: updated as any,
              },
            });
          } else {
            const created =
              await tx.usinaAsphaltFleetOperatorAssignment.create({
                data: {
                  fleetAssignmentId: fleet.id,
                  companyId: fleet.companyId,
                  unitId: fleet.unitId,
                  ...data,
                  createdById: actorId,
                },
              });
            await tx.usinaAsphaltTeamAudit.create({
              data: {
                teamId: fleet.teamId,
                entityType: 'FLEET_OPERATOR_ASSIGNMENT',
                entityId: created.id,
                action: 'CREATE',
                actorId,
                after: created as any,
              },
            });
          }
        }
      });
    } catch (error: any) {
      if (
        error?.code === 'P2004' ||
        String(error?.message || '').includes('no_fleet_overlap')
      ) {
        throw new BadRequestException(
          'A mesma pessoa nao pode ter periodos sobrepostos na frota',
        );
      }
      throw error;
    }

    const saved =
      await this.prisma.usinaAsphaltFleetOperatorAssignment.findMany({
        where: { fleetAssignmentId: fleet.id, deletedAt: null },
        orderBy: [
          { employeeDisplayName: 'asc' },
          { validFrom: 'asc' },
        ],
      });
    return {
      fleetAssignmentId: fleet.id,
      assignments: saved.map((item) => ({
        ...item,
        validFrom: dateKey(item.validFrom),
        validTo: dateKey(item.validTo),
      })),
    };
  }

  async updateAssignment(id: string, body: any, actorId: string) {
    const current = await this.prisma.usinaAsphaltFleetOperatorAssignment.findFirst({
      where: { id, deletedAt: null },
      include: { fleetAssignment: true },
    });
    if (!current) throw new NotFoundException('Vinculo de operador nao encontrado');
    const validFrom = parseDate(body?.validFrom, 'validFrom');
    const validTo = parseDate(body?.validTo, 'validTo');
    if (validTo < validFrom || validFrom < current.fleetAssignment.validFrom || validTo > current.fleetAssignment.validTo) {
      throw new BadRequestException('Vigencia do operador deve estar dentro da vigencia da frota');
    }
    const employeeKey = String(body?.employeeKey || '').trim();
    const employee = await this.prisma.totvsEmployeeSnapshot.findFirst({
      where: { companyId: current.companyId, unitId: current.unitId, employeeKey, competence: current.fleetAssignment.competence, isCurrent: true, active: true },
      orderBy: { period: 'asc' },
    });
    if (!employee) throw new BadRequestException('Operador nao consta no snapshot TOTVS da competencia');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.usinaAsphaltFleetOperatorAssignment.update({
        where: { id },
        data: { employeeKey, employeeDisplayName: employee.displayName, validFrom, validTo, observation: String(body?.observation || '').trim() || null, updatedById: actorId },
      });
      await tx.usinaAsphaltTeamAudit.create({
        data: { teamId: current.fleetAssignment.teamId, entityType: 'FLEET_OPERATOR_ASSIGNMENT', entityId: id, action: 'UPDATE', actorId, before: current as any, after: updated as any },
      });
      return { ...updated, validFrom: dateKey(updated.validFrom), validTo: dateKey(updated.validTo) };
    });
  }

  async deleteAssignment(id: string, reason: string, actorId: string) {
    if (!String(reason || '').trim()) throw new BadRequestException('Motivo da exclusao obrigatorio');
    const current = await this.prisma.usinaAsphaltFleetOperatorAssignment.findFirst({
      where: { id, deletedAt: null },
      include: { fleetAssignment: true },
    });
    if (!current) throw new NotFoundException('Vinculo de operador nao encontrado');
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.usinaAsphaltFleetOperatorAssignment.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actorId, updatedById: actorId },
      });
      await tx.usinaAsphaltTeamAudit.create({
        data: { teamId: current.fleetAssignment.teamId, entityType: 'FLEET_OPERATOR_ASSIGNMENT', entityId: id, action: 'DELETE', note: reason.trim(), actorId, before: current as any, after: deleted as any },
      });
      return { ok: true, id };
    });
  }
}
