import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

type ConsentAction = 'CONFIRMED' | 'REJECTED';

type FleetPhoto = {
  slot: string;
  label: string;
  photoUrl: string;
};

type ChecklistNcOccurrence = {
  id?: string;
  questionLabel: string;
  description: string | null;
  photos?: { url: string }[];
};

type ChecklistItemResult = {
  label: string;
  ok: boolean;
  answer?: string | null;
};

@Injectable()
export class ChecklistConsentService implements OnModuleInit, OnModuleDestroy {
  private reminderTimer?: NodeJS.Timeout;
  private reminderRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.CHECKLIST_CONSENT_REMINDER_ENABLED === 'false') {
      return;
    }

    const intervalMs =
      parsePositiveNumber(
        process.env.CHECKLIST_CONSENT_REMINDER_INTERVAL_HOURS,
        6,
      ) *
      60 *
      60 *
      1000;

    this.reminderTimer = setInterval(() => {
      void this.sendPendingReminders().catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Falha desconhecida.';
        console.warn(
          `[checklist-consent] Falha no lembrete automatico: ${message}`,
        );
      });
    }, intervalMs);
    this.reminderTimer.unref?.();

    const startupTimer = setTimeout(() => {
      void this.sendPendingReminders().catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Falha desconhecida.';
        console.warn(
          `[checklist-consent] Falha no lembrete inicial: ${message}`,
        );
      });
    }, 60_000);
    startupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
    }
  }

  async createForChecklistIfNeeded(checklistId: string) {
    const checklist = await this.prisma.checklist.findUnique({
      where: { id: checklistId },
      include: {
        items: true,
        occurrences: {
          include: { photos: true },
          orderBy: { createdAt: 'asc' },
        },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!checklist || checklist.type !== 'MONTHLY' || !checklist.vehicleId) {
      return null;
    }

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: checklist.vehicleId },
    });

    if (!vehicle || normalizeTipoFrota(vehicle.tipoFrota) !== 'veiculos') {
      return null;
    }

    const responsibleEmail = normalizeEmail(vehicle.responsibleEmail);

    if (!responsibleEmail) {
      console.warn(
        `[checklist-consent] Veiculo ${vehicle.id} sem e-mail de responsavel. Checklist ${checklist.id} ficou sem disparo.`,
      );
      return null;
    }

    const existing = await this.prisma.checklistConsent.findUnique({
      where: { checklistId: checklist.id },
    });

    if (existing) {
      return existing;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 45);

    const consent = await this.prisma.checklistConsent.create({
      data: {
        checklistId: checklist.id,
        vehicleId: vehicle.id,
        responsibleName: cleanOptional(vehicle.responsibleName),
        responsibleEmail,
        tokenHash,
        expiresAt,
        tokens: {
          create: {
            tokenHash,
            expiresAt,
            kind: 'INITIAL',
          },
        },
      },
    });

    const emailResult = await this.sendConsentEmail({
      checklist,
      vehicle,
      responsibleEmail,
      responsibleName: consent.responsibleName,
      token,
      reminder: false,
    });

    return this.prisma.checklistConsent.update({
      where: { id: consent.id },
      data: {
        sentAt: emailResult.sent ? new Date() : null,
        lastEmailError: emailResult.error,
      },
    });
  }

  async sendPendingReminders() {
    if (this.reminderRunning) {
      return { sent: 0, failed: 0, skipped: true };
    }

    this.reminderRunning = true;

    try {
      const now = new Date();
      const reminderDays = parsePositiveNumber(
        process.env.CHECKLIST_CONSENT_REMINDER_DAYS,
        2,
      );
      const maxReminders = parsePositiveNumber(
        process.env.CHECKLIST_CONSENT_REMINDER_MAX_COUNT,
        3,
      );
      const take = parsePositiveNumber(
        process.env.CHECKLIST_CONSENT_REMINDER_BATCH_SIZE,
        50,
      );
      const threshold = new Date(
        now.getTime() - reminderDays * 24 * 60 * 60 * 1000,
      );

      const consents = await this.prisma.checklistConsent.findMany({
        where: {
          status: 'PENDING',
          sentAt: { lte: threshold },
          reminderCount: { lt: maxReminders },
          OR: [
            { lastReminderAt: null },
            { lastReminderAt: { lte: threshold } },
          ],
          AND: [
            {
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          ],
        },
        include: {
          vehicle: true,
          checklist: {
            include: {
              items: true,
              occurrences: {
                include: { photos: true },
                orderBy: { createdAt: 'asc' },
              },
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: [{ lastReminderAt: 'asc' }, { sentAt: 'asc' }],
        take,
      });

      let sent = 0;
      let failed = 0;

      for (const consent of consents) {
        const responsibleEmail = normalizeEmail(consent.responsibleEmail);

        if (!responsibleEmail) {
          failed += 1;
          await this.prisma.checklistConsent.update({
            where: { id: consent.id },
            data: { lastReminderError: 'E-mail do responsavel invalido.' },
          });
          continue;
        }

        if (normalizeTipoFrota(consent.vehicle.tipoFrota) !== 'veiculos') {
          continue;
        }

        const token = randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);

        await this.prisma.checklistConsentToken.create({
          data: {
            consentId: consent.id,
            tokenHash,
            kind: 'REMINDER',
            expiresAt: consent.expiresAt,
          },
        });

        const emailResult = await this.sendConsentEmail({
          checklist: consent.checklist,
          vehicle: consent.vehicle,
          responsibleEmail,
          responsibleName: consent.responsibleName,
          token,
          reminder: true,
        });

        if (emailResult.sent) {
          sent += 1;
        } else {
          failed += 1;
          await this.prisma.checklistConsentToken.deleteMany({
            where: { tokenHash },
          });
        }

        await this.prisma.checklistConsent.update({
          where: { id: consent.id },
          data: {
            lastReminderAt: emailResult.sent
              ? new Date()
              : consent.lastReminderAt,
            reminderCount: emailResult.sent
              ? { increment: 1 }
              : consent.reminderCount,
            lastReminderError: emailResult.error,
          },
        });
      }

      if (sent || failed) {
        console.log(
          `[checklist-consent] Lembretes processados. Enviados: ${sent}. Falhas: ${failed}.`,
        );
      }

      return { sent, failed, skipped: false };
    } finally {
      this.reminderRunning = false;
    }
  }

  async findByToken(token: string) {
    const { consent } = await this.findConsentByToken(token);

    return this.toPublicConsent(consent);
  }

  async respondToConsent(
    token: string,
    action: ConsentAction,
    note?: unknown,
    ip?: string,
    userAgent?: string,
  ) {
    const { consent, tokenId } = await this.findConsentByToken(token);

    if (consent.status !== 'PENDING') {
      return this.toPublicConsent(consent);
    }

    if (consent.expiresAt && consent.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Este link de consentimento expirou.');
    }

    const updated = await this.prisma.checklistConsent.update({
      where: { id: consent.id },
      data: {
        status: action,
        consentedAt: action === 'CONFIRMED' ? new Date() : null,
        rejectedAt: action === 'REJECTED' ? new Date() : null,
        note: cleanOptional(note),
        responseIp: cleanOptional(ip),
        responseUserAgent: cleanOptional(userAgent),
      },
      include: publicConsentInclude,
    });

    if (tokenId) {
      await this.prisma.checklistConsentToken.update({
        where: { id: tokenId },
        data: { usedAt: new Date() },
      });
    }

    return this.toPublicConsent(updated);
  }

  private async findConsentByToken(token: string) {
    if (!token || token.length < 24) {
      throw new NotFoundException('Consentimento nao encontrado.');
    }

    const tokenHash = hashToken(token);
    const tokenRecord = await this.prisma.checklistConsentToken.findUnique({
      where: { tokenHash },
      include: {
        consent: {
          include: publicConsentInclude,
        },
      },
    });

    if (tokenRecord) {
      if (
        tokenRecord.expiresAt &&
        tokenRecord.expiresAt.getTime() < Date.now()
      ) {
        throw new NotFoundException('Consentimento nao encontrado.');
      }

      return { consent: tokenRecord.consent, tokenId: tokenRecord.id };
    }

    const legacyConsent = await this.prisma.checklistConsent.findUnique({
      where: { tokenHash },
      include: publicConsentInclude,
    });

    if (!legacyConsent) {
      throw new NotFoundException('Consentimento nao encontrado.');
    }

    return { consent: legacyConsent, tokenId: null };
  }

  private toPublicConsent(consent: ConsentWithPublicInclude) {
    const fleetPhotos = parseFleetPhotos(consent.checklist.fleetPhotos);
    const representativePhoto =
      resolveAssetUrl(consent.checklist.photoUrl) ||
      fleetPhotos[0]?.photoUrl ||
      null;

    return {
      id: consent.id,
      status: consent.status,
      responsibleName: consent.responsibleName,
      responsibleEmail: consent.responsibleEmail,
      sentAt: consent.sentAt?.toISOString() ?? null,
      lastReminderAt: consent.lastReminderAt?.toISOString() ?? null,
      reminderCount: consent.reminderCount,
      consentedAt: consent.consentedAt?.toISOString() ?? null,
      rejectedAt: consent.rejectedAt?.toISOString() ?? null,
      expiresAt: consent.expiresAt?.toISOString() ?? null,
      expired:
        consent.status === 'PENDING' &&
        !!consent.expiresAt &&
        consent.expiresAt.getTime() < Date.now(),
      note: consent.note,
      vehicle: {
        id: consent.vehicle.id,
        name: consent.vehicle.name,
        plate: consent.vehicle.plate,
        fleet: consent.vehicle.fleet,
        model: consent.vehicle.model,
        tipoFrota: consent.vehicle.tipoFrota,
        responsibleName: consent.vehicle.responsibleName,
        responsibleEmail: consent.vehicle.responsibleEmail,
      },
      checklist: {
        id: consent.checklist.id,
        title: consent.checklist.title,
        month: consent.checklist.month,
        year: consent.checklist.year,
        createdAt: consent.checklist.createdAt.toISOString(),
        createdBy: consent.checklist.user,
        photoUrl: representativePhoto,
        fleetPhotos,
        occurrences: consent.checklist.occurrences.map((occurrence) => ({
          id: occurrence.id,
          questionId: occurrence.questionId,
          questionLabel: occurrence.questionLabel,
          description: occurrence.description,
          photos: occurrence.photos
            .map((photo) => resolveAssetUrl(photo.url))
            .filter((url): url is string => !!url)
            .map((url) => ({ url })),
        })),
        items: consent.checklist.items.map((item) => ({
          id: item.id,
          label: item.label,
          ok: item.ok,
          answer: item.answer,
        })),
      },
    };
  }

  private sendConsentEmail(input: {
    checklist: {
      title: string;
      createdAt: Date;
      items: ChecklistItemResult[];
      occurrences?: ChecklistNcOccurrence[];
      fleetPhotos: unknown;
    };
    vehicle: {
      name: string | null;
      plate: string;
      fleet: string | null;
      model: string | null;
    };
    responsibleEmail: string;
    responsibleName: string | null;
    token: string;
    reminder: boolean;
  }) {
    const link = buildConsentLink(input.token);
    const vehicleLabel = input.vehicle.fleet || input.vehicle.plate;

    return this.emailService.sendMail({
      to: input.responsibleEmail,
      subject: input.reminder
        ? `Lembrete: confirme o Checklist Mensal - Frota ${vehicleLabel}`
        : `Confirme o Checklist Mensal - Frota ${vehicleLabel}`,
      html: buildConsentEmailHtml({
        checklist: input.checklist,
        vehicle: input.vehicle,
        responsibleName: input.responsibleName,
        link,
        reminder: input.reminder,
      }),
      text: buildConsentEmailText({
        checklist: input.checklist,
        vehicle: input.vehicle,
        responsibleName: input.responsibleName,
        link,
        reminder: input.reminder,
      }),
    });
  }
}

const publicConsentInclude = {
  vehicle: true,
  checklist: {
    include: {
      items: true,
      occurrences: {
        include: { photos: true },
        orderBy: { createdAt: 'asc' },
      },
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

type ConsentWithPublicInclude = Awaited<
  Prisma.ChecklistConsentGetPayload<{ include: typeof publicConsentInclude }>
>;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeTipoFrota(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() || '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function cleanOptional(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildConsentLink(token: string) {
  const appUrl =
    process.env.APP_PUBLIC_URL?.trim() || 'https://app.jrconstrucoes.net.br';

  return `${appUrl.replace(/\/$/, '')}/checklist-consentimento/${token}`;
}

function getApiPublicUrl() {
  return (
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim() ||
    'https://api.jrconstrucoes.net.br'
  ).replace(/\/$/, '');
}

function resolveAssetUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(url)) {
    return url;
  }

  return `${getApiPublicUrl()}${url.startsWith('/') ? url : `/${url}`}`;
}

function parseFleetPhotos(value: unknown): FleetPhoto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<FleetPhoto[]>((entries, item) => {
    if (!item || typeof item !== 'object') {
      return entries;
    }

    const entry = item as Record<string, unknown>;
    const photoUrl = resolveAssetUrl(
      typeof entry.photoUrl === 'string' ? entry.photoUrl : null,
    );

    if (!photoUrl) {
      return entries;
    }

    entries.push({
      slot: typeof entry.slot === 'string' ? entry.slot : '',
      label: typeof entry.label === 'string' ? entry.label : 'Foto da frota',
      photoUrl,
    });

    return entries;
  }, []);
}

function buildConsentEmailHtml(input: {
  checklist: {
    title: string;
    createdAt: Date;
    items: ChecklistItemResult[];
    occurrences?: ChecklistNcOccurrence[];
    fleetPhotos: unknown;
  };
  vehicle: {
    name: string | null;
    plate: string;
    fleet: string | null;
    model: string | null;
  };
  responsibleName: string | null;
  link: string;
  reminder?: boolean;
}) {
  const fleetPhotos = parseFleetPhotos(input.checklist.fleetPhotos);
  const ncDetails = buildNcDetails(
    input.checklist.items,
    input.checklist.occurrences,
  );
  const items = input.checklist.items
    .map((item) => {
      const answer = getChecklistAnswer(item);
      const color =
        answer === 'NC' ? '#991b1b' : answer === 'NA' ? '#475569' : '#166534';

      return `<tr><td>${escapeHtml(item.label)}</td><td style="font-weight:700;color:${color}">${getChecklistAnswerLabel(answer)}</td></tr>`;
    })
    .join('');
  const photos = fleetPhotos
    .map(
      (photo) =>
        `<div style="display:inline-block;width:145px;margin:0 8px 10px 0;vertical-align:top"><img src="${escapeHtml(photo.photoUrl)}" alt="" style="width:145px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #ddd"><div style="font-size:12px;color:#555;margin-top:4px">${escapeHtml(photo.label)}</div></div>`,
    )
    .join('');
  const ncCards = ncDetails
    .map((nc) => {
      const problemPhotos = nc.photos
        .map(
          (photoUrl) =>
            `<img src="${escapeHtml(photoUrl)}" alt="" style="width:168px;height:112px;object-fit:cover;border-radius:8px;border:1px solid #ddd;margin:8px 8px 0 0">`,
        )
        .join('');

      return `
        <div style="border:1px solid #fecaca;background:#fff7f7;border-radius:10px;padding:12px;margin:0 0 12px">
          <div style="font-size:12px;font-weight:800;color:#991b1b;text-transform:uppercase">NC registrada</div>
          <div style="font-size:15px;font-weight:800;margin-top:4px">${escapeHtml(nc.label)}</div>
          <div style="font-size:13px;color:#374151;margin-top:8px;line-height:1.45">
            <strong>Descricao:</strong> ${escapeHtml(nc.description || 'Sem descricao registrada.')}
          </div>
          ${
            problemPhotos
              ? `<div style="margin-top:6px">${problemPhotos}</div>`
              : '<div style="font-size:12px;color:#991b1b;margin-top:8px;font-weight:700">Foto do problema nao encontrada no registro.</div>'
          }
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;color:#111827">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#b91c1c;color:#fff;padding:18px 22px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase">JR Construcoes</div>
          <h1 style="margin:6px 0 0;font-size:22px">Consentimento do Checklist Mensal</h1>
        </div>
        <div style="padding:22px">
          <p>Ola${input.responsibleName ? `, ${escapeHtml(input.responsibleName)}` : ''}.</p>
          <p>${input.reminder ? 'Este e um lembrete de consentimento pendente.' : 'Foi executado um checklist mensal para o veiculo abaixo.'} Confira as respostas e as fotos antes de confirmar.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0">
            <strong>${escapeHtml(input.vehicle.name || input.vehicle.fleet || input.vehicle.plate)}</strong><br>
            Frota: ${escapeHtml(input.vehicle.fleet || '-')}<br>
            Placa: ${escapeHtml(input.vehicle.plate || '-')}<br>
            Modelo: ${escapeHtml(input.vehicle.model || '-')}<br>
            Data: ${escapeHtml(formatDate(input.checklist.createdAt))}
          </div>
          <p>
            <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">
              Abrir e confirmar checklist
            </a>
          </p>
          ${photos ? `<h2 style="font-size:16px;margin-top:24px">Fotos da frota</h2>${photos}` : ''}
          ${ncCards ? `<h2 style="font-size:16px;margin-top:24px">Nao conformidades registradas</h2>${ncCards}` : ''}
          <h2 style="font-size:16px;margin-top:24px">Itens do checklist</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tbody>${items}</tbody>
          </table>
          <p style="margin-top:20px;color:#6b7280;font-size:12px">Se o botao nao abrir, copie este link: ${escapeHtml(input.link)}</p>
        </div>
      </div>
    </div>
  `;
}

function buildConsentEmailText(input: {
  checklist: {
    title: string;
    createdAt: Date;
    items: ChecklistItemResult[];
    occurrences?: ChecklistNcOccurrence[];
  };
  vehicle: {
    name: string | null;
    plate: string;
    fleet: string | null;
    model: string | null;
  };
  responsibleName: string | null;
  link: string;
  reminder?: boolean;
}) {
  const vehicleLabel =
    input.vehicle.name || input.vehicle.fleet || input.vehicle.plate;
  const items = input.checklist.items
    .map(
      (item) =>
        `- ${item.label}: ${getChecklistAnswerLabel(getChecklistAnswer(item))}`,
    )
    .join('\n');
  const ncDetails = buildNcDetails(
    input.checklist.items,
    input.checklist.occurrences,
  );
  const ncLines = ncDetails.length
    ? [
        '',
        'Nao conformidades registradas:',
        ...ncDetails.flatMap((nc) => [
          `- ${nc.label}`,
          `  Descricao: ${nc.description || 'Sem descricao registrada.'}`,
          ...(nc.photos.length
            ? [`  Fotos: ${nc.photos.join(', ')}`]
            : ['  Fotos: nenhuma foto encontrada no registro.']),
        ]),
      ]
    : [];

  return [
    `Ola${input.responsibleName ? `, ${input.responsibleName}` : ''}.`,
    input.reminder ? 'Este e um lembrete de consentimento pendente.' : '',
    `Checklist mensal executado para ${vehicleLabel}.`,
    `Frota: ${input.vehicle.fleet || '-'}`,
    `Placa: ${input.vehicle.plate || '-'}`,
    `Modelo: ${input.vehicle.model || '-'}`,
    `Data: ${formatDate(input.checklist.createdAt)}`,
    '',
    'Itens:',
    items,
    ...ncLines,
    '',
    `Abrir e confirmar: ${input.link}`,
  ].join('\n');
}

function buildNcDetails(
  items: ChecklistItemResult[],
  occurrences: ChecklistNcOccurrence[] | undefined,
) {
  const occurrenceBuckets = new Map<string, ChecklistNcOccurrence[]>();

  for (const occurrence of occurrences ?? []) {
    const key = normalizeQuestionLabel(occurrence.questionLabel);

    if (!key) {
      continue;
    }

    const bucket = occurrenceBuckets.get(key) ?? [];
    bucket.push(occurrence);
    occurrenceBuckets.set(key, bucket);
  }

  return items
    .filter((item) => getChecklistAnswer(item) === 'NC')
    .map((item) => {
      const key = normalizeQuestionLabel(item.label);
      const occurrence = key ? occurrenceBuckets.get(key)?.shift() : undefined;

      return {
        label: item.label,
        description: cleanOptional(occurrence?.description) || '',
        photos: (occurrence?.photos ?? [])
          .map((photo) => resolveAssetUrl(photo.url))
          .filter((url): url is string => !!url),
      };
    });
}

function getChecklistAnswer(item: ChecklistItemResult): 'OK' | 'NC' | 'NA' {
  if (item.answer === 'NA') return 'NA';
  if (item.answer === 'NC') return 'NC';
  if (item.answer === 'OK') return 'OK';
  return item.ok ? 'OK' : 'NC';
}

function getChecklistAnswerLabel(answer: 'OK' | 'NC' | 'NA') {
  if (answer === 'NC') return 'Nao Conforme';
  if (answer === 'NA') return 'NA - Nao Aplicavel';
  return 'OK';
}

function normalizeQuestionLabel(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
