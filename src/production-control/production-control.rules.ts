import { BadRequestException } from '@nestjs/common';

export function parseCompetence(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    value < '2026-10'
  ) {
    throw new BadRequestException(
      'Informe um mês válido a partir de outubro de 2026.',
    );
  }
  return value;
}

export function monthWeeks(competence: string) {
  parseCompetence(competence);
  const [year, month] = competence.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks: { index: number; start: string; end: string }[] = [];
  for (let day = 1; day <= lastDay; ) {
    const start = new Date(Date.UTC(year, month - 1, day));
    const daysUntilSaturday = (6 - start.getUTCDay() + 7) % 7;
    const endDay = Math.min(lastDay, day + daysUntilSaturday);
    weeks.push({
      index: weeks.length,
      start: `${competence}-${String(day).padStart(2, '0')}`,
      end: `${competence}-${String(endDay).padStart(2, '0')}`,
    });
    day = endDay + 1;
  }
  return weeks;
}

export function parseDateInMonth(value: unknown, competence: string): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !value.startsWith(`${competence}-`)
  ) {
    throw new BadRequestException('A data deve pertencer ao mês selecionado.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Data de produção inválida.');
  }
  return date;
}

export function parseQuantity(
  value: unknown,
  label: string,
  nullable = false,
): string | null {
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BadRequestException(`${label} deve ser um número.`);
  }
  const text = String(value).trim();
  if (!/^(?:\d{1,9})(?:\.\d{1,3})?$/.test(text)) {
    throw new BadRequestException(
      `${label} deve ser positivo, com até três casas decimais.`,
    );
  }
  return text;
}

export function parseUnitPrice(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BadRequestException('Valor unitário inválido.');
  }
  const text = String(value).trim();
  if (!/^(?:\d{1,9})(?:\.\d{1,15})?$/.test(text)) {
    throw new BadRequestException('Valor unitário inválido.');
  }
  return text;
}

export function requiredText(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(
      `${label} é obrigatório (até ${max} caracteres).`,
    );
  }
  return value.trim();
}

export function optionalText(value: unknown, max = 160): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new BadRequestException(`Texto inválido (até ${max} caracteres).`);
  }
  return value.trim() || null;
}
