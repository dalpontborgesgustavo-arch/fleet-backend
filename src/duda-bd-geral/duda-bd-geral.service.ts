import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DUDA_BD_GERAL_COLUMNS,
  DUDA_BD_GERAL_COLUMN_SET,
} from './duda-bd-geral.columns';

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

type CellMap = Record<string, unknown>;

function asCellMap(value: unknown): CellMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as CellMap)
    : {};
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  const cell = value as { formula?: unknown; cached?: unknown; raw?: unknown };
  const actual = cell.formula ? cell.cached : cell.raw;
  return typeof actual === 'string' ||
    typeof actual === 'number' ||
    typeof actual === 'boolean'
    ? String(actual)
    : '';
}

function validateManualCells(
  value: unknown,
  requireIdentity: boolean,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Campos do lançamento inválidos');
  }
  const provided = value as Record<string, unknown>;
  if (
    Object.keys(provided).length !== DUDA_BD_GERAL_COLUMNS.length ||
    Object.keys(provided).some((key) => !DUDA_BD_GERAL_COLUMN_SET.has(key))
  ) {
    throw new BadRequestException('Envie os 27 campos selecionados, sem H e I');
  }
  const cells: Record<string, string> = {};
  for (const key of DUDA_BD_GERAL_COLUMNS) {
    const raw = provided[key];
    if (
      typeof raw !== 'string' ||
      raw.length > (key === 'AC' || key === 'AA' ? 4000 : 500)
    ) {
      throw new BadRequestException(`Valor inválido na coluna ${key}`);
    }
    const text = raw.trim();
    if (text.startsWith('=')) {
      throw new BadRequestException(
        `Fórmulas não são aceitas na coluna ${key}; informe o valor manual`,
      );
    }
    cells[key] = text;
  }
  if (
    requireIdentity &&
    (!cells.A || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cells.B))
  ) {
    throw new BadRequestException(
      'Informe ITEM e mês de serviço no formato AAAA-MM',
    );
  }
  return cells;
}

function manualCell(key: string, value: string, original?: unknown) {
  const source = asCellMap(original);
  return {
    header: typeof source.header === 'string' ? source.header : key,
    raw: value,
    cached: null,
    formula: null,
    dataType: 'manual',
  };
}

function manualPayload(
  values: Record<string, string>,
  original?: CellMap,
): CellMap {
  const cells: CellMap = {};
  for (const key of DUDA_BD_GERAL_COLUMNS) {
    if (!original || values[key] !== cellValue(original[key])) {
      cells[key] = manualCell(key, values[key], original?.[key]);
    }
  }
  return cells;
}

function valuesFromCells(cells: CellMap): Record<string, string> {
  return Object.fromEntries(
    DUDA_BD_GERAL_COLUMNS.map((key) => [key, cellValue(cells[key])]),
  );
}

@Injectable()
export class DudaBdGeralService {
  constructor(private readonly prisma: PrismaService) {}

  async searchWorkSuggestions(query?: string) {
    const term = query?.trim() ?? '';
    if (!term || term.length > 80 || (!/^\d+$/.test(term) && term.length < 2)) {
      throw new BadRequestException('Informe o código ou ao menos 2 letras da obra');
    }

    const works = await this.prisma.aethosObra.findMany({
      where: {
        active: true,
        OR: [
          { code: { startsWith: term } },
          { name: { contains: term, mode: 'insensitive' } },
          { clientName: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      take: 20,
      select: { code: true, name: true, clientName: true, syncedAt: true },
    });

    // Construction Control is a manually maintained JR register. Its fields
    // supplement the Aethos work only when the work code is unambiguous.
    const state = works.length
      ? await this.prisma.constructionControlState.findUnique({
          where: { id: 'default' },
          select: { data: true },
        })
      : null;
    const data = state?.data;
    const controlWorks =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).works
        : null;
    const registered = Array.isArray(controlWorks) ? controlWorks : [];

    return works.map((work) => {
      const matches = registered.filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          String((item as Record<string, unknown>).codigoObra ?? '').trim() ===
            work.code,
      );
      const control = matches.length === 1
        ? (matches[0] as Record<string, unknown>)
        : null;
      const engineer =
        typeof control?.engenheiro === 'string'
          ? control.engenheiro.trim()
          : '';
      const contract =
        typeof control?.contrato === 'string' ? control.contrato.trim() : '';
      return {
        code: work.code,
        name: work.name,
        clientName: work.clientName,
        syncedAt: work.syncedAt,
        suggestions: {
          C: engineer || null,
          D: contract || null,
          E: work.clientName || null,
          G: work.name,
        },
        sources: {
          C: engineer ? 'JR_CONTROLE_OBRAS' : null,
          D: contract ? 'JR_CONTROLE_OBRAS' : null,
          E: work.clientName ? 'AETHOS_OBRAS' : null,
          G: 'AETHOS_OBRAS',
        },
      };
    });
  }

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

    // The imported row is immutable. For a source edit, only changed cells
    // from the manual overlay replace it. New manual records follow source
    // rows. All filtering happens on effective values before pagination.
    const effective = Prisma.sql`
      WITH effective AS (
        SELECT r.id, r."excelRow", r.classification, r."hiddenByFilter",
          r.cells || COALESCE(m.cells, '{}'::jsonb) AS cells, r.issues,
          m.id AS "manualEntryId", COALESCE(m.version, 0) AS version,
          CASE WHEN m.id IS NULL THEN 'source' ELSE 'edited' END AS "manualState",
          r."createdAt" AS "sortCreatedAt"
        FROM "DudaBdGeralRow" r
        LEFT JOIN "DudaBdGeralManualEntry" m ON m."sourceRowId" = r.id
        WHERE r."importId" = ${importId}
        UNION ALL
        SELECT m.id, NULL::integer, 'detail_candidate', false,
          m.cells, '[]'::jsonb, m.id, m.version, 'new', m."createdAt"
        FROM "DudaBdGeralManualEntry" m
        WHERE m."importId" = ${importId} AND m."sourceRowId" IS NULL
      )`;
    const cellText = (column: string) =>
      Prisma.sql`COALESCE(e.cells -> ${column} ->> 'cached', e.cells -> ${column} ->> 'raw', '')`;
    const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (classification)
      clauses.push(Prisma.sql`e.classification = ${classification}`);
    if (serviceMonth) {
      clauses.push(Prisma.sql`STRPOS(${cellText('B')}, ${serviceMonth}) > 0`);
    }
    for (const [column, term] of Object.entries(columnFilters)) {
      clauses.push(
        Prisma.sql`STRPOS(LOWER(${cellText(column)}), LOWER(${term})) > 0`,
      );
    }
    if (q) {
      clauses.push(Prisma.sql`(
        STRPOS(LOWER(${cellText('A')}), LOWER(${q})) > 0 OR
        STRPOS(LOWER(${cellText('C')}), LOWER(${q})) > 0 OR
        STRPOS(LOWER(${cellText('D')}), LOWER(${q})) > 0 OR
        STRPOS(LOWER(${cellText('E')}), LOWER(${q})) > 0 OR
        STRPOS(LOWER(${cellText('F')}), LOWER(${q})) > 0 OR
        STRPOS(LOWER(${cellText('G')}), LOWER(${q})) > 0
      )`);
    }
    const condition = Prisma.join(clauses, ' AND ');
    const [counts, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`${effective} SELECT COUNT(*)::integer AS total FROM effective e WHERE ${condition}`,
      ),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          excelRow: number | null;
          classification: string;
          hiddenByFilter: boolean;
          cells: CellMap;
          issues: unknown;
          manualEntryId: string | null;
          version: number;
          manualState: string;
        }>
      >(
        Prisma.sql`${effective} SELECT e.id, e."excelRow", e.classification, e."hiddenByFilter", e.cells, e.issues,
          e."manualEntryId", e.version, e."manualState"
          FROM effective e WHERE ${condition}
          ORDER BY e."excelRow" ASC NULLS LAST, e."sortCreatedAt" ASC, e.id ASC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ),
    ]);
    return { batch, page, pageSize, total: counts[0]?.total ?? 0, rows };
  }

  async getRow(importId: string, rowId: string) {
    const row = await this.prisma.dudaBdGeralRow.findFirst({
      where: { id: rowId, importId },
      include: { manualEntry: true },
    });
    if (row) {
      return {
        ...row,
        cells: {
          ...asCellMap(row.cells),
          ...asCellMap(row.manualEntry?.cells),
        },
        manualEntryId: row.manualEntry?.id ?? null,
        version: row.manualEntry?.version ?? 0,
        manualState: row.manualEntry ? 'edited' : 'source',
        manualEntry: undefined,
      };
    }
    const manual = await this.prisma.dudaBdGeralManualEntry.findFirst({
      where: { id: rowId, importId, sourceRowId: null },
    });
    if (!manual) throw new NotFoundException('Linha não encontrada');
    return this.manualRow(manual);
  }

  private manualRow(manual: {
    id: string;
    cells: unknown;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: manual.id,
      excelRow: null,
      classification: 'detail_candidate',
      hiddenByFilter: false,
      cells: manual.cells,
      issues: [],
      manualEntryId: manual.id,
      version: manual.version,
      manualState: 'new',
      createdAt: manual.createdAt,
      updatedAt: manual.updatedAt,
    };
  }

  async createManualEntry(
    importId: string,
    userId: string | undefined,
    input: unknown,
  ) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    const values = validateManualCells(input, true);
    const batch = await this.prisma.dudaBdGeralImport.findUnique({
      where: { id: importId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('Importação não encontrada');
    const cells = manualPayload(values) as Prisma.InputJsonValue;
    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.dudaBdGeralManualEntry.create({
        data: {
          importId,
          cells,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await tx.dudaBdGeralManualEntryRevision.create({
        data: {
          entryId: entry.id,
          version: 1,
          action: 'CREATE_MANUAL',
          afterCells: values,
          changedByUserId: userId,
        },
      });
      return entry;
    });
    return this.manualRow(created);
  }

  async updateRow(
    importId: string,
    rowId: string,
    userId: string | undefined,
    input: unknown,
    expectedVersion: unknown,
  ) {
    if (!userId) throw new BadRequestException('Usuário inválido');
    if (
      !Number.isSafeInteger(expectedVersion) ||
      (expectedVersion as number) < 0
    ) {
      throw new BadRequestException('Versão de edição inválida');
    }
    const values = validateManualCells(input, false);
    try {
      await this.prisma.$transaction(async (tx) => {
        const source = await tx.dudaBdGeralRow.findFirst({
          where: { id: rowId, importId },
        });
        if (source) {
          if (source.classification !== 'detail_candidate') {
            throw new BadRequestException(
              'Somente lançamentos identificados podem ser editados',
            );
          }
          const original = asCellMap(source.cells);
          const existing = await tx.dudaBdGeralManualEntry.findUnique({
            where: { sourceRowId: source.id },
          });
          const currentVersion = existing?.version ?? 0;
          if (currentVersion !== expectedVersion) {
            throw new ConflictException(
              'A linha mudou. Reabra para conferir antes de salvar',
            );
          }
          const before = valuesFromCells({
            ...original,
            ...asCellMap(existing?.cells),
          });
          if (DUDA_BD_GERAL_COLUMNS.every((key) => before[key] === values[key]))
            return;
          const overrides = manualPayload(values, original);
          let entryId: string;
          let version: number;
          if (existing) {
            const updated = await tx.dudaBdGeralManualEntry.updateMany({
              where: { id: existing.id, version: currentVersion },
              data: {
                cells: overrides as Prisma.InputJsonValue,
                updatedByUserId: userId,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1)
              throw new ConflictException('Edição concorrente detectada');
            entryId = existing.id;
            version = currentVersion + 1;
          } else {
            const created = await tx.dudaBdGeralManualEntry.create({
              data: {
                importId,
                sourceRowId: source.id,
                cells: overrides as Prisma.InputJsonValue,
                createdByUserId: userId,
                updatedByUserId: userId,
              },
            });
            entryId = created.id;
            version = 1;
          }
          await tx.dudaBdGeralManualEntryRevision.create({
            data: {
              entryId,
              version,
              action: existing
                ? 'UPDATE_SOURCE_OVERLAY'
                : 'CREATE_SOURCE_OVERLAY',
              beforeCells: before,
              afterCells: values,
              changedByUserId: userId,
            },
          });
          return;
        }
        const manual = await tx.dudaBdGeralManualEntry.findFirst({
          where: { id: rowId, importId, sourceRowId: null },
        });
        if (!manual) throw new NotFoundException('Lançamento não encontrado');
        if (manual.version !== expectedVersion) {
          throw new ConflictException(
            'A linha mudou. Reabra para conferir antes de salvar',
          );
        }
        if (!values.A || !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.B)) {
          throw new BadRequestException(
            'Informe ITEM e mês de serviço no formato AAAA-MM',
          );
        }
        const before = valuesFromCells(asCellMap(manual.cells));
        if (DUDA_BD_GERAL_COLUMNS.every((key) => before[key] === values[key]))
          return;
        const updated = await tx.dudaBdGeralManualEntry.updateMany({
          where: { id: manual.id, version: manual.version },
          data: {
            cells: manualPayload(values) as Prisma.InputJsonValue,
            updatedByUserId: userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1)
          throw new ConflictException('Edição concorrente detectada');
        await tx.dudaBdGeralManualEntryRevision.create({
          data: {
            entryId: manual.id,
            version: manual.version + 1,
            action: 'UPDATE_MANUAL',
            beforeCells: before,
            afterCells: values,
            changedByUserId: userId,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A linha mudou. Reabra para conferir antes de salvar',
        );
      }
      throw error;
    }
    return this.getRow(importId, rowId);
  }

  async listRevisions(importId: string, rowId: string) {
    const source = await this.prisma.dudaBdGeralRow.findFirst({
      where: { id: rowId, importId },
      select: { id: true },
    });
    const entry = source
      ? await this.prisma.dudaBdGeralManualEntry.findUnique({
          where: { sourceRowId: source.id },
        })
      : await this.prisma.dudaBdGeralManualEntry.findFirst({
          where: { id: rowId, importId, sourceRowId: null },
        });
    if (!source && !entry) throw new NotFoundException('Linha não encontrada');
    if (!entry) return [];
    const revisions = await this.prisma.dudaBdGeralManualEntryRevision.findMany(
      {
        where: { entryId: entry.id },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          action: true,
          beforeCells: true,
          afterCells: true,
          changedByUserId: true,
          changedAt: true,
        },
      },
    );
    const actors = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(revisions.map((revision) => revision.changedByUserId)),
          ],
        },
      },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((actor) => [actor.id, actor.name]));
    return revisions.map((revision) => ({
      ...revision,
      changedByName:
        names.get(revision.changedByUserId) ?? 'Usuário não encontrado',
    }));
  }
}
