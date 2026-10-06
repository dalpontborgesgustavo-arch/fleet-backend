import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const USINA_MONTHLY_COST_CONTEXT = {
  companyId: 'JR_CONSTRUCOES',
  companyName: 'JR Construções',
  unitId: 'USINA_ASFALTO_ICARA',
  unitName: 'Usina de Asfalto de Içara',
} as const;

export const USINA_MONTHLY_COST_ALLOWED_ROLES = new Set([
  'licitacao',
  'licitacao_gestor',
  'admin',
  'administrador',
]);

export function canAccessUsinaMonthlyCost(role?: string | null) {
  return USINA_MONTHLY_COST_ALLOWED_ROLES.has(
    String(role || '').trim().toLowerCase(),
  );
}

export function parseCompetence(value: unknown) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-01$/.test(text)) {
    throw new BadRequestException(
      'Competencia deve ser o primeiro dia do mes no formato AAAA-MM-01',
    );
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException('Competencia invalida');
  }
  return date;
}

function requiredText(value: unknown, field: string, max = 100) {
  const text = String(value ?? '').trim();
  if (!text) throw new BadRequestException(`${field} e obrigatorio`);
  if (text.length > max) {
    throw new BadRequestException(`${field} deve ter no maximo ${max} caracteres`);
  }
  return text;
}

export function nullableText(value: unknown, max = 1000) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new BadRequestException(`Texto deve ter no maximo ${max} caracteres`);
  }
  return text;
}

function positiveInteger(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException(`${field} deve ser um numero inteiro positivo`);
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new BadRequestException(`${field} deve ser maior que zero`);
  }
  return number;
}

function equipment(value: any, type: 'CARREGADEIRA' | 'VEICULO_USINA', order: number) {
  return {
    equipmentType: type,
    fleetNumber: requiredText(value?.fleetNumber, 'Numero da frota', 30),
    aethosVehicleId: positiveInteger(value?.aethosVehicleId, 'ID_VEICULO Aethos'),
    sortOrder: order,
  };
}

export function normalizeMonthlyCostInput(body: any) {
  const competence = parseCompetence(body?.competence);
  if (!Array.isArray(body?.loaders) || body.loaders.length < 1 || body.loaders.length > 20) {
    throw new BadRequestException('Informe entre 1 e 20 carregadeiras');
  }
  const loaders = body.loaders.map((item: any, index: number) =>
    equipment(item, 'CARREGADEIRA', index + 1),
  );
  const supportVehicle = equipment(
    body?.supportVehicle,
    'VEICULO_USINA',
    loaders.length + 1,
  );
  const seenFleet = new Set<string>();
  const seenAethos = new Set<number>();
  for (const item of [...loaders, supportVehicle]) {
    const fleetKey = item.fleetNumber.toUpperCase().replace(/\s/g, '');
    if (seenFleet.has(fleetKey) || seenAethos.has(item.aethosVehicleId)) {
      throw new BadRequestException(
        `O equipamento da frota ${item.fleetNumber} esta duplicado na configuracao`,
      );
    }
    seenFleet.add(fleetKey);
    seenAethos.add(item.aethosVehicleId);
  }

  const taxText = String(body?.taxRate ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(taxText)) {
    throw new BadRequestException('Aliquota deve ser um decimal com ate 6 casas');
  }
  const taxRate = new Prisma.Decimal(taxText);
  if (taxRate.lte(0) || taxRate.gt(1)) {
    throw new BadRequestException('Aliquota decimal deve ser maior que zero e menor ou igual a 1');
  }

  return {
    competence,
    loaders,
    supportVehicle,
    equipment: [...loaders, supportVehicle],
    taxRate,
    observation: nullableText(body?.observation),
    changeReason: nullableText(body?.changeReason, 500),
  };
}

export function competenceKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function monthlyCostSnapshot(config: {
  competence: Date;
  version: number;
  status: string;
  taxRate: Prisma.Decimal;
  observation?: string | null;
  changeReason?: string | null;
  equipment: Array<{
    equipmentType: string;
    fleetNumber: string;
    aethosVehicleId: number;
    sortOrder: number;
  }>;
}) {
  return {
    competence: competenceKey(config.competence),
    version: config.version,
    status: config.status,
    taxRate: config.taxRate.toString(),
    observation: config.observation ?? null,
    changeReason: config.changeReason ?? null,
    equipment: config.equipment.map((item) => ({
      equipmentType: item.equipmentType,
      fleetNumber: item.fleetNumber,
      aethosVehicleId: item.aethosVehicleId,
      sortOrder: item.sortOrder,
    })),
  };
}
