import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ObservationKind = 'RECEIPT_DELAY';
type ObservationStatus = 'OPEN' | 'RESOLVED';

interface ObservationInput {
  kind?: unknown;
  referenceMonth?: unknown;
  targetMonth?: unknown;
  note?: unknown;
  status?: unknown;
  expectedVersion?: unknown;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateInput(input: ObservationInput, updating: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Observação inválida');
  }
  const kind = input.kind;
  const referenceMonth = input.referenceMonth;
  const targetMonth =
    input.targetMonth === '' ? null : (input.targetMonth ?? null);
  const note = typeof input.note === 'string' ? input.note.trim() : null;
  const status = updating ? input.status : 'OPEN';
  if (kind !== 'RECEIPT_DELAY') {
    throw new BadRequestException(
      'Observações registram apenas recebimentos atrasados',
    );
  }
  if (typeof referenceMonth !== 'string' || !MONTH.test(referenceMonth)) {
    throw new BadRequestException('Mês de referência inválido');
  }
  if (
    targetMonth !== null &&
    (typeof targetMonth !== 'string' || !MONTH.test(targetMonth))
  ) {
    throw new BadRequestException('Novo mês previsto inválido');
  }
  if (targetMonth !== null && targetMonth <= referenceMonth) {
    throw new BadRequestException(
      'O novo mês deve ser posterior ao mês previsto originalmente',
    );
  }
  if (!note || note.length < 5 || note.length > 2000) {
    throw new BadRequestException('Descreva o motivo em 5 a 2.000 caracteres');
  }
  if (status !== 'OPEN' && status !== 'RESOLVED') {
    throw new BadRequestException('Situação inválida');
  }
  if (
    updating &&
    (!Number.isSafeInteger(input.expectedVersion) ||
      (input.expectedVersion as number) < 1)
  ) {
    throw new BadRequestException('Versão de edição inválida');
  }
  return {
    kind: kind as ObservationKind,
    referenceMonth,
    targetMonth,
    note,
    status: status as ObservationStatus,
  };
}

function cellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  if (typeof cell !== 'object' || Array.isArray(cell)) return '';
  const value = cell as { formula?: unknown; raw?: unknown; cached?: unknown };
  const effective = value.formula ? value.cached : value.raw;
  if (
    typeof effective === 'string' ||
    typeof effective === 'number' ||
    typeof effective === 'boolean'
  )
    return String(effective);
  if (effective instanceof Date) return effective.toISOString();
  return '';
}

function snapshot(cells: Record<string, unknown>, excelRow: number | null) {
  return {
    excelRow,
    item: cellValue(cells.A),
    serviceMonth: cellValue(cells.B),
    contract: cellValue(cells.D),
    client: cellValue(cells.E),
    work: cellValue(cells.G),
    originalBillingPlan: cellValue(cells.J),
    plannedBilling: cellValue(cells.K),
    plannedBillingDate: cellValue(cells.P),
    billingMonth: cellValue(cells.M),
    amountBilled: cellValue(cells.N),
    expectedReceiptMonth: cellValue(cells.T),
    originalExpectedReceiptAmount: cellValue(cells.U),
    expectedReceiptAmount: cellValue(cells.V),
    receivedMonth: cellValue(cells.W),
    receivedAmount: cellValue(cells.Y),
  };
}

function state(row: {
  kind: string;
  referenceMonth: string;
  targetMonth: string | null;
  note: string;
  status: string;
}) {
  return {
    kind: row.kind,
    referenceMonth: row.referenceMonth,
    targetMonth: row.targetMonth,
    note: row.note,
    status: row.status,
  };
}

@Injectable()
export class DudaObservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    importId: string,
    options: { page?: string; status?: string; kind?: string; month?: string },
  ) {
    const batch = await this.prisma.dudaBdGeralImport.findUnique({
      where: { id: importId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('Importação não encontrada');
    const page = options.page === undefined ? 1 : Number(options.page);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      (options.page !== undefined && !/^\d+$/.test(options.page))
    ) {
      throw new BadRequestException('Página inválida');
    }
    if (options.status && !['OPEN', 'RESOLVED'].includes(options.status))
      throw new BadRequestException('Situação inválida');
    if (options.kind && options.kind !== 'RECEIPT_DELAY')
      throw new BadRequestException('Tipo inválido');
    if (options.month && !MONTH.test(options.month))
      throw new BadRequestException('Mês inválido');
    const where = {
      importId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.month
        ? {
            OR: [
              { targetMonth: options.month },
              { targetMonth: null, referenceMonth: options.month },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.dudaObservation.count({ where }),
      this.prisma.dudaObservation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        skip: (page - 1) * 50,
      }),
    ]);
    return { page, pageSize: 50, total, rows };
  }

  async listForRow(importId: string, rowId: string) {
    const [source, manual] = await Promise.all([
      this.prisma.dudaBdGeralRow.findFirst({
        where: { importId, id: rowId },
        select: { id: true },
      }),
      this.prisma.dudaBdGeralManualEntry.findFirst({
        where: { importId, id: rowId, sourceRowId: null },
        select: { id: true },
      }),
    ]);
    if (!source && !manual) throw new NotFoundException('Linha não encontrada');
    return this.prisma.dudaObservation.findMany({
      where: {
        importId,
        ...(source
          ? { sourceRowId: source.id }
          : { manualEntryId: manual!.id }),
      },
      orderBy: [{ referenceMonth: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(
    importId: string,
    rowId: string,
    userId: string | undefined,
    input: ObservationInput,
  ) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const values = validateInput(input, false);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.dudaBdGeralRow.findFirst({
          where: { importId, id: rowId },
          include: { manualEntry: { select: { cells: true } } },
        });
        let sourceRowId: string | null = null;
        let manualEntryId: string | null = null;
        let cells: Record<string, unknown>;
        let excelRow: number | null = null;
        if (source) {
          if (source.classification !== 'detail_candidate')
            throw new BadRequestException(
              'Selecione um lançamento identificado',
            );
          sourceRowId = source.id;
          excelRow = source.excelRow;
          cells = {
            ...(source.cells as Record<string, unknown>),
            ...(source.manualEntry?.cells as
              | Record<string, unknown>
              | undefined),
          };
        } else {
          const manual = await tx.dudaBdGeralManualEntry.findFirst({
            where: { importId, id: rowId, sourceRowId: null },
          });
          if (!manual) throw new NotFoundException('Linha não encontrada');
          manualEntryId = manual.id;
          cells = manual.cells as Record<string, unknown>;
        }
        const saved = await tx.dudaObservation.create({
          data: {
            importId,
            sourceRowId,
            manualEntryId,
            ...values,
            rowSnapshot: snapshot(cells, excelRow),
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        });
        await tx.dudaObservationRevision.create({
          data: {
            observationId: saved.id,
            version: 1,
            action: 'CREATE',
            after: state(saved),
            changedByUserId: userId,
          },
        });
        return saved;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esta linha já tem uma observação desse tipo no mês escolhido. Edite a existente.',
        );
      }
      throw error;
    }
  }

  async update(
    importId: string,
    observationId: string,
    userId: string | undefined,
    input: ObservationInput,
  ) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const values = validateInput(input, true);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.dudaObservation.findFirst({
          where: { id: observationId, importId },
        });
        if (!current) throw new NotFoundException('Observação não encontrada');
        if (current.version !== input.expectedVersion)
          throw new ConflictException(
            'A observação mudou. Reabra para conferir.',
          );
        if (
          Object.entries(values).every(
            ([key, value]) =>
              (current as Record<string, unknown>)[key] === value,
          )
        )
          return current;
        const changed = await tx.dudaObservation.updateMany({
          where: { id: current.id, version: current.version },
          data: {
            ...values,
            resolvedAt:
              values.status === 'RESOLVED'
                ? (current.resolvedAt ?? new Date())
                : null,
            updatedByUserId: userId,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('Edição concorrente detectada');
        const updated = await tx.dudaObservation.findUniqueOrThrow({
          where: { id: current.id },
        });
        await tx.dudaObservationRevision.create({
          data: {
            observationId: current.id,
            version: updated.version,
            action:
              current.status !== updated.status
                ? updated.status === 'RESOLVED'
                  ? 'RESOLVE'
                  : 'REOPEN'
                : 'UPDATE',
            before: state(current),
            after: state(updated),
            changedByUserId: userId,
          },
        });
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe outra observação desse tipo para a linha e mês escolhidos.',
        );
      }
      throw error;
    }
  }

  async revisions(importId: string, observationId: string) {
    const observation = await this.prisma.dudaObservation.findFirst({
      where: { importId, id: observationId },
      select: { id: true },
    });
    if (!observation) throw new NotFoundException('Observação não encontrada');
    const revisions = await this.prisma.dudaObservationRevision.findMany({
      where: { observationId },
      orderBy: { version: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(revisions.map((revision) => revision.changedByUserId)),
          ],
        },
      },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name]));
    return revisions.map((revision) => ({
      ...revision,
      changedByName:
        names.get(revision.changedByUserId) ?? 'Usuário não encontrado',
    }));
  }
}
