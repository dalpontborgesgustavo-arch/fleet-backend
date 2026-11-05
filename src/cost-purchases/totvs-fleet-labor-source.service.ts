import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_ASPHALT_TEAM_CONTEXT } from '../usina-asphalt-teams/usina-asphalt-teams.rules';

export const FLEET_LABOR_FORMULA_ID = 'IND.BI.0025_INTEGRAL_V1';
export const FLEET_LABOR_QUERY_CODE = 'IND.BI.0039';
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50_000;
const TIMEOUT_MS = 20_000;
const QUERY_CONTEXT = '0/P';
const DAILY_STAGE_CRON = '0 30 4 * * *';
const DAILY_STAGE_TIME_ZONE = 'America/Sao_Paulo';
type SourceRow = Record<string, unknown>;

type NormalizedRow = {
  companyCode: string;
  employeeNumber: string;
  employeeKey: string;
  competence: Date;
  period: number;
  totalGeneralIntegral: Prisma.Decimal;
  cardinalityOk: true;
  contentHash: string;
};

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function field(row: SourceRow, key: string) {
  const value = row[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function competenceDate(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const year = Number(iso?.[1] || br?.[3]);
  const month = Number(iso?.[2] || br?.[2]);
  const day = Number(iso?.[3] || br?.[1]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || day !== 1 || parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new BadRequestException('DT_MES deve ser o primeiro dia de uma competencia valida');
  }
  return parsed;
}

function currentMonthInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return new Date(Date.UTC(year, month - 1, 1));
}

function decimal(value: string) {
  const numeric = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(numeric)) {
    throw new BadRequestException('TOTAL_GERAL_INTEGRAL invalido');
  }
  const parsed = new Prisma.Decimal(numeric);
  if (!parsed.isFinite()) throw new BadRequestException('TOTAL_GERAL_INTEGRAL invalido');
  return parsed;
}

export function normalizeFleetLaborRows(rows: unknown): {
  rows: NormalizedRow[];
  sourceHash: string;
  competences: { competence: string; rowCount: number; totalCost: string }[];
} {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new BadRequestException('A consulta de custos deve retornar entre 1 e 50000 linhas');
  }
  const seen = new Set<string>();
  const months = new Set<string>();
  const currentMonth = currentMonthInSaoPaulo();
  const normalized = rows.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`Linha ${index + 1} da consulta nao e um objeto`);
    }
    const row = value as SourceRow;
    const companyCode = field(row, 'CODCOLIGADA');
    const employeeNumber = field(row, 'CHAPA');
    const employeeKey = field(row, 'FK_FUNCIONARIO');
    const period = Number(field(row, 'NROPERIODO'));
    const formulaId = field(row, 'FORMULA_ID');
    const cardinality = field(row, 'CARDINALIDADE_OK').toLowerCase();
    if (!companyCode || !employeeNumber ||
        employeeKey !== `${companyCode}-${employeeNumber}`) {
      throw new BadRequestException(`Identidade de funcionario invalida na linha ${index + 1}`);
    }
    if (![20, 30, 40].includes(period)) {
      throw new BadRequestException(`Periodo invalido na linha ${index + 1}`);
    }
    if (formulaId !== FLEET_LABOR_FORMULA_ID ||
        !['1', 'true'].includes(cardinality)) {
      throw new BadRequestException(`Formula ou cardinalidade nao reconciliada na linha ${index + 1}`);
    }
    const rowCompetence = competenceDate(field(row, 'DT_MES'));
    if (rowCompetence >= currentMonth) {
      throw new BadRequestException('A competencia precisa estar encerrada no calendario');
    }
    months.add(rowCompetence.toISOString().slice(0, 7));
    if (months.size > 2) {
      throw new BadRequestException('A consulta excedeu a janela de duas competencias');
    }
    const key = `${companyCode}|${employeeKey}|${rowCompetence.toISOString()}|${period}`;
    if (seen.has(key)) {
      throw new BadRequestException(`Funcionario e periodo duplicados na linha ${index + 1}`);
    }
    seen.add(key);
    const totalGeneralIntegral = decimal(field(row, 'TOTAL_GERAL_INTEGRAL'));
    const canonical = { companyCode, employeeNumber, employeeKey,
      competence: rowCompetence.toISOString().slice(0, 10), period,
      totalGeneralIntegral: totalGeneralIntegral.toFixed(6),
      formulaId, cardinalityOk: true };
    return { companyCode, employeeNumber, employeeKey,
      competence: rowCompetence, period, totalGeneralIntegral,
      cardinalityOk: true as const, contentHash: hash(canonical) };
  });
  normalized.sort((a, b) => a.competence.getTime() - b.competence.getTime() ||
    a.employeeKey.localeCompare(b.employeeKey) || a.period - b.period);
  const sourceHash = hash(normalized.map((row) => row.contentHash));
  const competences = [...months].sort().map((competence) => {
    const selected = normalized.filter((row) => row.competence.toISOString().startsWith(competence));
    return { competence, rowCount: selected.length,
      totalCost: selected.reduce((sum, row) => sum.plus(row.totalGeneralIntegral),
        new Prisma.Decimal(0)).toFixed(6) };
  });
  return { rows: normalized, sourceHash, competences };
}

@Injectable()
export class TotvsFleetLaborSourceService {
  private readonly logger = new Logger(TotvsFleetLaborSourceService.name);
  constructor(private readonly prisma: PrismaService) {}

  @Cron(DAILY_STAGE_CRON, { timeZone: DAILY_STAGE_TIME_ZONE })
  async stageDailyWhenEnabled() {
    if (process.env.TOTVS_RM_FLEET_LABOR_AUTO_STAGE !== 'true') return;
    try {
      await this.stage();
    } catch (error) {
      // Never log source rows, response payloads, or credentials.
      this.logger.error(`Isolated fleet labor staging failed: ${(error as any)?.name || 'Error'}`);
    }
  }

  private config() {
    const code = String(process.env.TOTVS_RM_FLEET_LABOR_QUERY_CODE || '').trim().toUpperCase();
    if (code !== FLEET_LABOR_QUERY_CODE) {
      throw new ServiceUnavailableException('Consulta dedicada de custos de frota nao configurada');
    }
    const baseUrl = String(process.env.TOTVS_RM_BASE_URL || '').trim().replace(/\/$/, '');
    const username = process.env.TOTVS_RM_USERNAME;
    const password = process.env.TOTVS_RM_PASSWORD;
    if (!baseUrl || !username || !password) {
      throw new ServiceUnavailableException('Conexao TOTVS RM nao configurada');
    }
    const [company, system] = QUERY_CONTEXT.split('/');
    return {
      code,
      url: `${baseUrl}/api/framework/v1/consultaSQLServer/RealizaConsulta/${encodeURIComponent(code)}/${company}/${system}/`,
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    };
  }

  async status() {
    const lastRun = await this.prisma.totvsFleetLaborSyncRun.findFirst({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, queryCode: true, status: true, startedAt: true, finishedAt: true,
        receivedRows: true, acceptedRows: true, rejectedRows: true, sourceHash: true, errorCode: true },
    });
    let configured = false;
    try { this.config(); configured = true; } catch { /* Never return credentials. */ }
    return { configured,
      scheduled: process.env.TOTVS_RM_FLEET_LABOR_AUTO_STAGE === 'true',
      activationEnabled: process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED === 'true',
      schedule: DAILY_STAGE_CRON, timeZone: DAILY_STAGE_TIME_ZONE,
      source: 'DEDICATED_TOTVS_QUERY', lastRun };
  }

  private async requestRows(config: ReturnType<TotvsFleetLaborSourceService['config']>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(config.url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: config.authorization },
        signal: controller.signal,
      });
      if (!response.ok) throw new BadGatewayException(`TOTVS respondeu HTTP ${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) {
        throw new BadGatewayException('Resposta TOTVS excedeu o limite');
      }
      if (!response.body) throw new BadGatewayException('Resposta TOTVS sem corpo');
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new BadGatewayException('Resposta TOTVS excedeu o limite');
        }
        chunks.push(Buffer.from(part.value));
      }
      const body = Buffer.concat(chunks, bytes).toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch {
        throw new BadGatewayException('Resposta TOTVS nao e JSON valido');
      }
      const rows = Array.isArray(parsed) ? parsed
        : Array.isArray((parsed as any)?.value) ? (parsed as any).value
          : Array.isArray((parsed as any)?.items) ? (parsed as any).items : null;
      if (!rows) throw new BadGatewayException('Resposta TOTVS nao contem lista JSON');
      return { rows, bytes };
    } catch (error) {
      if ((error as any)?.name === 'AbortError') {
        throw new BadGatewayException('Consulta TOTVS excedeu o tempo limite');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Manual staging only: no scheduler, no change to the live reader.
  async stage(requestedById?: string) {
    const config = this.config();
    await this.prisma.totvsFleetLaborSyncRun.updateMany({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, queryCode: config.code,
        status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'ABANDONED_RUN' },
    });
    let run: Awaited<ReturnType<typeof this.prisma.totvsFleetLaborSyncRun.create>>;
    try {
      run = await this.prisma.totvsFleetLaborSyncRun.create({
        data: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
          unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, queryCode: config.code,
          ruleVersion: FLEET_LABOR_FORMULA_ID, status: 'RUNNING', requestedById },
      });
    } catch (error) {
      if ((error as any)?.code === 'P2002') {
        throw new ConflictException('Ja existe uma consulta de custos de frota em andamento');
      }
      throw error;
    }
    try {
      const { rows: sourceRows, bytes } = await this.requestRows(config);
      const prepared = normalizeFleetLaborRows(sourceRows);
      const previous = await this.prisma.totvsFleetLaborSyncRun.findFirst({
        where: { companyId: run.companyId, unitId: run.unitId, queryCode: config.code,
          ruleVersion: FLEET_LABOR_FORMULA_ID, sourceHash: prepared.sourceHash,
          acceptedRows: prepared.rows.length, status: 'STAGED' },
        orderBy: { startedAt: 'desc' }, select: { id: true },
      });
      if (previous) {
        const previousRows = await this.prisma.totvsFleetLaborCost.count({
          where: { syncRunId: previous.id },
        });
        if (previousRows === prepared.rows.length) {
          await this.prisma.totvsFleetLaborSyncRun.update({ where: { id: run.id },
            data: { status: 'UNCHANGED', finishedAt: new Date(),
              receivedRows: sourceRows.length, acceptedRows: prepared.rows.length,
              responseBytes: bytes, sourceHash: prepared.sourceHash } });
          return { runId: previous.id, checkRunId: run.id,
            competences: prepared.competences, queryCode: config.code,
            formulaId: FLEET_LABOR_FORMULA_ID, rowCount: prepared.rows.length,
            sourceHash: prepared.sourceHash, status: 'UNCHANGED' };
        }
      }
      await this.prisma.$transaction(async (tx) => {
        for (let offset = 0; offset < prepared.rows.length; offset += 500) {
          await tx.totvsFleetLaborCost.createMany({
            data: prepared.rows.slice(offset, offset + 500).map((row) => ({
              companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
              unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId,
              queryCode: config.code,
              ruleVersion: FLEET_LABOR_FORMULA_ID,
              companyCode: row.companyCode,
              employeeNumber: row.employeeNumber,
              employeeKey: row.employeeKey,
              competence: row.competence,
              period: row.period,
              totalGeneralIntegral: row.totalGeneralIntegral,
              cardinalityOk: row.cardinalityOk,
              contentHash: row.contentHash,
              syncRunId: run.id,
            })),
          });
        }
        await tx.totvsFleetLaborSyncRun.update({ where: { id: run.id },
          data: { status: 'STAGED', finishedAt: new Date(),
            receivedRows: sourceRows.length, acceptedRows: prepared.rows.length,
            responseBytes: bytes, sourceHash: prepared.sourceHash } });
      }, { timeout: 60_000 });
      return { runId: run.id, competences: prepared.competences,
        queryCode: config.code, formulaId: FLEET_LABOR_FORMULA_ID,
        rowCount: prepared.rows.length,
        sourceHash: prepared.sourceHash, status: 'STAGED' };
    } catch (error) {
      await this.prisma.totvsFleetLaborSyncRun.update({ where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(),
          errorCode: error instanceof BadRequestException ? 'SOURCE_VALIDATION' : 'SOURCE_FETCH',
          errorDetail: error instanceof BadRequestException ? error.message : null } });
      throw error;
    }
  }

  async preview(runId: string) {
    const run = await this.prisma.totvsFleetLaborSyncRun.findUnique({
      where: { id: runId }, select: { id: true, queryCode: true, ruleVersion: true,
        status: true, acceptedRows: true, sourceHash: true, approvals: {
          select: { competence: true, approvedAt: true, evidenceRef: true } } },
    });
    if (!run) throw new NotFoundException('Lote de custos nao encontrado');
    const rows = await this.prisma.totvsFleetLaborCost.findMany({
      where: { syncRunId: runId },
      select: { competence: true, employeeKey: true, period: true,
        totalGeneralIntegral: true, cardinalityOk: true },
    });
    const months = [...new Set(rows.map((row) => row.competence.toISOString().slice(0, 7)))];
    const competences = months.map((competence) => {
      const monthRows = rows.filter((row) => row.competence.toISOString().startsWith(competence));
      return { competence, rowCount: monthRows.length,
        distinctEmployees: new Set(monthRows.map((row) => row.employeeKey)).size,
        totalCost: monthRows.reduce((sum, row) => sum.plus(row.totalGeneralIntegral),
          new Prisma.Decimal(0)).toFixed(6),
        periods: [...new Set(monthRows.map((row) => row.period))].sort() };
    });
    return { ...run, competences,
      rowCount: rows.length,
      cardinalityOk: rows.every((row) => row.cardinalityOk) };
  }

  async readback(competence: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence || '')) {
      throw new BadRequestException('Competencia invalida');
    }
    const month = new Date(`${competence}-01T00:00:00.000Z`);
    const approval = await this.prisma.totvsFleetLaborApproval.findFirst({
      where: { companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
        unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, competence: month },
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, sourceHash: true, rowCount: true, totalCost: true,
        evidenceRef: true, approvedAt: true,
        syncRun: { select: { queryCode: true, status: true, sourceHash: true,
          ruleVersion: true } } },
    });
    if (!approval) return { competence, officialReady: false, reason: 'NO_APPROVAL' };
    const where = { approvalId: approval.id, competence: month,
      companyId: USINA_ASPHALT_TEAM_CONTEXT.companyId,
      unitId: USINA_ASPHALT_TEAM_CONTEXT.unitId, isCurrent: true, active: true,
      queryCode: FLEET_LABOR_QUERY_CODE,
      cardinalityOk: true, ruleVersion: FLEET_LABOR_FORMULA_ID };
    const [totalRows, currentRows, sum] = await Promise.all([
      this.prisma.totvsFleetLaborCost.count({ where: { approvalId: approval.id } }),
      this.prisma.totvsFleetLaborCost.count({ where }),
      this.prisma.totvsFleetLaborCost.aggregate({ where,
        _sum: { totalGeneralIntegral: true } }),
    ]);
    const currentTotal = sum._sum.totalGeneralIntegral || new Prisma.Decimal(0);
    const officialReady = approval.syncRun.status === 'STAGED' &&
      approval.syncRun.queryCode === FLEET_LABOR_QUERY_CODE &&
      approval.syncRun.ruleVersion === FLEET_LABOR_FORMULA_ID &&
      approval.syncRun.sourceHash === approval.sourceHash &&
      totalRows === currentRows && currentRows === approval.rowCount &&
      currentTotal.equals(approval.totalCost);
    return { competence, officialReady, queryCode: approval.syncRun.queryCode,
      sourceHash: approval.sourceHash, rowCount: approval.rowCount, currentRows,
      expectedTotal: approval.totalCost.toFixed(6), currentTotal: currentTotal.toFixed(6),
      approvedAt: approval.approvedAt, evidenceRef: approval.evidenceRef };
  }

  // The operator must supply independently checked totals and an evidence reference.
  async activate(runId: string, expected: {
    competence: string; sourceHash: string; rowCount: number;
    totalCost: string; evidenceRef: string;
  }, approvedById?: string) {
    if (process.env.TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Ativacao da fonte dedicada ainda nao liberada');
    }
    if (!/^[a-f0-9]{64}$/.test(expected.sourceHash || '') ||
        !Number.isSafeInteger(expected.rowCount) || expected.rowCount < 1 ||
        !/^\S[\s\S]{7,499}$/.test(expected.evidenceRef || '')) {
      throw new BadRequestException('Hash, cardinalidade e referencia da conciliacao sao obrigatorios');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expected.competence || '')) {
      throw new BadRequestException('Competencia de ativacao invalida');
    }
    const competence = new Date(`${expected.competence}-01T00:00:00.000Z`);
    const total = decimal(String(expected.totalCost || ''));
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.totvsFleetLaborSyncRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== 'STAGED' ||
          run.queryCode !== FLEET_LABOR_QUERY_CODE ||
          run.ruleVersion !== FLEET_LABOR_FORMULA_ID ||
          run.companyId !== USINA_ASPHALT_TEAM_CONTEXT.companyId ||
          run.unitId !== USINA_ASPHALT_TEAM_CONTEXT.unitId) {
        throw new ConflictException('Lote inexistente ou nao preparado');
      }
      const rows = await tx.totvsFleetLaborCost.findMany({ where: { syncRunId: runId, competence },
        select: { id: true, competence: true, employeeKey: true, period: true,
          totalGeneralIntegral: true, cardinalityOk: true, ruleVersion: true } });
      if (!rows.length || rows.some((row) => row.competence.getTime() !== competence.getTime() ||
          !row.cardinalityOk || row.ruleVersion !== FLEET_LABOR_FORMULA_ID)) {
        throw new ConflictException('Competencia ausente ou sem formula/cardinalidade reconciliada');
      }
      const actualTotal = rows.reduce((sum, row) => sum.plus(row.totalGeneralIntegral),
        new Prisma.Decimal(0));
      if (run.sourceHash !== expected.sourceHash || rows.length !== expected.rowCount ||
          !actualTotal.equals(total)) {
        throw new ConflictException('Lote diverge da evidencia independente');
      }
      const existing = await tx.totvsFleetLaborApproval.findUnique({ where: {
        companyId_unitId_competence_syncRunId: {
          companyId: run.companyId, unitId: run.unitId, competence, syncRunId: run.id,
        },
      } });
      if (existing) {
        const currentCount = await tx.totvsFleetLaborCost.count({
          where: { approvalId: existing.id, isCurrent: true, active: true },
        });
        if (currentCount !== rows.length) {
          throw new ConflictException('Lote aprovado anteriormente, mas ja substituido');
        }
        return { approvalId: existing.id,
          competence: competence.toISOString().slice(0, 7), alreadyActive: true };
      }
      await tx.totvsFleetLaborCost.updateMany({
        where: { companyId: run.companyId, unitId: run.unitId, competence,
          isCurrent: true, active: true },
        data: { isCurrent: false },
      });
      const approval = await tx.totvsFleetLaborApproval.create({ data: {
        companyId: run.companyId, unitId: run.unitId, competence, syncRunId: run.id,
        sourceHash: run.sourceHash!, rowCount: rows.length, totalCost: actualTotal,
        evidenceRef: expected.evidenceRef, approvedById,
      } });
      await tx.totvsFleetLaborCost.updateMany({ where: { syncRunId: run.id, competence },
        data: { isCurrent: true, approvalId: approval.id } });
      return { approvalId: approval.id, competence: competence.toISOString().slice(0, 7),
        alreadyActive: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  }
}
