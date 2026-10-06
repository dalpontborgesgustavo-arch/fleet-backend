import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASPHALT_EQUIPMENT_RATE_CATEGORIES,
  AsphaltEquipmentRateCategory,
} from './dto/usina-asphalt-equipment-hourly-rate.dto';
import { normalizeCompetence } from './usina-asphalt-team-fleet.rules';
import { optionalText } from './usina-asphalt-teams.rules';

function parseDecimal(value: unknown, label: string) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new BadRequestException(`${label} e obrigatoria`);
  }
  const raw = String(value).trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(normalized);
  } catch {
    throw new BadRequestException(`${label} invalida`);
  }
  if (!result.isFinite() || result.isNegative()) {
    throw new BadRequestException(`${label} deve ser maior ou igual a zero`);
  }
  return new Prisma.Decimal(result.toFixed(6));
}

export function normalizeEquipmentRateCategory(
  value: unknown,
): AsphaltEquipmentRateCategory {
  const category = String(value || '')
    .trim()
    .toUpperCase() as AsphaltEquipmentRateCategory;
  if (!ASPHALT_EQUIPMENT_RATE_CATEGORIES.includes(category)) {
    throw new BadRequestException('Categoria de tarifa invalida');
  }
  return category;
}

export function normalizeEquipmentHourlyRateInput(body: any) {
  const reason =
    optionalText(body?.reason, 500) ||
    'Cadastro ou alteração sem justificativa informada.';
  const competenceValue = String(body?.competence || '').trim();
  const normalizedCompetence = /^\d{4}-\d{2}(?:-\d{2})?$/.test(
    competenceValue,
  )
    ? `${competenceValue.slice(0, 7)}-01`
    : competenceValue;
  return {
    competence: normalizeCompetence(normalizedCompetence),
    category: normalizeEquipmentRateCategory(body?.category),
    productiveRate: parseDecimal(
      body?.productiveRate,
      'Tarifa produtiva',
    ),
    unproductiveRate: parseDecimal(
      body?.unproductiveRate,
      'Tarifa improdutiva',
    ),
    reason,
  };
}
