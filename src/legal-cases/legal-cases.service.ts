import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';

const ALLOWED_ROLES = new Set(['juridico', 'gestor', 'ceo']);
const AREAS = new Set(['TRABALHISTA', 'CIVEL']);
const COMPANIES = new Set([
  'JR_CONSTRUCOES',
  'JORGE_RODRIGUES',
  'PEDRA_FORTE',
  'PRUMARE',
]);
const STATUSES = new Set(['EM_ANDAMENTO', 'ENCERRADO']);
const PROBABILITIES = new Set(['BAIXA', 'MEDIA', 'ALTA']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type Actor = { id?: string | null; name?: string | null };
type Row = Record<string, unknown>;

function normalizeRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

export function ensureLegalCasesAccess(role?: string | null) {
  if (!ALLOWED_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para acessar Processos Juridicos',
    );
  }
}

function text(value: unknown, maxLength = 10000) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().slice(0, maxLength);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return `${value}`.trim().slice(0, maxLength);
  }
  if (value instanceof Date) return value.toISOString().slice(0, maxLength);
  return JSON.stringify(value).trim().slice(0, maxLength);
}

function nullableText(value: unknown, maxLength = 10000) {
  return text(value, maxLength) || null;
}

export function legalProcessKey(value: unknown) {
  return text(value, 200)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function enumValue(
  value: unknown,
  allowed: Set<string>,
  field: string,
  nullable = false,
) {
  const normalized = text(value, 80).toUpperCase();
  if (!normalized && nullable) return null;
  if (!allowed.has(normalized)) {
    throw new BadRequestException(`${field} invalido`);
  }
  return normalized;
}

function dateValue(value: unknown, field: string) {
  if (value === null || value === undefined || text(value) === '') return null;
  const normalized = text(value, 40);
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T12:00:00.000Z`
      : normalized,
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} invalida`);
  }
  return parsed;
}

function decimalValue(value: unknown, field: string) {
  if (value === null || value === undefined || text(value) === '') return null;
  if (value instanceof Prisma.Decimal) return value;
  let normalized = text(value, 80).replace(/\s|R\$/gi, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} invalido`);
  }
  return new Prisma.Decimal(parsed.toFixed(2));
}

function decimalNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : value.toNumber();
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function numberQuery(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePayload(body: Row, create: boolean) {
  const data: Record<string, unknown> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (create || has('area')) data.area = enumValue(body.area, AREAS, 'Area');
  if (create || has('company'))
    data.company = enumValue(body.company, COMPANIES, 'Empresa');
  if (create || has('processNumber')) {
    const processNumber = text(body.processNumber, 200);
    const processKey = legalProcessKey(processNumber);
    if (!processNumber || !processKey) {
      throw new BadRequestException('Numero do processo obrigatorio');
    }
    data.processNumber = processNumber;
    data.processKey = processKey;
  }
  if (create || has('status'))
    data.status = enumValue(body.status, STATUSES, 'Status');
  if (has('riskProbability'))
    data.riskProbability = enumValue(
      body.riskProbability,
      PROBABILITIES,
      'Probabilidade',
      true,
    );

  for (const key of [
    'claimantName',
    'plaintiffName',
    'defendantName',
    'claimsDescription',
    'matter',
    'proceduralPhase',
    'observations',
  ]) {
    if (has(key)) data[key] = nullableText(body[key]);
  }
  for (const key of ['notificationDate', 'lastMovementDate', 'closedAt']) {
    if (has(key)) data[key] = dateValue(body[key], key);
  }
  for (const key of [
    'originalClaimAmount',
    'judgmentAmount',
    'finalPaidAmount',
  ]) {
    if (has(key)) data[key] = decimalValue(body[key], key);
  }

  if (create && data.originalClaimAmount === null) {
    throw new BadRequestException('Valor original da acao obrigatorio');
  }
  if (create && data.area === 'TRABALHISTA' && !data.claimantName) {
    throw new BadRequestException('Nome do reclamante obrigatorio');
  }
  if (
    create &&
    data.area === 'CIVEL' &&
    (!data.plaintiffName || !data.defendantName)
  ) {
    throw new BadRequestException('Autor e reu sao obrigatorios');
  }
  if (data.status === 'ENCERRADO' && !data.closedAt) {
    throw new BadRequestException('Informe a data de encerramento');
  }
  return data;
}

function serializeCase(row: any) {
  return {
    ...row,
    notificationDate: iso(row.notificationDate),
    lastMovementDate: iso(row.lastMovementDate),
    closedAt: iso(row.closedAt),
    originalClaimAmount: decimalNumber(row.originalClaimAmount),
    judgmentAmount: decimalNumber(row.judgmentAmount),
    finalPaidAmount: decimalNumber(row.finalPaidAmount),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    attachmentCount:
      row._count?.attachments ??
      row.attachments?.filter((attachment: any) => attachment.active).length ??
      0,
    attachments: row.attachments?.map((attachment: any) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      uploadedById: attachment.uploadedById,
      uploadedByName: attachment.uploadedByName,
      createdAt: iso(attachment.createdAt),
    })),
    audits: row.audits?.map((audit: any) => ({
      ...audit,
      changedAt: iso(audit.changedAt),
    })),
  };
}

export interface LegalDashboardRow {
  area: string;
  company: string;
  status: string | null;
  referenceDate: Date | null;
  originalClaimAmount: number | null;
  judgmentAmount: number | null;
  finalPaidAmount: number | null;
}

export function aggregateLegalDashboard(
  rows: LegalDashboardRow[],
  year?: number,
) {
  const selected = year
    ? rows.filter((row) => row.referenceDate?.getUTCFullYear() === year)
    : rows;
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    label: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2026, index, 1)))
      .replace('.', ''),
    caseCount: 0,
    originalAmount: 0,
    judgmentAmount: 0,
    finalPaidAmount: 0,
    originalComparableAmount: 0,
    originalComparablePaid: 0,
    judgmentComparableAmount: 0,
    judgmentComparablePaid: 0,
    conversionOriginalPct: null as number | null,
    conversionJudgmentPct: null as number | null,
  }));

  let originalTotal = 0;
  let judgmentTotal = 0;
  let finalPaidTotal = 0;
  let originalComparableAmount = 0;
  let originalComparablePaid = 0;
  let judgmentComparableAmount = 0;
  let judgmentComparablePaid = 0;

  for (const row of selected) {
    if (row.originalClaimAmount !== null)
      originalTotal += row.originalClaimAmount;
    if (row.judgmentAmount !== null) judgmentTotal += row.judgmentAmount;
    if (row.finalPaidAmount !== null) finalPaidTotal += row.finalPaidAmount;
    if (
      row.originalClaimAmount !== null &&
      row.originalClaimAmount !== 0 &&
      row.finalPaidAmount !== null
    ) {
      originalComparableAmount += row.originalClaimAmount;
      originalComparablePaid += row.finalPaidAmount;
    }
    if (
      row.judgmentAmount !== null &&
      row.judgmentAmount !== 0 &&
      row.finalPaidAmount !== null
    ) {
      judgmentComparableAmount += row.judgmentAmount;
      judgmentComparablePaid += row.finalPaidAmount;
    }
    if (!row.referenceDate) continue;
    const month = months[row.referenceDate.getUTCMonth()];
    month.caseCount += 1;
    if (row.originalClaimAmount !== null)
      month.originalAmount += row.originalClaimAmount;
    if (row.judgmentAmount !== null) month.judgmentAmount += row.judgmentAmount;
    if (row.finalPaidAmount !== null)
      month.finalPaidAmount += row.finalPaidAmount;
    if (
      row.originalClaimAmount !== null &&
      row.originalClaimAmount !== 0 &&
      row.finalPaidAmount !== null
    ) {
      month.originalComparableAmount += row.originalClaimAmount;
      month.originalComparablePaid += row.finalPaidAmount;
    }
    if (
      row.judgmentAmount !== null &&
      row.judgmentAmount !== 0 &&
      row.finalPaidAmount !== null
    ) {
      month.judgmentComparableAmount += row.judgmentAmount;
      month.judgmentComparablePaid += row.finalPaidAmount;
    }
  }

  for (const month of months) {
    month.conversionOriginalPct = month.originalComparableAmount
      ? (month.originalComparablePaid / month.originalComparableAmount) * 100
      : null;
    month.conversionJudgmentPct = month.judgmentComparableAmount
      ? (month.judgmentComparablePaid / month.judgmentComparableAmount) * 100
      : null;
  }

  return {
    totalCases: selected.length,
    inProgress: selected.filter((row) => row.status === 'EM_ANDAMENTO').length,
    closed: selected.filter((row) => row.status === 'ENCERRADO').length,
    statusNotInformed: selected.filter((row) => row.status === null).length,
    originalTotal,
    judgmentTotal,
    finalPaidTotal,
    savingsAgainstOriginal: originalComparableAmount - originalComparablePaid,
    conversionOriginalPct: originalComparableAmount
      ? (originalComparablePaid / originalComparableAmount) * 100
      : null,
    conversionJudgmentPct: judgmentComparableAmount
      ? (judgmentComparablePaid / judgmentComparableAmount) * 100
      : null,
    comparableOriginalCount: selected.filter(
      (row) =>
        row.originalClaimAmount !== null &&
        row.originalClaimAmount !== 0 &&
        row.finalPaidAmount !== null,
    ).length,
    comparableJudgmentCount: selected.filter(
      (row) =>
        row.judgmentAmount !== null &&
        row.judgmentAmount !== 0 &&
        row.finalPaidAmount !== null,
    ).length,
    months,
  };
}

@Injectable()
export class LegalCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3UploadService,
  ) {}

  private where(query: Row, includeYear = false): Prisma.LegalCaseWhereInput {
    const where: Prisma.LegalCaseWhereInput = { active: true };
    const area = text(query.area, 30).toUpperCase();
    const company = text(query.company, 50).toUpperCase();
    const status = text(query.status, 30).toUpperCase();
    const search = text(query.search, 200);
    if (area && AREAS.has(area)) where.area = area;
    if (company && COMPANIES.has(company)) where.company = company;
    if (status && STATUSES.has(status)) where.status = status;
    if (search) {
      where.OR = [
        { processNumber: { contains: search, mode: 'insensitive' } },
        { claimantName: { contains: search, mode: 'insensitive' } },
        { plaintiffName: { contains: search, mode: 'insensitive' } },
        { defendantName: { contains: search, mode: 'insensitive' } },
        { observations: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (includeYear) {
      const year = numberQuery(query.year, 0);
      if (year >= 1900 && year <= 2200) {
        const from = new Date(Date.UTC(year, 0, 1));
        const to = new Date(Date.UTC(year + 1, 0, 1));
        where.AND = [
          {
            OR: [
              { notificationDate: { gte: from, lt: to } },
              {
                notificationDate: null,
                lastMovementDate: { gte: from, lt: to },
              },
              {
                notificationDate: null,
                lastMovementDate: null,
                closedAt: { gte: from, lt: to },
              },
            ],
          },
        ];
      }
    }
    return where;
  }

  async findAll(query: Row, role?: string | null) {
    ensureLegalCasesAccess(role);
    const page = Math.max(1, Math.floor(numberQuery(query.page, 1)));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(numberQuery(query.pageSize, DEFAULT_PAGE_SIZE))),
    );
    const where = this.where(query);
    const [rows, total, options] = await Promise.all([
      this.prisma.legalCase.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { processNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { attachments: { where: { active: true } } } },
        },
      }),
      this.prisma.legalCase.count({ where }),
      this.prisma.legalCase.findMany({
        where: { active: true },
        select: { company: true, area: true, status: true },
        distinct: ['company', 'area', 'status'],
      }),
    ]);
    return {
      rows: rows.map(serializeCase),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      options: {
        companies: [...new Set(options.map((item) => item.company))].sort(),
        areas: [...new Set(options.map((item) => item.area))].sort(),
        statuses: [
          ...new Set(options.map((item) => item.status).filter(Boolean)),
        ].sort(),
      },
    };
  }

  async dashboard(query: Row, role?: string | null) {
    ensureLegalCasesAccess(role);
    const year = numberQuery(query.year, new Date().getUTCFullYear());
    const rows = await this.prisma.legalCase.findMany({
      where: this.where(query, true),
      select: {
        area: true,
        company: true,
        status: true,
        notificationDate: true,
        lastMovementDate: true,
        closedAt: true,
        originalClaimAmount: true,
        judgmentAmount: true,
        finalPaidAmount: true,
      },
    });
    const normalized = rows.map((row) => ({
      area: row.area,
      company: row.company,
      status: row.status,
      referenceDate:
        row.notificationDate || row.lastMovementDate || row.closedAt,
      originalClaimAmount: decimalNumber(row.originalClaimAmount),
      judgmentAmount: decimalNumber(row.judgmentAmount),
      finalPaidAmount: decimalNumber(row.finalPaidAmount),
    }));
    const summary = aggregateLegalDashboard(normalized, year);
    return {
      year,
      referenceRule:
        'TRABALHISTA: data de notificacao; CIVEL: data do ultimo andamento; na ausencia, data de encerramento.',
      ...summary,
      byArea: [...AREAS].map((area) => ({
        area,
        ...aggregateLegalDashboard(
          normalized.filter((row) => row.area === area),
          year,
        ),
      })),
    };
  }

  async findOne(id: string, role?: string | null) {
    ensureLegalCasesAccess(role);
    const row = await this.prisma.legalCase.findFirst({
      where: { id, active: true },
      include: {
        audits: { orderBy: { changedAt: 'desc' } },
        attachments: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Processo juridico nao encontrado');
    return serializeCase(row);
  }

  async attachFile(
    id: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
    role: string | null | undefined,
    actor: Actor,
  ) {
    ensureLegalCasesAccess(role);
    if (!actor.id) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }
    const current = await this.prisma.legalCase.findFirst({
      where: { id, active: true },
    });
    if (!current) {
      throw new NotFoundException('Processo juridico nao encontrado');
    }

    const fileName = text(file.originalname, 255);
    if (!fileName) throw new BadRequestException('Nome do arquivo obrigatorio');
    const uploaded = await this.storage.uploadFile(file, 'legal-case');

    try {
      await this.prisma.$transaction(async (tx) => {
        const attachment = await tx.legalCaseAttachment.create({
          data: {
            legalCaseId: id,
            fileName,
            fileKey: uploaded.key,
            mimeType: nullableText(file.mimetype, 150),
            sizeBytes: file.size ?? null,
            uploadedById: actor.id,
            uploadedByName: actor.name,
          },
        });
        await tx.legalCaseAudit.create({
          data: {
            legalCaseId: id,
            action: 'ATTACHMENT_ADD',
            actorId: actor.id,
            actorName: actor.name,
            afterData: {
              attachmentId: attachment.id,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            },
          },
        });
      });
    } catch (error) {
      await this.storage.deleteFile(uploaded.key);
      throw error;
    }

    return this.findOne(id, role);
  }

  async getAttachmentFile(
    id: string,
    attachmentId: string,
    role?: string | null,
  ) {
    ensureLegalCasesAccess(role);
    const attachment = await this.prisma.legalCaseAttachment.findFirst({
      where: {
        id: attachmentId,
        legalCaseId: id,
        active: true,
        legalCase: { active: true },
      },
    });
    if (!attachment) throw new NotFoundException('Anexo nao encontrado');
    const file = await this.storage.getObject(attachment.fileKey);
    return { attachment, file };
  }

  async deleteAttachment(
    id: string,
    attachmentId: string,
    role: string | null | undefined,
    actor: Actor,
  ) {
    ensureLegalCasesAccess(role);
    if (!actor.id) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }
    const attachment = await this.prisma.legalCaseAttachment.findFirst({
      where: {
        id: attachmentId,
        legalCaseId: id,
        active: true,
        legalCase: { active: true },
      },
    });
    if (!attachment) throw new NotFoundException('Anexo nao encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.legalCaseAttachment.update({
        where: { id: attachmentId },
        data: {
          active: false,
          deletedAt: new Date(),
          deletedById: actor.id,
          deletedByName: actor.name,
        },
      });
      await tx.legalCaseAudit.create({
        data: {
          legalCaseId: id,
          action: 'ATTACHMENT_REMOVE',
          actorId: actor.id,
          actorName: actor.name,
          beforeData: {
            attachmentId: attachment.id,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
        },
      });
    });
    await this.storage.deleteFile(attachment.fileKey);
    return this.findOne(id, role);
  }

  async create(body: Row, role: string | null | undefined, actor: Actor) {
    ensureLegalCasesAccess(role);
    const data = normalizePayload(body, true) as Prisma.LegalCaseCreateInput;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.legalCase.create({
          data: {
            ...data,
            sourceType: 'JR_MANUAL',
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        await tx.legalCaseAudit.create({
          data: {
            legalCaseId: created.id,
            action: 'CREATE',
            actorId: actor.id,
            actorName: actor.name,
            afterData: created as unknown as Prisma.InputJsonValue,
          },
        });
        return created;
      });
      return serializeCase(row);
    } catch (error: any) {
      if (error?.code === 'P2002')
        throw new BadRequestException('Ja existe um processo com este numero');
      throw error;
    }
  }

  async update(
    id: string,
    body: Row,
    role: string | null | undefined,
    actor: Actor,
  ) {
    ensureLegalCasesAccess(role);
    const current = await this.prisma.legalCase.findFirst({
      where: { id, active: true },
    });
    if (!current)
      throw new NotFoundException('Processo juridico nao encontrado');
    if (Object.prototype.hasOwnProperty.call(body, 'originalClaimAmount')) {
      const requested = decimalValue(
        body.originalClaimAmount,
        'originalClaimAmount',
      );
      const before = decimalNumber(current.originalClaimAmount);
      const after = decimalNumber(requested);
      if (before !== after)
        throw new BadRequestException(
          'O valor original da acao nao pode ser alterado',
        );
    }
    const data = normalizePayload(body, false) as Prisma.LegalCaseUpdateInput;
    delete (data as any).originalClaimAmount;
    if (data.area && data.area !== current.area) {
      throw new BadRequestException('A area do processo nao pode ser alterada');
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.legalCase.update({
          where: { id },
          data: { ...data, updatedById: actor.id },
        });
        await tx.legalCaseAudit.create({
          data: {
            legalCaseId: id,
            action: 'UPDATE',
            actorId: actor.id,
            actorName: actor.name,
            beforeData: current as unknown as Prisma.InputJsonValue,
            afterData: updated as unknown as Prisma.InputJsonValue,
          },
        });
        return updated;
      });
      return serializeCase(row);
    } catch (error: any) {
      if (error?.code === 'P2002')
        throw new BadRequestException('Ja existe um processo com este numero');
      throw error;
    }
  }

  async remove(id: string, role: string | null | undefined, actor: Actor) {
    ensureLegalCasesAccess(role);
    const current = await this.prisma.legalCase.findFirst({
      where: { id, active: true },
    });
    if (!current)
      throw new NotFoundException('Processo juridico nao encontrado');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.legalCase.update({
        where: { id },
        data: { active: false, updatedById: actor.id },
      });
      await tx.legalCaseAudit.create({
        data: {
          legalCaseId: id,
          action: 'ARCHIVE',
          actorId: actor.id,
          actorName: actor.name,
          beforeData: current as unknown as Prisma.InputJsonValue,
          afterData: updated as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true };
  }
}
