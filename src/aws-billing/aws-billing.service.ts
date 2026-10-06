import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
  type GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';
import {
  GetInvoicePDFCommand,
  InvoicingClient,
  ListInvoiceSummariesCommand,
  type InvoiceSummary,
} from '@aws-sdk/client-invoicing';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

export const AWS_BILLING_OWNER_EMAIL = 'dalpontborgesgustavo@gmail.com';
export const AWS_INVOICE_EMAIL_RECIPIENTS = [
  'adm03@jrmc.com.br',
  'dalpontborgesgustavo@gmail.com',
  'adm05@jrmc.com.br',
] as const;

const AWS_REGION = 'us-east-1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const INVOICE_EMAIL_STARTUP_DELAY_MS = 30 * 1000;
const INVOICE_EMAIL_DEFAULT_INTERVAL_HOURS = 1;
const INVOICE_EMAIL_STALE_CLAIM_MS = 15 * 60 * 1000;
const DEFAULT_MONTHS = 12;
const MIN_MONTHS = 3;
const MAX_MONTHS = 24;

interface CacheEntry {
  key: string;
  expiresAt: number;
  value: unknown;
}

interface NormalizedInvoice {
  invoiceId: string;
  billingPeriod: string;
  issuedAt: string | null;
  dueAt: string | null;
  invoiceType: string | null;
  billType: string | null;
  entity: string | null;
  taxAuthorityStatus: string | null;
  einvoiceDeliveryStatus: string | null;
  total: number;
  subtotal: number;
  tax: number;
  currency: string;
  paymentStatus:
    | 'PAID'
    | 'AWAITING_DUE_DATE'
    | 'NOT_CONFIRMED_BY_API'
    | 'NO_DUE_DATE';
  paymentStatusLabel: string;
  relatedDocumentIds: string[];
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1),
  );
}

function addUtcDays(date: Date, amount: number) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + amount,
    ),
  );
}

function numeric(value?: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(value);
}

function formatBillingPeriod(value: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function metricAmount(
  result:
    | NonNullable<GetCostAndUsageCommandOutput['ResultsByTime']>[number]
    | undefined,
) {
  return numeric(result?.Total?.UnblendedCost?.Amount);
}

function groupedAmount(
  output: GetCostAndUsageCommandOutput,
  keyLabel: (keys: string[]) => string,
) {
  const totals = new Map<string, number>();

  for (const period of output.ResultsByTime ?? []) {
    for (const group of period.Groups ?? []) {
      const label = keyLabel(group.Keys ?? []) || 'Não identificado';
      const amount = numeric(group.Metrics?.UnblendedCost?.Amount);
      totals.set(label, (totals.get(label) ?? 0) + amount);
    }
  }

  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function isAwsBillingOwner(email?: string | null) {
  return (email || '').trim().toLowerCase() === AWS_BILLING_OWNER_EMAIL;
}

function invoiceCurrency(invoice: InvoiceSummary) {
  return (
    invoice.PaymentCurrencyAmount ??
    invoice.TaxCurrencyAmount ??
    invoice.BaseCurrencyAmount
  );
}

function billingPeriodKey(invoice: InvoiceSummary) {
  const year = invoice.BillingPeriod?.Year;
  const month = invoice.BillingPeriod?.Month;
  if (!year || !month) return 'Sem competência';
  return `${year}-${String(month).padStart(2, '0')}`;
}

function invoiceGroupKey(invoice: InvoiceSummary) {
  return (
    invoice.CommercialInvoiceId ||
    invoice.OriginalInvoiceId ||
    invoice.InvoiceId ||
    `${billingPeriodKey(invoice)}:${invoice.Entity?.InvoicingEntity || ''}`
  );
}

function choosePrimaryInvoice(invoices: InvoiceSummary[]) {
  return [...invoices].sort((a, b) => {
    const score = (invoice: InvoiceSummary) =>
      (invoice.DueDate ? 8 : 0) +
      (invoice.PaymentCurrencyAmount ? 4 : 0) +
      (invoice.InvoiceId === invoiceGroupKey(invoice) ? 2 : 0) +
      (invoice.InvoiceType === 'INVOICE' ? 1 : 0);
    return score(b) - score(a);
  })[0];
}

function isEstimateDocument(invoice: InvoiceSummary) {
  return (
    /^estimate-/i.test(invoice.InvoiceId || '') ||
    /estimate/i.test(invoice.BillType || '')
  );
}

export function normalizeInvoices(
  summaries: InvoiceSummary[],
  now = new Date(),
): NormalizedInvoice[] {
  const receipts = new Set(
    summaries
      .filter((summary) => summary.InvoiceType === 'PAYMENT_RECEIPT')
      .flatMap((summary) =>
        [summary.OriginalInvoiceId, summary.CommercialInvoiceId].filter(
          (value): value is string => Boolean(value),
        ),
      ),
  );
  const groups = new Map<string, InvoiceSummary[]>();

  for (const summary of summaries) {
    if (
      summary.InvoiceType === 'PAYMENT_RECEIPT' ||
      isEstimateDocument(summary)
    ) {
      continue;
    }
    const key = invoiceGroupKey(summary);
    groups.set(key, [...(groups.get(key) ?? []), summary]);
  }

  return [...groups.entries()]
    .map(([groupId, documents]) => {
      const primary = choosePrimaryInvoice(documents);
      const amount = invoiceCurrency(primary);
      const dueAt = primary.DueDate?.toISOString() ?? null;
      const isPaid =
        receipts.has(groupId) || receipts.has(primary.InvoiceId || '');
      const isAwaitingDueDate =
        !isPaid &&
        primary.DueDate &&
        primary.DueDate.getTime() >= now.getTime();
      const paymentStatus = isPaid
        ? 'PAID'
        : isAwaitingDueDate
          ? 'AWAITING_DUE_DATE'
          : primary.DueDate
            ? 'NOT_CONFIRMED_BY_API'
            : 'NO_DUE_DATE';
      const paymentStatusLabel = isPaid
        ? 'Pago (comprovante AWS)'
        : isAwaitingDueDate
          ? 'Aguardando vencimento'
          : primary.DueDate
            ? 'Consultar confirmação na AWS'
            : 'Sem vencimento informado';

      return {
        invoiceId: primary.InvoiceId || groupId,
        billingPeriod: billingPeriodKey(primary),
        issuedAt: primary.IssuedDate?.toISOString() ?? null,
        dueAt,
        invoiceType: primary.InvoiceType ?? null,
        billType: primary.BillType ?? null,
        entity: primary.Entity?.InvoicingEntity ?? null,
        taxAuthorityStatus: primary.TaxAuthorityStatus ?? null,
        einvoiceDeliveryStatus: primary.EinvoiceDeliveryStatus ?? null,
        total: numeric(amount?.TotalAmount),
        subtotal: numeric(amount?.TotalAmountBeforeTax),
        tax: numeric(amount?.AmountBreakdown?.Taxes?.TotalAmount),
        currency: amount?.CurrencyCode || 'USD',
        paymentStatus,
        paymentStatusLabel,
        relatedDocumentIds: documents
          .map((document) => document.InvoiceId)
          .filter((value): value is string => Boolean(value)),
      } satisfies NormalizedInvoice;
    })
    .sort((a, b) => b.billingPeriod.localeCompare(a.billingPeriod));
}

@Injectable()
export class AwsBillingService implements OnModuleInit, OnModuleDestroy {
  private readonly costExplorer = new CostExplorerClient({
    region: AWS_REGION,
  });
  private readonly invoicing = new InvoicingClient({ region: AWS_REGION });
  private readonly sts = new STSClient({ region: AWS_REGION });
  private cache: CacheEntry | null = null;
  private invoiceEmailTimer?: NodeJS.Timeout;
  private invoiceEmailStartupTimer?: NodeJS.Timeout;
  private invoiceEmailRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.AWS_INVOICE_EMAIL_ENABLED === 'false') return;

    const intervalMs =
      positiveNumber(
        process.env.AWS_INVOICE_EMAIL_INTERVAL_HOURS,
        INVOICE_EMAIL_DEFAULT_INTERVAL_HOURS,
      ) *
      60 *
      60 *
      1000;

    this.invoiceEmailTimer = setInterval(() => {
      void this.sendNewInvoiceEmails().catch((error) => {
        console.warn(
          `[aws-invoice-email] Falha na rotina automatica: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      });
    }, intervalMs);
    this.invoiceEmailTimer.unref?.();

    this.invoiceEmailStartupTimer = setTimeout(() => {
      void this.sendNewInvoiceEmails().catch((error) => {
        console.warn(
          `[aws-invoice-email] Falha na verificacao inicial: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      });
    }, INVOICE_EMAIL_STARTUP_DELAY_MS);
    this.invoiceEmailStartupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.invoiceEmailTimer) clearInterval(this.invoiceEmailTimer);
    if (this.invoiceEmailStartupTimer) {
      clearTimeout(this.invoiceEmailStartupTimer);
    }
  }

  assertOwner(email?: string | null) {
    if (!isAwsBillingOwner(email)) {
      throw new ForbiddenException(
        'Este painel financeiro AWS é exclusivo do proprietário autorizado.',
      );
    }
  }

  async dashboard(monthsInput?: string) {
    const parsedMonths = Number(monthsInput ?? DEFAULT_MONTHS);
    const months = Math.min(
      MAX_MONTHS,
      Math.max(
        MIN_MONTHS,
        Number.isFinite(parsedMonths)
          ? Math.trunc(parsedMonths)
          : DEFAULT_MONTHS,
      ),
    );
    const cacheKey = `dashboard:${months}`;

    if (this.cache?.key === cacheKey && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    try {
      const value = await this.buildDashboard(months);
      this.cache = {
        key: cacheKey,
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
      };
      return value;
    } catch (error) {
      console.error('[AWS Billing] Falha ao consultar dados oficiais:', error);
      throw new ServiceUnavailableException(
        'Não foi possível consultar a AWS agora. Tente novamente em alguns instantes.',
      );
    }
  }

  private async buildDashboard(months: number) {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const tomorrow = addUtcDays(today, 1);
    const monthStart = firstDayOfMonth(today);
    const historyStart = addUtcMonths(monthStart, -(months - 1));
    const nextMonthStart = addUtcMonths(monthStart, 1);
    const invoiceStart = addUtcMonths(monthStart, -(Math.max(months, 12) - 1));

    const costBase = {
      Metrics: ['UnblendedCost'],
      TimePeriod: { Start: isoDate(monthStart), End: isoDate(tomorrow) },
    };

    const [identity, monthly, daily, services, regions, invoiceSummaries] =
      await Promise.all([
        this.sts.send(new GetCallerIdentityCommand({})),
        this.costExplorer.send(
          new GetCostAndUsageCommand({
            Metrics: ['UnblendedCost'],
            Granularity: 'MONTHLY',
            TimePeriod: {
              Start: isoDate(historyStart),
              End: isoDate(tomorrow),
            },
          }),
        ),
        this.costExplorer.send(
          new GetCostAndUsageCommand({
            ...costBase,
            Granularity: 'DAILY',
          }),
        ),
        this.costExplorer.send(
          new GetCostAndUsageCommand({
            ...costBase,
            Granularity: 'MONTHLY',
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          }),
        ),
        this.costExplorer.send(
          new GetCostAndUsageCommand({
            ...costBase,
            Granularity: 'MONTHLY',
            GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
          }),
        ),
        this.listInvoices(invoiceStart, tomorrow),
      ]);

    const forecast = await this.costExplorer
      .send(
        new GetCostForecastCommand({
          Granularity: 'MONTHLY',
          Metric: 'UNBLENDED_COST',
          TimePeriod: {
            Start: isoDate(today),
            End: isoDate(nextMonthStart),
          },
        }),
      )
      .catch((error) => {
        console.warn('[AWS Billing] Previsão indisponível:', error?.name);
        return null;
      });

    const invoices = normalizeInvoices(invoiceSummaries, now);
    const latestInvoice = invoices[0] ?? null;
    const currentCost = metricAmount(monthly.ResultsByTime?.at(-1));
    const estimatedMonthTotal = numeric(forecast?.Total?.Amount) || currentCost;

    return {
      generatedAt: new Date().toISOString(),
      source: 'AWS Cost Explorer + AWS Invoicing',
      cacheSeconds: CACHE_TTL_MS / 1000,
      account: {
        label: 'Conta AWS JR',
        maskedId: identity.Account
          ? `•••• ${identity.Account.slice(-4)}`
          : 'Conta autenticada',
      },
      summary: {
        currentMonthActual: currentCost,
        currentMonthForecast: estimatedMonthTotal,
        currency: 'USD',
        latestInvoice: latestInvoice
          ? {
              amount: latestInvoice.total,
              currency: latestInvoice.currency,
              billingPeriod: latestInvoice.billingPeriod,
              dueAt: latestInvoice.dueAt,
              paymentStatus: latestInvoice.paymentStatus,
              paymentStatusLabel: latestInvoice.paymentStatusLabel,
              taxAuthorityStatus: latestInvoice.taxAuthorityStatus,
            }
          : null,
      },
      monthly: (monthly.ResultsByTime ?? []).map((result) => ({
        period: result.TimePeriod?.Start || '',
        amount: metricAmount(result),
        estimated: result.Estimated === true,
      })),
      daily: (daily.ResultsByTime ?? []).map((result) => ({
        date: result.TimePeriod?.Start || '',
        amount: metricAmount(result),
        estimated: result.Estimated === true,
      })),
      services: groupedAmount(services, (keys) => keys[0] || ''),
      regions: groupedAmount(regions, (keys) => keys[0] || 'Global'),
      invoices,
      paymentNotice: {
        level: 'INFO',
        text: 'O status fiscal vem da AWS Invoicing. “Pago” só é exibido quando a AWS fornece comprovante; nos demais casos, confirme na central oficial de pagamentos.',
        awsPaymentsUrl: 'https://console.aws.amazon.com/billing/home#/payments',
      },
    };
  }

  private async listInvoices(start: Date, end: Date) {
    const account = await this.sts.send(new GetCallerIdentityCommand({}));
    if (!account.Account) throw new Error('Conta AWS não identificada.');

    const summaries: InvoiceSummary[] = [];
    let nextToken: string | undefined;

    do {
      const result = await this.invoicing.send(
        new ListInvoiceSummariesCommand({
          Selector: { ResourceType: 'ACCOUNT_ID', Value: account.Account },
          Filter: {
            TimeInterval: { StartDate: start, EndDate: end },
            ReceiverRole: 'BUYER',
          },
          MaxResults: 100,
          NextToken: nextToken,
        }),
      );
      summaries.push(...(result.InvoiceSummaries ?? []));
      nextToken = result.NextToken;
    } while (nextToken);

    return summaries;
  }

  async sendNewInvoiceEmails(reference = new Date()) {
    if (this.invoiceEmailRunning) {
      return { processed: 0, sent: 0, failed: 0, alreadyRunning: true };
    }

    this.invoiceEmailRunning = true;
    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      const monthStart = firstDayOfMonth(reference);
      const start = addUtcMonths(monthStart, -12);
      const end = addUtcDays(
        new Date(
          Date.UTC(
            reference.getUTCFullYear(),
            reference.getUTCMonth(),
            reference.getUTCDate(),
          ),
        ),
        1,
      );
      const invoices = normalizeInvoices(
        await this.listInvoices(start, end),
        reference,
      ).filter((invoice) => Boolean(invoice.issuedAt));
      const existing = await this.prisma.awsInvoiceEmailNotification.findMany({
        select: { invoiceId: true, status: true },
      });
      const existingById = new Map(
        existing.map((notification) => [
          notification.invoiceId,
          notification.status,
        ]),
      );

      if (!existing.length && invoices.length) {
        const bootstrapInvoice = invoices.find((invoice) => invoice.total > 0);
        const baselineInvoices = invoices.filter(
          (invoice) => invoice.invoiceId !== bootstrapInvoice?.invoiceId,
        );

        if (baselineInvoices.length) {
          await this.prisma.awsInvoiceEmailNotification.createMany({
            data: baselineInvoices.map((invoice) => ({
              invoiceId: invoice.invoiceId,
              billingPeriod: invoice.billingPeriod,
              recipients: [...AWS_INVOICE_EMAIL_RECIPIENTS],
              amount: invoice.total,
              currency: invoice.currency,
              issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
              status: 'BASELINE',
              sentAt: new Date(),
            })),
            skipDuplicates: true,
          });
        }

        if (bootstrapInvoice) {
          processed += 1;
          const result = await this.deliverInvoiceEmail(bootstrapInvoice, true);
          if (result.sent) sent += 1;
          else failed += 1;
        }
      } else {
        for (const invoice of invoices) {
          const status = existingById.get(invoice.invoiceId);
          if (status === 'SENT' || status === 'BASELINE') continue;

          processed += 1;
          const result = await this.deliverInvoiceEmail(invoice, false);
          if (result.sent) sent += 1;
          else if (!result.skipped) failed += 1;
        }
      }

      if (processed) {
        console.log(
          `[aws-invoice-email] processadas=${processed} enviadas=${sent} falhas=${failed}`,
        );
      }

      return { processed, sent, failed, alreadyRunning: false };
    } finally {
      this.invoiceEmailRunning = false;
    }
  }

  private async deliverInvoiceEmail(
    invoice: NormalizedInvoice,
    isBootstrapTest: boolean,
  ) {
    const existing = await this.prisma.awsInvoiceEmailNotification.findUnique({
      where: { invoiceId: invoice.invoiceId },
    });
    if (existing?.status === 'SENT' || existing?.status === 'BASELINE') {
      return { sent: false, skipped: true, error: null };
    }
    if (
      existing?.status === 'SENDING' &&
      existing.updatedAt.getTime() > Date.now() - INVOICE_EMAIL_STALE_CLAIM_MS
    ) {
      return { sent: false, skipped: true, error: null };
    }

    await this.prisma.awsInvoiceEmailNotification.upsert({
      where: { invoiceId: invoice.invoiceId },
      create: {
        invoiceId: invoice.invoiceId,
        billingPeriod: invoice.billingPeriod,
        recipients: [...AWS_INVOICE_EMAIL_RECIPIENTS],
        amount: invoice.total,
        currency: invoice.currency,
        issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
        status: 'SENDING',
        attempts: 1,
      },
      update: {
        billingPeriod: invoice.billingPeriod,
        recipients: [...AWS_INVOICE_EMAIL_RECIPIENTS],
        amount: invoice.total,
        currency: invoice.currency,
        issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
        status: 'SENDING',
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    try {
      const document = await this.downloadInvoice(invoice.invoiceId);
      const competence = formatBillingPeriod(invoice.billingPeriod);
      const amount = formatMoney(invoice.total, invoice.currency);
      const testPrefix = isBootstrapTest ? '[TESTE] ' : '';
      const subject = `${testPrefix}Nova fatura AWS emitida - ${competence} - ${amount}`;
      const dashboardUrl = 'https://app.jrconstrucoes.net.br/custos-aws';
      const text = [
        `${isBootstrapTest ? 'Teste de envio da fatura AWS.' : 'Uma nova fatura AWS foi emitida.'}`,
        `Competencia: ${competence}`,
        `Valor total: ${amount}`,
        `Fatura: ${invoice.invoiceId}`,
        `Status do pagamento: ${invoice.paymentStatusLabel}`,
        `Painel: ${dashboardUrl}`,
        '',
        'O PDF oficial da AWS segue anexado.',
      ].join('\n');
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:680px;margin:auto">
          <div style="background:#b91c1c;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
            <div style="font-size:13px;opacity:.9">SISTEMA JR · CUSTOS AWS</div>
            <h1 style="font-size:22px;margin:8px 0 0">${isBootstrapTest ? 'Teste de envio concluído' : 'Nova fatura AWS emitida'}</h1>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 12px 12px">
            <p>Uma fatura oficial da AWS está disponível e segue anexada a este e-mail.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0">
              <tr><td style="padding:10px;background:#f9fafb"><strong>Competência</strong></td><td style="padding:10px;background:#f9fafb">${escapeHtml(competence)}</td></tr>
              <tr><td style="padding:10px"><strong>Valor total</strong></td><td style="padding:10px">${escapeHtml(amount)}</td></tr>
              <tr><td style="padding:10px;background:#f9fafb"><strong>Fatura</strong></td><td style="padding:10px;background:#f9fafb">${escapeHtml(invoice.invoiceId)}</td></tr>
              <tr><td style="padding:10px"><strong>Pagamento</strong></td><td style="padding:10px">${escapeHtml(invoice.paymentStatusLabel)}</td></tr>
            </table>
            <p style="margin:24px 0"><a href="${dashboardUrl}" style="background:#b91c1c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Abrir painel de custos AWS</a></p>
            <p style="font-size:12px;color:#6b7280">O status “Pago” somente é informado quando confirmado pela AWS. O documento PDF oficial está anexado.</p>
          </div>
        </div>`;
      const result = await this.emailService.sendMail({
        to: AWS_INVOICE_EMAIL_RECIPIENTS.join(', '),
        subject,
        html,
        text,
        attachments: [
          {
            filename: document.fileName,
            content: document.buffer,
            contentType: 'application/pdf',
          },
        ],
      });

      if (!result.sent) {
        throw new Error(result.error || 'Falha ao enviar a fatura por e-mail.');
      }

      await this.prisma.awsInvoiceEmailNotification.update({
        where: { invoiceId: invoice.invoiceId },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      return { sent: true, skipped: false, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida no envio.';
      await this.prisma.awsInvoiceEmailNotification.update({
        where: { invoiceId: invoice.invoiceId },
        data: { status: 'FAILED', sentAt: null, lastError: message.slice(0, 1000) },
      });
      console.warn(
        `[aws-invoice-email] Falha ao enviar ${invoice.invoiceId}: ${message}`,
      );
      return { sent: false, skipped: false, error: message };
    }
  }

  async downloadInvoice(invoiceIdInput: string) {
    const invoiceId = decodeURIComponent(invoiceIdInput || '').trim();
    if (!invoiceId || invoiceId.length > 120) {
      throw new ForbiddenException('Fatura inválida.');
    }

    try {
      const result = await this.invoicing.send(
        new GetInvoicePDFCommand({ InvoiceId: invoiceId }),
      );
      const url = result.InvoicePDF?.DocumentUrl;
      if (!url) throw new Error('Documento sem URL de download.');

      const fileResponse = await fetch(url);
      if (!fileResponse.ok) {
        throw new Error(`Falha ao baixar documento (${fileResponse.status}).`);
      }

      return {
        fileName: `fatura-aws-${invoiceId.replace(/[^a-zA-Z0-9._-]/g, '-')}.pdf`,
        buffer: Buffer.from(await fileResponse.arrayBuffer()),
      };
    } catch (error) {
      console.error('[AWS Billing] Falha ao baixar fatura:', error);
      throw new ServiceUnavailableException(
        'Não foi possível baixar esta fatura na AWS agora.',
      );
    }
  }
}
