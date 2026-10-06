import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  competenceKey,
  nullableText,
  parseCompetence,
} from './usina-monthly-cost.rules';

export function parseStonePowderFreightUnitCost(value: unknown) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new BadRequestException(
      'Frete do po de pedra deve ser um valor nao negativo com ate 6 casas decimais',
    );
  }
  const unitCostPerM3 = new Prisma.Decimal(normalized);
  if (unitCostPerM3.lt(0)) {
    throw new BadRequestException('Frete do po de pedra nao pode ser negativo');
  }
  return unitCostPerM3.toDecimalPlaces(6);
}

export function normalizeMonthlyStonePowderFreightInput(body: any) {
  return {
    competence: parseCompetence(body?.competence),
    unitCostPerM3: parseStonePowderFreightUnitCost(body?.unitCostPerM3),
    observation: nullableText(body?.observation),
    changeReason: nullableText(body?.changeReason, 500),
  };
}

export function monthlyStonePowderFreightSnapshot(record: {
  competence: Date;
  unitCostPerM3: Prisma.Decimal;
  observation?: string | null;
  status: string;
  version: number;
  changeReason?: string | null;
}) {
  return {
    competence: competenceKey(record.competence),
    unitCostPerM3: record.unitCostPerM3.toFixed(6),
    observation: record.observation ?? null,
    status: record.status,
    version: record.version,
    changeReason: record.changeReason ?? null,
  };
}
