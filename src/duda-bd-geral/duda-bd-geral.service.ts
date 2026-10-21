import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DUDA_BD_GERAL_COLUMN_SET } from './duda-bd-geral.columns';

interface RowFilters {
  page?: string;
  pageSize?: string;
  classification?: string;
  serviceMonth?: string;
  q?: string;
  columnFilters?: string;
}

function parseColumnFilters(value?: string): Record<string, string> {
  if (!value) return {};
  if (value.length > 4096)
    throw new BadRequestException('Filtros muito longos');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BadRequestException('Filtros de coluna inválidos');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('Filtros de coluna inválidos');
  }
  const entries = Object.entries(parsed);
  if (entries.length > DUDA_BD_GERAL_COLUMN_SET.size) {
    throw new BadRequestException('Filtros de coluna inválidos');
  }
  const filters: Record<string, string> = {};
  for (const [column, raw] of entries) {
    if (
      !DUDA_BD_GERAL_COLUMN_SET.has(column) ||
      typeof raw !== 'string' ||
      raw.length > 120
    ) {
      throw new BadRequestException('Filtro de coluna inválido');
    }
    const term = raw.trim();
    if (term) filters[column] = term;
  }
  return filters;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new BadRequestException('Paginação inválida');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException('Paginação inválida');
  }
  return parsed;
}

@Injectable()
export class DudaBdGeralService {
  constructor(private readonly prisma: PrismaService) {}

  async getViewPreferences(userId?: string) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const stored = await this.prisma.dudaBdGeralViewPreference.findUnique({
      where: { userId },
      select: { hiddenColumns: true },
    });
    return { hiddenColumns: stored?.hiddenColumns ?? [] };
  }

  async putViewPreferences(userId: string | undefined, hiddenColumns: unknown) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    if (
      !Array.isArray(hiddenColumns) ||
      hiddenColumns.length >= DUDA_BD_GERAL_COLUMN_SET.size ||
      hiddenColumns.some(
        (column) =>
          typeof column !== 'string' || !DUDA_BD_GERAL_COLUMN_SET.has(column),
      ) ||
      new Set(hiddenColumns).size !== hiddenColumns.length
    ) {
      throw new BadRequestException('Colunas ocultas inválidas');
    }
    const row = await this.prisma.dudaBdGeralViewPreference.upsert({
      where: { userId },
      create: { userId, hiddenColumns },
      update: { hiddenColumns },
      select: { hiddenColumns: true },
    });
    return { hiddenColumns: row.hiddenColumns };
  }

  async listImports() {
    return this.prisma.dudaBdGeralImport.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceWorkbookSha256: true,
        sourceLabel: true,
        capturedAt: true,
        physicalRowCount: true,
        detailCandidateCount: true,
        status: true,
        createdAt: true,
        // No source workstation path or raw company data in the list.
      },
    });
  }

  async listRows(importId: string, filters: RowFilters) {
    const batch = await this.prisma.dudaBdGeralImport.findUnique({
      where: { id: importId },
      select: {
        id: true,
        status: true,
        sourceLabel: true,
        physicalRowCount: true,
      },
    });
    if (!batch) throw new NotFoundException('Importação não encontrada');

    const page = positiveInteger(filters.page, 1, 100000);
    const pageSize = positiveInteger(filters.pageSize, 50, 100);
    const classification = filters.classification?.trim();
    const serviceMonth = filters.serviceMonth?.trim();
    const q = filters.q?.trim();
    const columnFilters = parseColumnFilters(filters.columnFilters);
    if (classification && !/^[a-z_]{1,50}$/.test(classification)) {
      throw new BadRequestException('Classificação inválida');
    }
    if (serviceMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(serviceMonth)) {
      throw new BadRequestException('Mês inválido');
    }
    if (q && q.length > 120) throw new BadRequestException('Busca muito longa');

    const where: Prisma.DudaBdGeralRowWhereInput = {
      importId,
      ...(classification ? { classification } : {}),
      ...(serviceMonth ? { serviceMonth } : {}),
      ...(q
        ? {
            OR: [
              { legacyItem: { contains: q, mode: 'insensitive' } },
              { engineer: { contains: q, mode: 'insensitive' } },
              { contractNumber: { contains: q, mode: 'insensitive' } },
              { clientName: { contains: q, mode: 'insensitive' } },
              { municipality: { contains: q, mode: 'insensitive' } },
              { workName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    if (Object.keys(columnFilters).length > 0) {
      return this.listRowsWithColumnFilters(
        batch,
        page,
        pageSize,
        classification,
        serviceMonth,
        q,
        columnFilters,
      );
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dudaBdGeralRow.count({ where }),
      this.prisma.dudaBdGeralRow.findMany({
        where,
        orderBy: { excelRow: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          excelRow: true,
          classification: true,
          hiddenByFilter: true,
          legacyItem: true,
          serviceMonth: true,
          engineer: true,
          contractNumber: true,
          clientName: true,
          municipality: true,
          workName: true,
          billingMonth: true,
          expectedReceiptMonth: true,
          receivedMonthText: true,
          cells: true,
          issues: true,
        },
      }),
    ]);
    return { batch, page, pageSize, total, rows };
  }

  private async listRowsWithColumnFilters(
    batch: {
      id: string;
      status: string;
      sourceLabel: string;
      physicalRowCount: number;
    },
    page: number,
    pageSize: number,
    classification: string | undefined,
    serviceMonth: string | undefined,
    q: string | undefined,
    columnFilters: Record<string, string>,
  ) {
    // A bounded source snapshot is filtered in SQL before pagination. Column
    // identifiers are allow-listed; values remain bound query parameters.
    const clauses: Prisma.Sql[] = [Prisma.sql`r."importId" = ${batch.id}`];
    if (classification) {
      clauses.push(Prisma.sql`r."classification" = ${classification}`);
    }
    if (serviceMonth) {
      clauses.push(Prisma.sql`r."serviceMonth" = ${serviceMonth}`);
    }
    for (const [column, term] of Object.entries(columnFilters)) {
      clauses.push(
        Prisma.sql`STRPOS(LOWER(COALESCE(r."cells" -> ${column} ->> 'cached', r."cells" -> ${column} ->> 'raw', '')), LOWER(${term})) > 0`,
      );
    }
    if (q) {
      clauses.push(Prisma.sql`(
        STRPOS(LOWER(r."legacyItem"), LOWER(${q})) > 0 OR STRPOS(LOWER(r."engineer"), LOWER(${q})) > 0 OR
        STRPOS(LOWER(r."contractNumber"), LOWER(${q})) > 0 OR STRPOS(LOWER(r."clientName"), LOWER(${q})) > 0 OR
        STRPOS(LOWER(r."municipality"), LOWER(${q})) > 0 OR STRPOS(LOWER(r."workName"), LOWER(${q})) > 0
      )`);
    }
    const condition = Prisma.join(clauses, ' AND ');
    const [counts, ids] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`SELECT COUNT(*)::integer AS total FROM "DudaBdGeralRow" r WHERE ${condition}`,
      ),
      this.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT r.id FROM "DudaBdGeralRow" r WHERE ${condition} ORDER BY r."excelRow" ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ),
    ]);
    const order = ids.map((item) => item.id);
    const rows = order.length
      ? await this.prisma.dudaBdGeralRow.findMany({
          where: { id: { in: order } },
          select: {
            id: true,
            excelRow: true,
            classification: true,
            hiddenByFilter: true,
            legacyItem: true,
            serviceMonth: true,
            engineer: true,
            contractNumber: true,
            clientName: true,
            municipality: true,
            workName: true,
            billingMonth: true,
            expectedReceiptMonth: true,
            receivedMonthText: true,
            cells: true,
            issues: true,
          },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      batch,
      page,
      pageSize,
      total: counts[0]?.total ?? 0,
      rows: order.map((id) => byId.get(id)).filter((row) => row !== undefined),
    };
  }

  async getRow(importId: string, rowId: string) {
    const row = await this.prisma.dudaBdGeralRow.findFirst({
      where: { id: rowId, importId },
    });
    if (!row) throw new NotFoundException('Linha não encontrada');
    return row;
  }
}
