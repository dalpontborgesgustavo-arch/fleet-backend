import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SHA = /^[0-9a-f]{64}$/;
const MONEY = /^\d{1,14}(?:\.\d{1,2})?$/;
type Values = {
  trackingMonth: string;
  municipality: string;
  workName: string;
  amount: string;
  category: string;
  note: string;
  status: 'OPEN' | 'INVOICED';
  invoicedOn: Date | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Dados inválidos');
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  max: number,
  required = false,
): string {
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException(`${label} inválido`);
  const clean = value.trim();
  if (required && !clean)
    throw new BadRequestException(`Informe ${label.toLowerCase()}`);
  return clean;
}

function amount(value: unknown): string {
  const raw =
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (
    typeof raw !== 'string' ||
    !MONEY.test(raw) ||
    new Prisma.Decimal(raw).lte(0)
  ) {
    throw new BadRequestException('Valor inválido');
  }
  return new Prisma.Decimal(raw).toFixed(2);
}

function date(value: unknown): Date | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value))
    throw new BadRequestException('Data de faturamento inválida');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Data de faturamento inválida');
  }
  return parsed;
}

function validate(
  value: unknown,
  updating = false,
): Values & { expectedVersion?: number } {
  const input = object(value);
  const trackingMonth = text(
    input.trackingMonth,
    'Mês de acompanhamento',
    7,
    true,
  );
  if (!MONTH.test(trackingMonth))
    throw new BadRequestException('Mês de acompanhamento inválido');
  const status = input.status ?? 'OPEN';
  if (status !== 'OPEN' && status !== 'INVOICED')
    throw new BadRequestException('Situação inválida');
  const invoicedOn = date(input.invoicedOn ?? null);
  if ((status === 'INVOICED') !== (invoicedOn !== null)) {
    throw new BadRequestException('Informe a data ao marcar como faturado');
  }
  if (
    updating &&
    (!Number.isSafeInteger(input.expectedVersion) ||
      (input.expectedVersion as number) < 1)
  ) {
    throw new BadRequestException('Versão de edição inválida');
  }
  return {
    trackingMonth,
    municipality: text(input.municipality, 'Município', 200),
    workName: text(input.workName, 'Obra', 500),
    amount: amount(input.amount),
    category: text(input.category, 'Tipo', 150),
    note: text(input.note ?? '', 'Observação', 2000),
    status,
    invoicedOn,
    ...(updating ? { expectedVersion: input.expectedVersion as number } : {}),
  };
}

function state(entry: {
  trackingMonth: string;
  municipality: string;
  workName: string;
  amount: Prisma.Decimal | string;
  category: string;
  note: string;
  status: string;
  invoicedOn: Date | null;
}) {
  return {
    trackingMonth: entry.trackingMonth,
    municipality: entry.municipality,
    workName: entry.workName,
    amount: String(entry.amount),
    category: entry.category,
    note: entry.note,
    status: entry.status,
    invoicedOn: entry.invoicedOn?.toISOString().slice(0, 10) ?? null,
  };
}

function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return `${year + (number === 12 ? 1 : 0)}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
}

@Injectable()
export class DudaShelfService {
  constructor(private readonly prisma: PrismaService) {}

  async list(options: {
    month?: string;
    status?: string;
    q?: string;
    page?: string;
  }) {
    const latest = await this.prisma.dudaShelfEntry.findFirst({
      orderBy: { trackingMonth: 'desc' },
      select: { trackingMonth: true },
    });
    const month = options.month || latest?.trackingMonth || null;
    if (month && !MONTH.test(month))
      throw new BadRequestException('Mês inválido');
    if (
      options.status &&
      !['OPEN', 'HISTORICAL', 'INVOICED'].includes(options.status)
    )
      throw new BadRequestException('Situação inválida');
    const page = options.page ? Number(options.page) : 1;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      (options.page && !/^\d+$/.test(options.page))
    )
      throw new BadRequestException('Página inválida');
    const q = options.q?.trim() || '';
    if (q.length > 120) throw new BadRequestException('Busca muito longa');
    const where: Prisma.DudaShelfEntryWhereInput = {
      ...(month ? { trackingMonth: month } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(q
        ? {
            OR: [
              { workName: { contains: q, mode: 'insensitive' } },
              { municipality: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows, monthTotals] = await Promise.all([
      this.prisma.dudaShelfEntry.count({ where }),
      this.prisma.dudaShelfEntry.findMany({
        where,
        orderBy: [{ sourceExcelRow: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      month
        ? this.prisma.dudaShelfEntry.groupBy({
            by: ['status'],
            where: { trackingMonth: month },
            _count: { _all: true },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
    ]);
    return { month, page, pageSize: 50, total, rows, monthTotals };
  }

  async create(userId: string | undefined, input: unknown) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const values = validate(input);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.dudaShelfEntry.create({
        data: {
          ...values,
          amount: new Prisma.Decimal(values.amount),
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await tx.dudaShelfRevision.create({
        data: {
          entryId: row.id,
          version: 1,
          action: 'CREATE',
          after: state(row),
          changedByUserId: userId,
        },
      });
      return row;
    });
    return saved;
  }

  async update(entryId: string, userId: string | undefined, input: unknown) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const values = validate(input, true);
    const { expectedVersion, ...data } = values;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.dudaShelfEntry.findUnique({
        where: { id: entryId },
      });
      if (!current) throw new NotFoundException('Pendência não encontrada');
      if (current.status === 'HISTORICAL')
        throw new BadRequestException(
          'Registro histórico não pode ser editado',
        );
      if (current.version !== expectedVersion)
        throw new ConflictException('A pendência mudou. Reabra para conferir.');
      if (
        (current.previousEntryId || current.sourceSha256) &&
        current.trackingMonth !== values.trackingMonth
      )
        throw new BadRequestException(
          'Mês do registro de origem não pode ser alterado',
        );
      const before = state(current);
      const after = state({ ...values, amount: values.amount });
      if (JSON.stringify(before) === JSON.stringify(after)) return current;
      const changed = await tx.dudaShelfEntry.updateMany({
        where: { id: entryId, version: current.version },
        data: {
          ...data,
          amount: new Prisma.Decimal(values.amount),
          updatedByUserId: userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Edição concorrente detectada');
      const saved = await tx.dudaShelfEntry.findUniqueOrThrow({
        where: { id: entryId },
      });
      await tx.dudaShelfRevision.create({
        data: {
          entryId,
          version: saved.version,
          action:
            before.status !== after.status
              ? after.status === 'INVOICED'
                ? 'INVOICE'
                : 'REOPEN'
              : 'UPDATE',
          before,
          after,
          changedByUserId: userId,
        },
      });
      return saved;
    });
  }

  async revisions(entryId: string) {
    const entry = await this.prisma.dudaShelfEntry.findUnique({
      where: { id: entryId },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Pendência não encontrada');
    return this.prisma.dudaShelfRevision.findMany({
      where: { entryId },
      orderBy: { version: 'desc' },
    });
  }

  async carry(userId: string | undefined, input: unknown) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const body = object(input);
    const fromMonth = text(body.fromMonth, 'Mês de origem', 7, true);
    const toMonth = text(body.toMonth, 'Mês de destino', 7, true);
    if (!MONTH.test(fromMonth) || toMonth !== nextMonth(fromMonth))
      throw new BadRequestException(
        'Transporte permitido somente para o mês seguinte',
      );
    return this.prisma.$transaction(async (tx) => {
      const [source, existing] = await Promise.all([
        tx.dudaShelfEntry.findMany({
          where: { trackingMonth: fromMonth, status: 'OPEN', nextEntry: null },
        }),
        tx.dudaShelfEntry.count({ where: { trackingMonth: toMonth } }),
      ]);
      if (existing)
        throw new ConflictException(
          'O mês de destino já tem registros. Confira antes de transportar.',
        );
      if (!source.length)
        throw new BadRequestException('Não há pendências para transportar');
      for (const previous of source) {
        const row = await tx.dudaShelfEntry.create({
          data: {
            trackingMonth: toMonth,
            municipality: previous.municipality,
            workName: previous.workName,
            amount: previous.amount,
            category: previous.category,
            note: previous.note,
            previousEntryId: previous.id,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        });
        await tx.dudaShelfRevision.create({
          data: {
            entryId: row.id,
            version: 1,
            action: 'CARRY',
            after: state(row),
            changedByUserId: userId,
          },
        });
      }
      return { fromMonth, toMonth, carried: source.length };
    });
  }

  async importSnapshot(userId: string | undefined, input: unknown) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const body = object(input);
    const sourceSha256 = text(
      body.sourceSha256,
      'Identificador da planilha',
      64,
      true,
    );
    if (
      !SHA.test(sourceSha256) ||
      !Array.isArray(body.rows) ||
      body.rows.length < 1 ||
      body.rows.length > 2000
    )
      throw new BadRequestException('Extrato inválido');
    const parsed = body.rows.map((value) => {
      const row = object(value);
      if (
        !Number.isSafeInteger(row.excelRow) ||
        (row.excelRow as number) < 2 ||
        (row.excelRow as number) > 100000
      )
        throw new BadRequestException('Linha de origem inválida');
      const month = text(row.trackingMonth, 'Mês de acompanhamento', 7, true);
      if (!MONTH.test(month)) throw new BadRequestException('Mês inválido');
      return {
        excelRow: row.excelRow as number,
        trackingMonth: month,
        municipality: text(row.municipality ?? '', 'Município', 200),
        workName: text(row.workName ?? '', 'Obra', 500),
        amount: amount(row.amount),
        category: text(row.category ?? '', 'Tipo', 150),
      };
    });
    if (new Set(parsed.map((row) => row.excelRow)).size !== parsed.length)
      throw new BadRequestException('Linhas repetidas no extrato');
    const latest = parsed.reduce(
      (a, row) => (row.trackingMonth > a ? row.trackingMonth : a),
      parsed[0].trackingMonth,
    );
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.dudaShelfEntry.count({
        where: { sourceSha256 },
      });
      if (existing) {
        if (existing !== parsed.length)
          throw new ConflictException(
            'Carga parcial detectada; nenhuma linha foi alterada',
          );
        return {
          sourceSha256,
          imported: 0,
          alreadyPresent: existing,
          latestMonth: latest,
        };
      }
      const occupied = await tx.dudaShelfEntry.count({
        where: {
          trackingMonth: {
            in: [...new Set(parsed.map((row) => row.trackingMonth))],
          },
          OR: [{ sourceSha256: null }, { sourceSha256: { not: sourceSha256 } }],
        },
      });
      if (occupied)
        throw new ConflictException(
          'Esses meses já contêm registros. Confira antes de importar.',
        );
      for (const source of parsed) {
        const saved = await tx.dudaShelfEntry.create({
          data: {
            sourceSha256,
            sourceExcelRow: source.excelRow,
            trackingMonth: source.trackingMonth,
            municipality: source.municipality,
            workName: source.workName,
            amount: new Prisma.Decimal(source.amount),
            category: source.category,
            status: source.trackingMonth === latest ? 'OPEN' : 'HISTORICAL',
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        });
        await tx.dudaShelfRevision.create({
          data: {
            entryId: saved.id,
            version: 1,
            action: 'IMPORT',
            after: state(saved),
            changedByUserId: userId,
          },
        });
      }
      return {
        sourceSha256,
        imported: parsed.length,
        alreadyPresent: 0,
        latestMonth: latest,
      };
    });
  }
}
