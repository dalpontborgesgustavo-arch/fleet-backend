import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nullableText } from './usina-monthly-cost.rules';

export function parseExercise(value: unknown) {
  const exercise = Number(String(value ?? '').trim());
  if (!Number.isInteger(exercise) || exercise < 2025 || exercise > 2100) {
    throw new BadRequestException('Exercicio deve estar entre 2025 e 2100');
  }
  return exercise;
}

export function parseAnnualValue(value: unknown) {
  const raw = String(value ?? '').trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new BadRequestException('Valor anual deve ser um valor monetario nao negativo');
  }
  const annualValue = new Prisma.Decimal(normalized);
  if (annualValue.isNegative()) {
    throw new BadRequestException('Valor anual nao pode ser negativo');
  }
  return annualValue.toDecimalPlaces(2);
}

export function normalizeAnnualDepreciationInput(body: any) {
  const annualValue = parseAnnualValue(body?.annualValue);
  return {
    exercise: parseExercise(body?.exercise),
    annualValue,
    monthlyValue: annualValue.div(12).toDecimalPlaces(2),
    observation: nullableText(body?.observation),
    changeReason: nullableText(body?.changeReason, 500),
  };
}

export function annualDepreciationSnapshot(depreciation: {
  exercise: number;
  version: number;
  status: string;
  annualValue: Prisma.Decimal;
  monthlyValue: Prisma.Decimal;
  observation?: string | null;
  changeReason?: string | null;
}) {
  return {
    exercise: depreciation.exercise,
    version: depreciation.version,
    status: depreciation.status,
    annualValue: depreciation.annualValue.toFixed(2),
    monthlyValue: depreciation.monthlyValue.toFixed(2),
    observation: depreciation.observation ?? null,
    changeReason: depreciation.changeReason ?? null,
  };
}
