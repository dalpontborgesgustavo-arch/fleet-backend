import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async registerPushToken(
    userId: string | undefined,
    dto: RegisterPushTokenDto,
  ) {
    if (!userId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const token = (dto.token || '').trim();
    if (!isExpoPushToken(token)) {
      throw new BadRequestException('Token de notificacao invalido');
    }

    await this.prisma.userPushToken.upsert({
      where: { token },
      create: {
        token,
        userId,
        platform: dto.platform?.trim() || null,
        deviceId: dto.deviceId?.trim() || null,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform: dto.platform?.trim() || null,
        deviceId: dto.deviceId?.trim() || null,
        lastSeenAt: new Date(),
      },
    });

    console.log(
      `[notifications] push token registered for user ${userId} (${dto.platform?.trim() || 'unknown'})`,
    );

    return { ok: true };
  }

  async notifyUsers(userIds: string[], payload: PushPayload) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) return;

    const tokens = await this.prisma.userPushToken.findMany({
      where: {
        userId: { in: uniqueUserIds },
      },
      select: {
        token: true,
      },
    });

    await this.sendExpoMessages(
      tokens.map((item) => item.token),
      payload,
    );
  }

  async notifyRoles(roles: string[], payload: PushPayload) {
    const normalizedRoles = roles.map((role) => role.toLowerCase());
    if (normalizedRoles.length === 0) return;

    const tokens = await this.prisma.userPushToken.findMany({
      where: {
        user: {
          role: {
            in: normalizedRoles,
          },
        },
      },
      select: {
        token: true,
      },
    });

    await this.sendExpoMessages(
      tokens.map((item) => item.token),
      payload,
    );
  }

  private async sendExpoMessages(tokens: string[], payload: PushPayload) {
    const uniqueTokens = [...new Set(tokens.filter(isExpoPushToken))];
    if (uniqueTokens.length === 0) return;

    for (let index = 0; index < uniqueTokens.length; index += EXPO_BATCH_SIZE) {
      const batch = uniqueTokens.slice(index, index + EXPO_BATCH_SIZE);
      const messages = batch.map((token) => ({
        to: token,
        sound: 'default',
        channelId: 'rnc',
        priority: 'high',
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
      }));

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const responseText = await response.text().catch(() => '');

      if (!response.ok) {
        console.warn(
          `[notifications] Expo push failed: ${response.status} ${responseText}`,
        );
        continue;
      }

      const responseBody = safeJsonParse(responseText);
      const failedTickets = Array.isArray(responseBody?.data)
        ? responseBody.data.filter(
            (ticket: { status?: string }) => ticket.status === 'error',
          )
        : [];

      if (failedTickets.length > 0) {
        console.warn(
          `[notifications] Expo accepted request, but ${failedTickets.length} ticket(s) failed`,
        );
      }
    }
  }
}

function isExpoPushToken(token?: string | null) {
  if (!token) return false;
  return /^Expo(nent)?PushToken\[[\w-]+\]$/.test(token);
}

function safeJsonParse(value: string) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
