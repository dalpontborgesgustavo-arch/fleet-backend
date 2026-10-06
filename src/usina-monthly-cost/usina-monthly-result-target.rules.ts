import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  competenceKey,
  nullableText,
  parseCompetence,
} from './usina-monthly-cost.rules';

export function parseNullableTargetRate(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new BadRequestException(
      'Percentual previsto deve ser um decimal entre 0 e 1 com ate 6 casas',
    );
  }
  const targetRate = new Prisma.Decimal(normalized);
  if (targetRate.lt(0) || targetRate.gt(1)) {
    throw new BadRequestException(
      'Percentual previsto decimal deve estar entre 0 e 1',
    );
  }
  return targetRate.toDecimalPlaces(6);
}

export function normalizeMonthlyResultTargetInput(body: any) {
  return {
    competence: parseCompetence(body?.competence),
    targetRate: parseNullableTargetRate(body?.targetRate),
    observation: nullableText(body?.observation),
    changeReason: nullableText(body?.changeReason, 500),
  };
}

export function monthlyResultTargetSnapshot(target: {
  competence: Date;
  targetRate: Prisma.Decimal | null;
  observation?: string | null;
  status: string;
  version: number;
  changeReason?: string | null;
}) {
  return {
    competence: competenceKey(target.competence),
    targetRate: target.targetRate === null ? null : target.targetRate.toFixed(6),
    targetPercent:
      target.targetRate === null ? null : target.targetRate.mul(100).toFixed(2),
    observation: target.observation ?? null,
    status: target.status,
    version: target.version,
    changeReason: target.changeReason ?? null,
  };
}
