import { BadRequestException } from '@nestjs/common';

export type MonthlyPeriod = {
  month: number;
  year: number;
  capturedAt: Date | null;
};

const MAX_OFFLINE_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function saoPauloMonthYear(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value);
  return {
    month: Number(parts.find((part) => part.type === 'month')?.value),
    year: Number(parts.find((part) => part.type === 'year')?.value),
  };
}

export function resolveMonthlyPeriod(
  input: { periodMonth?: number; periodYear?: number; capturedAt?: string },
  receivedAt: Date,
): MonthlyPeriod {
  const current = saoPauloMonthYear(receivedAt);
  const supplied =
    input.periodMonth !== undefined ||
    input.periodYear !== undefined ||
    input.capturedAt !== undefined;

  // Existing app versions did not send the capture time. Keep their behavior.
  if (!supplied) return { ...current, capturedAt: null };

  if (
    !Number.isInteger(input.periodMonth) ||
    input.periodMonth! < 1 ||
    input.periodMonth! > 12 ||
    !Number.isInteger(input.periodYear) ||
    input.periodYear! < 2020 ||
    !input.capturedAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      input.capturedAt,
    )
  ) {
    throw new BadRequestException('Data da inspeção mensal offline inválida.');
  }
  const capturedAt = new Date(input.capturedAt);
  const ageMs = receivedAt.getTime() - capturedAt.getTime();
  if (
    !Number.isFinite(capturedAt.getTime()) ||
    ageMs < -MAX_FUTURE_SKEW_MS ||
    ageMs > MAX_OFFLINE_AGE_MS
  ) {
    throw new BadRequestException(
      'A inspeção offline está fora da janela de 45 dias.',
    );
  }
  const capturedPeriod = saoPauloMonthYear(capturedAt);
  if (
    capturedPeriod.month !== input.periodMonth ||
    capturedPeriod.year !== input.periodYear
  ) {
    throw new BadRequestException(
      'A competência não corresponde à data da inspeção.',
    );
  }
  const previous =
    current.month === 1
      ? { month: 12, year: current.year - 1 }
      : { month: current.month - 1, year: current.year };
  const allowed =
    (capturedPeriod.month === current.month &&
      capturedPeriod.year === current.year) ||
    (capturedPeriod.month === previous.month &&
      capturedPeriod.year === previous.year);
  if (!allowed) {
    throw new BadRequestException(
      'Só é possível enviar inspeções do mês atual ou anterior.',
    );
  }
  return { ...capturedPeriod, capturedAt };
}
