import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const USINA_BOM_ALLOWED_ROLES = new Set([
  'qualidade',
  'admin',
  'administrador',
]);

export interface NormalizedBomComponent {
  aethosMaterialId: number;
  materialName: string;
  consumptionPercent: Prisma.Decimal;
  sortOrder: number;
}

export function normalizeUsinaBomRole(role?: string | null) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

export function canAccessUsinaBom(role?: string | null) {
  return USINA_BOM_ALLOWED_ROLES.has(normalizeUsinaBomRole(role));
}

export function parsePositiveInteger(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException(
      `${field} deve ser um codigo numerico inteiro`,
    );
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new BadRequestException(`${field} deve ser maior que zero`);
  }
  return number;
}

export function parseRequiredText(
  value: unknown,
  field: string,
  maxLength = 300,
) {
  const text = String(value ?? '').trim();
  if (!text) throw new BadRequestException(`${field} e obrigatorio`);
  if (text.length > maxLength) {
    throw new BadRequestException(
      `${field} deve ter no maximo ${maxLength} caracteres`,
    );
  }
  return text;
}

export function parseNullableText(value: unknown, maxLength = 100) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new BadRequestException(
      `Texto deve ter no maximo ${maxLength} caracteres`,
    );
  }
  return text;
}

export function parseIsoDate(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw new BadRequestException(`${field} invalida`);
  }
  return date;
}

export function parseConsumptionPercent(value: unknown) {
  const text = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) {
    throw new BadRequestException(
      'Percentual deve ser numerico e possuir no maximo 6 casas decimais',
    );
  }
  const decimal = new Prisma.Decimal(text);
  if (decimal.lte(0) || decimal.gt(100)) {
    throw new BadRequestException(
      'Percentual deve ser maior que zero e menor ou igual a 100',
    );
  }
  return decimal;
}

export function normalizeBomComponents(
  value: unknown,
): NormalizedBomComponent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new BadRequestException('Informe entre 1 e 200 componentes');
  }

  const seen = new Set<number>();
  const components = value.map((item: any, index) => {
    const aethosMaterialId = parsePositiveInteger(
      item?.aethosMaterialId,
      `Codigo Aethos da materia-prima na linha ${index + 1}`,
    );
    if (seen.has(aethosMaterialId)) {
      throw new BadRequestException(
        `A materia-prima ${aethosMaterialId} esta repetida na mesma versao`,
      );
    }
    seen.add(aethosMaterialId);
    return {
      aethosMaterialId,
      materialName: parseRequiredText(
        item?.materialName,
        `Materia-prima na linha ${index + 1}`,
      ),
      consumptionPercent: parseConsumptionPercent(item?.consumptionPercent),
      sortOrder: index + 1,
    };
  });

  const total = components.reduce(
    (sum, component) => sum.plus(component.consumptionPercent),
    new Prisma.Decimal(0),
  );
  if (!total.equals(new Prisma.Decimal(100))) {
    throw new BadRequestException(
      `A soma dos componentes deve ser exatamente 100%. Total informado: ${total.toString()}%`,
    );
  }

  return components;
}

export function previousUtcDate(date: Date) {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

export function dateKey(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10);
}

export function bomSnapshot(input: {
  aethosProductId: number;
  traceName: string;
  version: number;
  validFrom: Date;
  validTo?: Date | null;
  components: NormalizedBomComponent[];
}) {
  return {
    aethosProductId: input.aethosProductId,
    traceName: input.traceName,
    version: input.version,
    validFrom: dateKey(input.validFrom),
    validTo: input.validTo ? dateKey(input.validTo) : null,
    components: input.components.map((component) => ({
      aethosMaterialId: component.aethosMaterialId,
      materialName: component.materialName,
      consumptionPercent: component.consumptionPercent.toString(),
      sortOrder: component.sortOrder,
    })),
  };
}
