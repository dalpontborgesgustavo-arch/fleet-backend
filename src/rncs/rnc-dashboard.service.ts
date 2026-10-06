import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, RncStatus, RncType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DASHBOARD_ROLES = new Set(['admin', 'administrador', 'gestor', 'ceo']);
const TERMINAL_STATUSES = new Set<RncStatus>([
  RncStatus.COMPLETED,
  RncStatus.CANCELLED,
  RncStatus.REJECTED,
]);

const DAY_MS = 86_400_000;

export interface RncDashboardQuery {
  from?: string;
  to?: string;
  status?: string;
  type?: string;
  engineerId?: string;
  obra?: string;
}

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00-03:00`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Data inicial invalida. Use AAAA-MM-DD.');
  }
  return date;
}

function endOfDay(value: string) {
  const date = new Date(`${value}T23:59:59.999-03:00`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Data final invalida. Use AAAA-MM-DD.');
  }
  return date;
}

function parseCsv<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  field: string,
): T[] {
  if (!value) return [];
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as T[];
  const invalid = values.find((item) => !allowed.includes(item));
  if (invalid) {
    throw new BadRequestException(`${field} invalido: ${invalid}`);
  }
  return [...new Set(values)];
}

function money(value: Prisma.Decimal | null | undefined) {
  return value ? Number(value) : 0;
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

@Injectable()
export class RncDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: RncDashboardQuery, role?: string) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (!DASHBOARD_ROLES.has(normalizedRole)) {
      throw new ForbiddenException(
        'O dashboard de RNC esta disponivel somente para Gestor, CEO e Administrador.',
      );
    }

    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-01-01`;
    const defaultTo = now.toISOString().slice(0, 10);
    const from = startOfDay(query.from || defaultFrom);
    const to = endOfDay(query.to || defaultTo);
    if (from > to) {
      throw new BadRequestException(
        'A data inicial nao pode ser posterior a data final.',
      );
    }

    const statuses = parseCsv(
      query.status,
      Object.values(RncStatus),
      'Status',
    );
    const types = parseCsv(
      query.type || RncType.WORK,
      Object.values(RncType),
      'Tipo',
    );
    if (types.length !== 1) {
      throw new BadRequestException(
        'Selecione exatamente um tipo de RNC para o dashboard.',
      );
    }
    const selectedType = types[0];
    const engineerIds = (query.engineerId || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const works = (query.obra || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const where: Prisma.RncWhereInput = {
      dataEntrada: { gte: from, lte: to },
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(types.length ? { type: { in: types } } : {}),
      ...(engineerIds.length
        ? selectedType === RncType.WORK
          ? { responsavel: { in: engineerIds } }
          : { engineerId: { in: engineerIds } }
        : {}),
      ...(works.length ? { obra: { in: works } } : {}),
    };

    const [records, optionRecords] = await Promise.all([
      this.prisma.rnc.findMany({
        where,
        orderBy: [{ dataEntrada: 'desc' }, { number: 'desc' }],
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          cliente: true,
          obra: true,
          obraDescricao: true,
          dataEntrada: true,
          dataLimiteRetorno: true,
          etapaObra: true,
          enquadramentoMotivo: true,
          valorNc: true,
          valorRetidoInicial: true,
          valorRetido: true,
          actionsEffective: true,
          effectivenessReviewedAt: true,
          cancelledAt: true,
          updatedAt: true,
          responsavel: true,
          engineerId: true,
          engineer: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.rnc.findMany({
        where: { type: { in: types } },
        select: {
          obra: true,
          obraDescricao: true,
          responsavel: true,
          engineerId: true,
          engineer: { select: { id: true, name: true, email: true } },
          status: true,
          type: true,
        },
      }),
    ]);

    const details = records.map((record) => {
      const value = money(record.valorNc ?? record.valorRetidoInicial);
      const retainedValue = money(record.valorRetido);
      const isOpen = !TERMINAL_STATUSES.has(record.status);
      const isOverdue = isOpen && record.dataLimiteRetorno.getTime() < now.getTime();
      const resolutionDate =
        record.status === RncStatus.COMPLETED
          ? record.effectivenessReviewedAt ?? record.updatedAt
          : null;
      const resolutionDays = resolutionDate
        ? Math.max(
            0,
            Math.ceil(
              (resolutionDate.getTime() - record.dataEntrada.getTime()) / DAY_MS,
            ),
          )
        : null;

      const technicalEngineerName =
        record.type === RncType.WORK
          ? record.responsavel?.trim() || 'Sem engenheiro'
          : record.engineer?.name || 'Sem engenheiro';
      const technicalEngineerId =
        record.type === RncType.WORK
          ? record.responsavel?.trim() || 'SEM_ENGENHEIRO'
          : record.engineerId;

      return {
        id: record.id,
        number: record.number,
        type: record.type,
        status: record.status,
        client: record.cliente,
        dateEntry: record.dataEntrada.toISOString(),
        dueDate: record.dataLimiteRetorno.toISOString(),
        workCode: record.obra || 'SEM_OBRA',
        workName: record.obraDescricao || record.obra || 'Sem obra informada',
        engineerId: technicalEngineerId,
        engineerName: technicalEngineerName,
        engineerEmail:
          record.type === RncType.WORK ? null : record.engineer?.email || null,
        reason: record.enquadramentoMotivo || 'Nao informado',
        stage: record.etapaObra || 'Nao informada',
        value,
        retainedValue,
        isOpen,
        isOverdue,
        resolutionDays,
        actionsEffective: record.actionsEffective,
      };
    });

    const totalValue = details.reduce((sum, item) => sum + item.value, 0);
    const open = details.filter((item) => item.isOpen);
    const completed = details.filter(
      (item) => item.status === RncStatus.COMPLETED,
    );
    const cancelled = details.filter(
      (item) => item.status === RncStatus.CANCELLED,
    );
    const overdue = details.filter((item) => item.isOverdue);
    const resolutionValues = completed
      .map((item) => item.resolutionDays)
      .filter((value): value is number => value !== null);

    const byStatus = this.aggregate(details, (item) => item.status).map(
      (item) => ({
        status: item.key,
        count: item.count,
        value: round(item.value),
        percent: details.length ? round((item.count / details.length) * 100, 1) : 0,
      }),
    );

    const byWork = this.aggregate(details, (item) => item.workCode)
      .map((item) => {
        const rows = details.filter((row) => row.workCode === item.key);
        const completedRows = rows.filter(
          (row) => row.status === RncStatus.COMPLETED,
        );
        const resolution = completedRows
          .map((row) => row.resolutionDays)
          .filter((value): value is number => value !== null);
        return {
          code: item.key,
          name: rows[0]?.workName || item.key,
          count: item.count,
          value: round(item.value),
          openCount: rows.filter((row) => row.isOpen).length,
          completedCount: completedRows.length,
          overdueCount: rows.filter((row) => row.isOverdue).length,
          averageResolutionDays: resolution.length
            ? round(resolution.reduce((sum, value) => sum + value, 0) / resolution.length, 1)
            : null,
        };
      })
      .sort((a, b) => b.value - a.value || b.count - a.count);

    const byEngineer = this.aggregate(details, (item) => item.engineerId)
      .map((item) => {
        const rows = details.filter((row) => row.engineerId === item.key);
        const completedCount = rows.filter(
          (row) => row.status === RncStatus.COMPLETED,
        ).length;
        return {
          id: item.key,
          name: rows[0]?.engineerName || 'Sem engenheiro',
          email: rows[0]?.engineerEmail || null,
          count: item.count,
          value: round(item.value),
          openCount: rows.filter((row) => row.isOpen).length,
          completedCount,
          overdueCount: rows.filter((row) => row.isOverdue).length,
          completionRate: rows.length
            ? round((completedCount / rows.length) * 100, 1)
            : 0,
        };
      })
      .sort((a, b) => b.value - a.value || b.count - a.count);

    const byReason = this.aggregate(details, (item) => item.reason)
      .map((item) => ({
        reason: item.key,
        count: item.count,
        value: round(item.value),
      }))
      .sort((a, b) => b.value - a.value || b.count - a.count)
      .slice(0, 10);

    const monthlyMap = new Map<
      string,
      { key: string; label: string; count: number; value: number; completed: number; open: number }
    >();
    for (const item of details) {
      const date = new Date(item.dateEntry);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const month = monthlyMap.get(key) || {
        key,
        label: new Intl.DateTimeFormat('pt-BR', {
          month: 'short',
          year: '2-digit',
          timeZone: 'America/Sao_Paulo',
        }).format(date),
        count: 0,
        value: 0,
        completed: 0,
        open: 0,
      };
      month.count += 1;
      month.value += item.value;
      month.completed += item.status === RncStatus.COMPLETED ? 1 : 0;
      month.open += item.isOpen ? 1 : 0;
      monthlyMap.set(key, month);
    }

    const evaluated = details.filter(
      (item) => item.actionsEffective !== null,
    );
    const effective = evaluated.filter((item) => item.actionsEffective).length;

    return {
      filters: {
        from: (query.from || defaultFrom),
        to: (query.to || defaultTo),
        statuses,
        types,
        engineerIds,
        works,
      },
      options: this.buildOptions(optionRecords),
      summary: {
        totalRncs: details.length,
        totalValue: round(totalValue),
        averageValue: details.length ? round(totalValue / details.length) : 0,
        openCount: open.length,
        openValue: round(open.reduce((sum, item) => sum + item.value, 0)),
        completedCount: completed.length,
        cancelledCount: cancelled.length,
        overdueCount: overdue.length,
        completionRate: details.length
          ? round((completed.length / details.length) * 100, 1)
          : 0,
        averageResolutionDays: resolutionValues.length
          ? round(
              resolutionValues.reduce((sum, value) => sum + value, 0) /
                resolutionValues.length,
              1,
            )
          : null,
      },
      effectiveness: {
        evaluated: evaluated.length,
        effective,
        ineffective: evaluated.length - effective,
        rate: evaluated.length ? round((effective / evaluated.length) * 100, 1) : 0,
      },
      monthly: [...monthlyMap.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((item) => ({ ...item, value: round(item.value) })),
      byStatus,
      byWork,
      byEngineer,
      byReason,
      details,
    };
  }

  private aggregate<T>(rows: T[], keyOf: (row: T) => string) {
    const map = new Map<string, { key: string; count: number; value: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const current = map.get(key) || { key, count: 0, value: 0 };
      current.count += 1;
      current.value += Number((row as { value?: number }).value || 0);
      map.set(key, current);
    }
    return [...map.values()];
  }

  private buildOptions(
    rows: Array<{
      obra: string;
      obraDescricao: string | null;
      responsavel: string | null;
      engineerId: string;
      engineer: { id: string; name: string; email: string };
      status: RncStatus;
      type: RncType;
    }>,
  ) {
    const works = new Map<string, { code: string; name: string; count: number }>();
    const engineers = new Map<
      string,
      { id: string; name: string; email: string; count: number }
    >();
    for (const row of rows) {
      const workCode = row.obra || 'SEM_OBRA';
      const work = works.get(workCode) || {
        code: workCode,
        name: row.obraDescricao || row.obra || 'Sem obra informada',
        count: 0,
      };
      work.count += 1;
      works.set(workCode, work);

      const engineerId =
        row.type === RncType.WORK
          ? row.responsavel?.trim() || 'SEM_ENGENHEIRO'
          : row.engineerId;
      const engineerName =
        row.type === RncType.WORK
          ? row.responsavel?.trim() || 'Sem engenheiro'
          : row.engineer.name;
      const engineer = engineers.get(engineerId) || {
        id: engineerId,
        name: engineerName,
        email: row.type === RncType.WORK ? '' : row.engineer.email,
        count: 0,
      };
      engineer.count += 1;
      engineers.set(engineerId, engineer);
    }
    return {
      works: [...works.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      engineers: [...engineers.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      statuses: Object.values(RncStatus),
      types: Object.values(RncType),
    };
  }
}
