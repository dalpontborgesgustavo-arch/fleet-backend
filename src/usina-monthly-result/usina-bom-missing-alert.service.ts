import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_FORECAST_CONTEXT } from '../usina-forecasts/usina-forecasts.service';

const ALERT_RETRY_DELAY_MS = 15 * 60 * 1000;
const ALERT_LOCK_KEY = 'usina-bom-missing-alert';
const USINA_STRUCTURES_URL =
  'https://app.jrconstrucoes.net.br/estruturas-usina';

type MonthlyResultWithBom = {
  competence: string;
  bom?: {
    missingProductIds?: number[];
    missingProducts?: Array<{
      aethosProductId: number;
      productDescription?: string | null;
    }>;
  } | null;
};

type MissingBomProduct = {
  aethosProductId: number;
  productDescription: string;
  competences: string[];
};

type AlertRecipient = {
  id: string;
  name: string;
  email: string;
};

type ExistingAlert = {
  aethosProductId: number;
  status: string;
  resolvedAt: Date | null;
  updatedAt: Date;
};

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function competenceLabel(value: string) {
  const [year, month] = value.split('-');
  return month && year ? `${month}/${year}` : value;
}

export function collectMissingBomProducts(
  months: MonthlyResultWithBom[],
): MissingBomProduct[] {
  const products = new Map<number, MissingBomProduct>();

  for (const month of months) {
    const describedProducts = month.bom?.missingProducts ?? [];
    const descriptions = new Map(
      describedProducts.map((product) => [
        product.aethosProductId,
        product.productDescription?.trim() ||
          `Produto ${product.aethosProductId}`,
      ]),
    );
    const productIds = new Set([
      ...(month.bom?.missingProductIds ?? []),
      ...describedProducts.map((product) => product.aethosProductId),
    ]);

    for (const aethosProductId of productIds) {
      const existing = products.get(aethosProductId);
      if (existing) {
        if (!existing.competences.includes(month.competence)) {
          existing.competences.push(month.competence);
        }
        continue;
      }
      products.set(aethosProductId, {
        aethosProductId,
        productDescription:
          descriptions.get(aethosProductId) || `Produto ${aethosProductId}`,
        competences: [month.competence],
      });
    }
  }

  return [...products.values()]
    .map((product) => ({
      ...product,
      competences: product.competences.sort(),
    }))
    .sort((left, right) =>
      left.productDescription.localeCompare(right.productDescription, 'pt-BR'),
    );
}

export function selectFlavioQualityRecipient(
  users: AlertRecipient[],
): AlertRecipient | null {
  return (
    users.find((user) => normalizeText(user.name).includes('flavio')) ?? null
  );
}

@Injectable()
export class UsinaBomMissingAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async syncFromMonthlyResult(months: MonthlyResultWithBom[]) {
    const context = USINA_FORECAST_CONTEXT;
    const missingProducts = collectMissingBomProducts(months);
    const now = new Date();
    const scopeYear = Number(months[0]?.competence?.slice(0, 4));
    if (!Number.isInteger(scopeYear)) {
      return { sent: false, reason: 'EMPTY_RESULT_SCOPE' };
    }
    const scopeStart = new Date(Date.UTC(scopeYear, 0, 1));
    const scopeEnd = new Date(Date.UTC(scopeYear + 1, 0, 1));

    if (missingProducts.length === 0) {
      await this.prisma.usinaBomMissingAlert.updateMany({
        where: {
          companyId: context.companyId,
          unitId: context.unitId,
          resolvedAt: null,
          lastSeenCompetence: { gte: scopeStart, lt: scopeEnd },
        },
        data: { status: 'RESOLVED', resolvedAt: now },
      });
      return { sent: false, reason: 'NO_MISSING_PRODUCTS' };
    }

    const qualityUsers = await this.prisma.user.findMany({
      where: {
        active: true,
        role: { equals: 'qualidade', mode: 'insensitive' },
      },
      select: { id: true, name: true, email: true },
    });
    const recipient = selectFlavioQualityRecipient(qualityUsers);
    if (!recipient) {
      console.warn(
        '[usina-bom-alert] Usuario ativo Flavio do perfil Qualidade nao encontrado.',
      );
      return { sent: false, reason: 'RECIPIENT_NOT_FOUND' };
    }

    const missingIds = missingProducts.map(
      (product) => product.aethosProductId,
    );
    const retryBefore = new Date(now.getTime() - ALERT_RETRY_DELAY_MS);

    const claimedProducts = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${ALERT_LOCK_KEY}, 0))`,
      );

      await tx.usinaBomMissingAlert.updateMany({
        where: {
          companyId: context.companyId,
          unitId: context.unitId,
          resolvedAt: null,
          aethosProductId: { notIn: missingIds },
          lastSeenCompetence: { gte: scopeStart, lt: scopeEnd },
        },
        data: { status: 'RESOLVED', resolvedAt: now },
      });

      const existingAlerts: ExistingAlert[] =
        await tx.usinaBomMissingAlert.findMany({
          where: {
            companyId: context.companyId,
            unitId: context.unitId,
            aethosProductId: { in: missingIds },
          },
          select: {
            aethosProductId: true,
            status: true,
            resolvedAt: true,
            updatedAt: true,
          },
        });
      const existingByProductId = new Map(
        existingAlerts.map((alert) => [alert.aethosProductId, alert]),
      );
      const claimed: MissingBomProduct[] = [];

      for (const product of missingProducts) {
        const existing = existingByProductId.get(product.aethosProductId);
        const shouldSend =
          !existing ||
          existing.resolvedAt !== null ||
          ((existing.status === 'FAILED' || existing.status === 'SENDING') &&
            existing.updatedAt <= retryBefore);
        const lastSeenCompetence = new Date(
          `${product.competences.at(-1)}-01T00:00:00.000Z`,
        );

        if (!shouldSend) {
          if (existing?.status === 'SENT') {
            await tx.usinaBomMissingAlert.updateMany({
              where: {
                companyId: context.companyId,
                unitId: context.unitId,
                aethosProductId: product.aethosProductId,
              },
              data: {
                productDescription: product.productDescription,
                lastSeenAt: now,
                lastSeenCompetence,
              },
            });
          }
          continue;
        }

        await tx.usinaBomMissingAlert.upsert({
          where: {
            companyId_unitId_aethosProductId: {
              companyId: context.companyId,
              unitId: context.unitId,
              aethosProductId: product.aethosProductId,
            },
          },
          create: {
            companyId: context.companyId,
            unitId: context.unitId,
            aethosProductId: product.aethosProductId,
            productDescription: product.productDescription,
            lastSeenCompetence,
            status: 'SENDING',
            attempts: 1,
            recipientUserId: recipient.id,
            recipientEmail: recipient.email,
          },
          update: {
            productDescription: product.productDescription,
            lastSeenAt: now,
            lastSeenCompetence,
            status: 'SENDING',
            attempts: { increment: 1 },
            recipientUserId: recipient.id,
            recipientEmail: recipient.email,
            resolvedAt: null,
            lastError: null,
          },
        });
        claimed.push(product);
      }

      return claimed;
    });

    if (claimedProducts.length === 0) {
      return { sent: false, reason: 'ALREADY_NOTIFIED' };
    }

    const email = this.buildEmail(recipient, claimedProducts);
    const result = await this.emailService.sendMail({
      to: recipient.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    const claimedIds = claimedProducts.map(
      (product) => product.aethosProductId,
    );

    await this.prisma.usinaBomMissingAlert.updateMany({
      where: {
        companyId: context.companyId,
        unitId: context.unitId,
        aethosProductId: { in: claimedIds },
        status: 'SENDING',
      },
      data: result.sent
        ? { status: 'SENT', sentAt: new Date(), lastError: null }
        : { status: 'FAILED', lastError: result.error || 'Falha no envio.' },
    });

    return result.sent
      ? { sent: true, productCount: claimedProducts.length }
      : { sent: false, reason: 'SEND_FAILED', error: result.error };
  }

  private buildEmail(recipient: AlertRecipient, products: MissingBomProduct[]) {
    const firstName = recipient.name.trim().split(/\s+/)[0] || 'Flávio';
    const subject =
      products.length === 1
        ? 'Estrutura da Usina pendente na Apresentação Lucas'
        : `${products.length} estruturas da Usina pendentes na Apresentação Lucas`;
    const textItems = products
      .map(
        (product) =>
          `- ${product.productDescription} (competência(s): ${product.competences
            .map(competenceLabel)
            .join(', ')})`,
      )
      .join('\n');
    const htmlItems = products
      .map(
        (product) =>
          `<li style="margin:0 0 10px"><strong>${escapeHtml(
            product.productDescription,
          )}</strong><br><span style="color:#5f6368">Competência(s): ${escapeHtml(
            product.competences.map(competenceLabel).join(', '),
          )}</span></li>`,
      )
      .join('');

    return {
      subject,
      text: `Olá, ${firstName}.\n\nA Apresentação Lucas encontrou produção de asfalto sem a estrutura correspondente cadastrada no Sistema JR.\n\n${textItems}\n\nEntre em Estruturas da Usina e faça o cadastro: ${USINA_STRUCTURES_URL}\n\nEste aviso será enviado uma vez para cada pendência enquanto ela permanecer em aberto.`,
      html: `<div style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;color:#111827"><div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#b91c1c;color:#fff;padding:20px 24px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Sistema JR</div><h1 style="font-size:22px;margin:8px 0 0">Estrutura da Usina pendente</h1></div><div style="padding:24px"><p>Olá, <strong>${escapeHtml(firstName)}</strong>.</p><p>A Apresentação Lucas encontrou produção de asfalto sem a estrutura correspondente cadastrada no Sistema JR.</p><ul style="padding-left:22px">${htmlItems}</ul><p style="margin:24px 0"><a href="${USINA_STRUCTURES_URL}" style="background:#b91c1c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">Cadastrar em Estruturas da Usina</a></p><p style="font-size:13px;color:#6b7280;margin-bottom:0">O aviso é enviado uma vez por pendência e volta a ser enviado somente se ela for resolvida e surgir novamente.</p></div></div></div>`,
    };
  }
}
