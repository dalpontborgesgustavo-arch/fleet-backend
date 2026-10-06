import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';
import { EmailService } from '../email/email.service';

const ALLOWED_ROLES = new Set(['ssma']);
const ALLOWED_COMPANIES = new Set(['JR_CONSTRUCOES', 'PEDRAFORTE']);
const ALLOWED_RENEWAL_STATUS = new Set([
  'Planejada',
  'Em andamento',
  'Concluida',
  'Cancelada',
]);

const includeLicenseRelations = {
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  renewals: {
    orderBy: {
      createdAt: 'desc' as const,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
};

type SsmaLicenseWithRelations = Prisma.SsmaLicenseGetPayload<{
  include: typeof includeLicenseRelations;
}>;

type SsmaRenewalWithRelations = SsmaLicenseWithRelations['renewals'][number];

type SsmaAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileKey?: string | null;
  mimeType?: string | null;
  size?: number | null;
  uploadedAt: string;
  uploadedById?: string | null;
};

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).trim();
  return '';
}

function parseOptionalDate(value: unknown, fieldName: string) {
  const text = coerceText(value);
  if (!text) return null;

  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} invalida`);
  }

  return date;
}

function parseRequiredDate(value: unknown, fieldName: string) {
  const date = parseOptionalDate(value, fieldName);
  if (!date) {
    throw new BadRequestException(`${fieldName} e obrigatoria`);
  }
  return date;
}

function dateParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

export function calculateLicenseExpiryDate(
  issueDate: Date,
  durationMonths: number,
) {
  const { year, month, day } = dateParts(issueDate);
  const targetMonthIndex = month + durationMonths;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0, 12, 0, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastDay), 12, 0, 0),
  );
}

function normalizeEmail(value: unknown) {
  const email = coerceText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function splitAlertEmailEntries(value: unknown) {
  const entries = Array.isArray(value)
    ? value
    : coerceText(value).split(/[;,\n]+/);
  return entries.map((entry) => coerceText(entry)).filter(Boolean);
}

export function normalizeAlertEmails(value: unknown) {
  const unique = new Set<string>();

  for (const entry of splitAlertEmailEntries(value)) {
    const email = normalizeEmail(entry);
    if (email) unique.add(email);
  }

  return [...unique];
}

function sameCalendarDate(left?: Date | null, right?: Date | null) {
  if (!left || !right) return false;
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function todayInSaoPaulo(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return new Date(
    Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      12,
    ),
  );
}

function calendarDaysBetween(start: Date, end: Date) {
  const startParts = dateParts(start);
  const endParts = dateParts(end);
  const startTime = Date.UTC(startParts.year, startParts.month, startParts.day);
  const endTime = Date.UTC(endParts.year, endParts.month, endParts.day);
  return Math.round((endTime - startTime) / 86400000);
}

function escapeHtml(value: unknown) {
  return coerceText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDatePt(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
  }).format(date);
}

function companyLabel(company: string) {
  if (company === 'JR_CONSTRUCOES') return 'JR Construcoes';
  if (company === 'PEDRAFORTE') return 'Pedraforte';
  return company;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

@Injectable()
export class SsmaLicensesService implements OnModuleInit, OnModuleDestroy {
  private alertTimer?: NodeJS.Timeout;
  private alertStartupTimer?: NodeJS.Timeout;
  private alertRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3UploadService: S3UploadService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.SSMA_LICENSE_ALERT_ENABLED === 'false') return;

    const intervalMs =
      positiveNumber(process.env.SSMA_LICENSE_ALERT_INTERVAL_HOURS, 1) *
      60 *
      60 *
      1000;

    this.alertTimer = setInterval(() => {
      void this.sendDueExpiryAlerts().catch((error) => {
        console.warn(
          `[ssma-license-alert] Falha na rotina automatica: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      });
    }, intervalMs);
    this.alertTimer.unref?.();

    this.alertStartupTimer = setTimeout(() => {
      void this.sendDueExpiryAlerts().catch((error) => {
        console.warn(
          `[ssma-license-alert] Falha na verificacao inicial: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      });
    }, 60_000);
    this.alertStartupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.alertTimer) clearInterval(this.alertTimer);
    if (this.alertStartupTimer) clearTimeout(this.alertStartupTimer);
  }

  private ensureAccess(role?: string | null) {
    if (!ALLOWED_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException('Sem permissao para acessar licencas SSMA');
    }
  }

  async findAll(actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const records = await this.prisma.ssmaLicense.findMany({
      where: { active: true },
      orderBy: [{ expiryDate: 'asc' }, { company: 'asc' }, { name: 'asc' }],
      include: includeLicenseRelations,
    });

    return records.map((record) => this.serializeLicense(record));
  }

  async create(data: any, actorRole?: string | null, actorId?: string | null) {
    this.ensureAccess(actorRole);

    const payload = this.parseLicensePayload(data);
    const created = await this.prisma.ssmaLicense.create({
      data: {
        ...payload,
        createdById: actorId || null,
      },
      include: includeLicenseRelations,
    });

    return this.serializeLicense(created);
  }

  async update(id: string, data: any, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const existing = await this.ensureLicenseExists(id);
    const payload = this.parseLicensePayload(data);
    const expiryChanged = !sameCalendarDate(
      existing.expiryDate,
      payload.expiryDate,
    );
    const updated = await this.prisma.ssmaLicense.update({
      where: { id },
      data: {
        ...payload,
        ...(expiryChanged
          ? {
              alertSentForExpiry: null,
              alertSentAt: null,
              alertLastError: null,
            }
          : {}),
      },
      include: includeLicenseRelations,
    });

    return this.serializeLicense(updated);
  }

  async deactivate(id: string, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    await this.ensureLicenseExists(id);
    await this.prisma.ssmaLicense.update({
      where: { id },
      data: { active: false },
    });

    return { ok: true };
  }

  async createRenewal(
    id: string,
    data: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);

    await this.ensureLicenseExists(id);
    const created = await this.prisma.ssmaLicenseRenewal.create({
      data: {
        licenseId: id,
        ...this.parseRenewalPayload(data),
        createdById: actorId || null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.serializeRenewal(created);
  }

  async updateRenewal(renewalId: string, data: any, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const existing = await this.prisma.ssmaLicenseRenewal.findUnique({
      where: { id: renewalId },
    });
    if (!existing) {
      throw new NotFoundException('Renovacao nao encontrada');
    }

    const updated = await this.prisma.ssmaLicenseRenewal.update({
      where: { id: renewalId },
      data: this.parseRenewalPayload(data),
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.serializeRenewal(updated);
  }

  async attachRenewalFile(
    renewalId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    this.ensureAccess(actorRole);

    const existing = await this.prisma.ssmaLicenseRenewal.findUnique({
      where: { id: renewalId },
    });
    if (!existing) {
      throw new NotFoundException('Renovacao nao encontrada');
    }

    const uploaded = await this.s3UploadService.uploadFile(file, 'ssma');
    const currentAttachments = this.normalizeAttachments(existing.attachments);
    const attachment: SsmaAttachment = {
      id: randomUUID(),
      fileName: file.originalname || 'arquivo',
      fileUrl: uploaded.url,
      fileKey: uploaded.key || null,
      mimeType: file.mimetype || null,
      size: typeof file.size === 'number' ? file.size : null,
      uploadedAt: new Date().toISOString(),
      uploadedById: actorId || null,
    };

    const updated = await this.prisma.ssmaLicenseRenewal.update({
      where: { id: renewalId },
      data: {
        attachments: [
          ...currentAttachments,
          attachment,
        ] as unknown as Prisma.InputJsonValue,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.serializeRenewal(updated);
  }

  async removeRenewal(renewalId: string, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const existing = await this.prisma.ssmaLicenseRenewal.findUnique({
      where: { id: renewalId },
    });
    if (!existing) {
      throw new NotFoundException('Renovacao nao encontrada');
    }

    await this.prisma.ssmaLicenseRenewal.delete({
      where: { id: renewalId },
    });

    return { ok: true };
  }

  async sendDueExpiryAlerts(reference = new Date()) {
    if (this.alertRunning) {
      return { processed: 0, sent: 0, failed: 0, alreadyRunning: true };
    }

    this.alertRunning = true;
    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      const today = todayInSaoPaulo(reference);
      const licenses = await this.prisma.ssmaLicense.findMany({
        where: { active: true },
        orderBy: { expiryDate: 'asc' },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      for (const license of licenses) {
        const daysRemaining = calendarDaysBetween(today, license.expiryDate);
        if (
          daysRemaining < 0 ||
          daysRemaining > license.alertDaysBefore ||
          sameCalendarDate(license.alertSentForExpiry, license.expiryDate)
        ) {
          continue;
        }

        const claim = await this.prisma.ssmaLicense.updateMany({
          where: {
            id: license.id,
            OR: [
              { alertSentForExpiry: null },
              { alertSentForExpiry: { not: license.expiryDate } },
            ],
          },
          data: {
            alertSentForExpiry: license.expiryDate,
            alertLastError: null,
          },
        });
        if (!claim.count) continue;

        processed += 1;
        const recipients = new Set(normalizeAlertEmails(license.alertEmails));
        const creatorEmail = normalizeEmail(license.createdBy?.email);
        if (creatorEmail) recipients.add(creatorEmail);

        if (!recipients.size) {
          failed += 1;
          await this.releaseAlertClaim(
            license.id,
            license.expiryDate,
            'Nenhum e-mail valido configurado para o alerta.',
          );
          continue;
        }

        const result = await this.emailService.sendMail(
          this.buildExpiryAlertEmail({
            license,
            recipients: [...recipients],
            daysRemaining,
          }),
        );

        if (result.sent) {
          sent += 1;
          await this.prisma.ssmaLicense.update({
            where: { id: license.id },
            data: { alertSentAt: new Date(), alertLastError: null },
          });
        } else {
          failed += 1;
          await this.releaseAlertClaim(
            license.id,
            license.expiryDate,
            result.error || 'Falha ao enviar alerta.',
          );
        }
      }

      if (processed) {
        console.log(
          `[ssma-license-alert] processadas=${processed} enviadas=${sent} falhas=${failed}`,
        );
      }

      return { processed, sent, failed, alreadyRunning: false };
    } finally {
      this.alertRunning = false;
    }
  }

  private async ensureLicenseExists(id: string) {
    const existing = await this.prisma.ssmaLicense.findUnique({
      where: { id },
    });

    if (!existing || !existing.active) {
      throw new NotFoundException('Licenca nao encontrada');
    }

    return existing;
  }

  private parseLicensePayload(data: any) {
    const company = coerceText(data?.company);
    if (!ALLOWED_COMPANIES.has(company)) {
      throw new BadRequestException('Empresa invalida');
    }

    const name = coerceText(data?.name);
    if (!name) {
      throw new BadRequestException('Nome da licenca e obrigatorio');
    }

    const durationMonths = this.parseRequiredPositiveInteger(
      data?.durationMonths,
      'Duracao da licenca',
    );
    const issueDate = parseRequiredDate(data?.issueDate, 'Data de emissao');

    return {
      company,
      name,
      category: coerceText(data?.category) || null,
      durationMonths,
      issuingAgency: coerceText(data?.issuingAgency) || null,
      licenseNumber: coerceText(data?.licenseNumber) || null,
      issueDate,
      expiryDate: calculateLicenseExpiryDate(issueDate, durationMonths),
      alertDaysBefore: this.parseRequiredNonNegativeInteger(
        data?.alertDaysBefore,
        'Antecedencia do alerta',
      ),
      alertEmails: this.parseAlertEmails(data?.alertEmails),
      responsible: coerceText(data?.responsible) || null,
      notes: coerceText(data?.notes) || null,
    };
  }

  private parseRenewalPayload(data: any) {
    const status = coerceText(data?.status) || 'Planejada';
    if (!ALLOWED_RENEWAL_STATUS.has(status)) {
      throw new BadRequestException('Status da renovacao invalido');
    }

    return {
      status,
      protocolNumber: coerceText(data?.protocolNumber) || null,
      requestedAt: parseOptionalDate(data?.requestedAt, 'Data de solicitacao'),
      expectedAt: parseOptionalDate(data?.expectedAt, 'Previsao de retorno'),
      completedAt: parseOptionalDate(data?.completedAt, 'Data de conclusao'),
      notes: coerceText(data?.notes) || null,
      attachments: Array.isArray(data?.attachments)
        ? (this.normalizeAttachments(
            data.attachments,
          ) as unknown as Prisma.InputJsonValue)
        : undefined,
    };
  }

  private parseRequiredPositiveInteger(value: unknown, fieldName: string) {
    const text = coerceText(value);
    if (!text) {
      throw new BadRequestException(`${fieldName} e obrigatoria`);
    }

    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1200) {
      throw new BadRequestException(`${fieldName} invalida`);
    }

    return parsed;
  }

  private parseRequiredNonNegativeInteger(value: unknown, fieldName: string) {
    const text = coerceText(value);
    if (!text) {
      throw new BadRequestException(`${fieldName} e obrigatoria`);
    }

    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3650) {
      throw new BadRequestException(`${fieldName} invalida`);
    }

    return parsed;
  }

  private parseAlertEmails(value: unknown) {
    const entries = splitAlertEmailEntries(value);
    const invalidEmail = entries.find((entry) => !normalizeEmail(entry));
    if (invalidEmail) {
      throw new BadRequestException(
        `E-mail adicional invalido: ${invalidEmail}`,
      );
    }
    return normalizeAlertEmails(entries);
  }

  private async releaseAlertClaim(
    licenseId: string,
    expiryDate: Date,
    error: string,
  ) {
    await this.prisma.ssmaLicense.updateMany({
      where: { id: licenseId, alertSentForExpiry: expiryDate },
      data: {
        alertSentForExpiry: null,
        alertLastError: error.slice(0, 1000),
      },
    });
  }

  private buildExpiryAlertEmail(input: {
    license: {
      company: string;
      name: string;
      category: string | null;
      issuingAgency: string | null;
      licenseNumber: string | null;
      issueDate: Date | null;
      expiryDate: Date;
      responsible: string | null;
    };
    recipients: string[];
    daysRemaining: number;
  }) {
    const { license, daysRemaining } = input;
    const loginUrl = (
      process.env.APP_PUBLIC_URL?.trim() || 'https://app.jrconstrucoes.net.br'
    ).replace(/\/+$/, '');
    const deadline =
      daysRemaining === 0 ? 'vence hoje' : `vence em ${daysRemaining} dia(s)`;
    const subject = `Alerta de vencimento: ${license.name} ${deadline}`;
    const details = [
      ['Empresa', companyLabel(license.company)],
      ['Licenca', license.name],
      ['Categoria', license.category || '-'],
      ['Numero', license.licenseNumber || '-'],
      ['Orgao emissor', license.issuingAgency || '-'],
      ['Emissao', license.issueDate ? formatDatePt(license.issueDate) : '-'],
      ['Vencimento', formatDatePt(license.expiryDate)],
      ['Responsavel', license.responsible || '-'],
    ];

    return {
      to: input.recipients.join(', '),
      subject,
      text: [
        'Alerta automatico do Sistema JR.',
        '',
        `A licenca "${license.name}" ${deadline}.`,
        ...details.map(([label, value]) => `${label}: ${value}`),
        '',
        `Acesse: ${loginUrl}`,
      ].join('\n'),
      html: `
        <!doctype html>
        <html lang="pt-BR">
          <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
            <div style="max-width:640px;margin:0 auto;padding:24px">
              <div style="overflow:hidden;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.08)">
                <div style="background:#b91c1c;padding:22px 28px;color:#fff">
                  <div style="font-size:22px;font-weight:800">Sistema JR</div>
                  <div style="margin-top:4px;font-size:13px;opacity:.9">Alerta de vencimento de licenca</div>
                </div>
                <div style="padding:28px">
                  <p style="margin:0 0 18px;font-size:17px;line-height:1.55">A licenca <strong>${escapeHtml(license.name)}</strong> ${escapeHtml(deadline)}.</p>
                  <table style="width:100%;border-collapse:collapse">
                    ${details
                      .map(
                        ([label, value]) => `
                          <tr>
                            <td style="border-bottom:1px solid #e5e7eb;padding:10px 8px;color:#6b7280;font-size:13px;font-weight:700">${escapeHtml(label)}</td>
                            <td style="border-bottom:1px solid #e5e7eb;padding:10px 8px;text-align:right;font-size:14px;font-weight:700">${escapeHtml(value)}</td>
                          </tr>`,
                      )
                      .join('')}
                  </table>
                  <div style="margin-top:24px;text-align:center">
                    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;border-radius:8px;background:#b91c1c;padding:13px 24px;color:#fff;text-decoration:none;font-weight:800">Acessar Sistema JR</a>
                  </div>
                </div>
              </div>
            </div>
          </body>
        </html>`,
    };
  }

  private normalizeAttachments(value: unknown): SsmaAttachment[] {
    if (!Array.isArray(value)) return [];

    const attachments: SsmaAttachment[] = [];

    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const fileUrl = coerceText(record.fileUrl);
      const fileName = coerceText(record.fileName) || 'arquivo';
      if (!fileUrl) continue;

      attachments.push({
        id: coerceText(record.id) || randomUUID(),
        fileName,
        fileUrl,
        fileKey: coerceText(record.fileKey) || null,
        mimeType: coerceText(record.mimeType) || null,
        size: typeof record.size === 'number' ? record.size : null,
        uploadedAt: coerceText(record.uploadedAt) || new Date().toISOString(),
        uploadedById: coerceText(record.uploadedById) || null,
      });
    }

    return attachments;
  }

  private serializeLicense(record: SsmaLicenseWithRelations) {
    return {
      id: record.id,
      company: record.company,
      name: record.name,
      category: record.category,
      durationMonths: record.durationMonths,
      issuingAgency: record.issuingAgency,
      licenseNumber: record.licenseNumber,
      issueDate: record.issueDate?.toISOString() ?? null,
      expiryDate: record.expiryDate.toISOString(),
      alertDaysBefore: record.alertDaysBefore,
      alertEmails: record.alertEmails,
      alertSentForExpiry: record.alertSentForExpiry?.toISOString() ?? null,
      alertSentAt: record.alertSentAt?.toISOString() ?? null,
      alertLastError: record.alertLastError,
      responsible: record.responsible,
      notes: record.notes,
      active: record.active,
      createdById: record.createdById,
      createdByName: record.createdBy?.name ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      renewals: record.renewals.map((renewal) =>
        this.serializeRenewal(renewal),
      ),
    };
  }

  private serializeRenewal(record: SsmaRenewalWithRelations) {
    return {
      id: record.id,
      licenseId: record.licenseId,
      status: record.status,
      protocolNumber: record.protocolNumber,
      requestedAt: record.requestedAt?.toISOString() ?? null,
      expectedAt: record.expectedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      notes: record.notes,
      attachments: this.normalizeAttachments(record.attachments),
      createdById: record.createdById,
      createdByName: record.createdBy?.name ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
