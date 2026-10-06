import { BadRequestException } from '@nestjs/common';

export const SELECTABLE_TOTVS_STATUSES = new Set(['A', 'V', 'X', 'Z', 'F', 'G']);

export type MonthlyLaborRole =
  | 'TABLE_OPERATOR'
  | 'ASPHALT_FOREMAN'
  | 'RAKE_WORKER'
  | 'LABORER'
  | 'GRADER_OPERATOR';

export type MonthlyLaborAssignment = {
  role: MonthlyLaborRole;
  employeeKey: string;
};

function normalized(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function monthlyWorkforceKind(subgroup: unknown) {
  const value = normalized(subgroup);
  if (value === 'VIBRO ACABADORAS' || value === 'VIBROACABADORAS') return 'VIBRO' as const;
  if (value === 'MOTONIVELADORAS' || value === 'PATROLAS') return 'PATROLA' as const;
  return 'STANDARD' as const;
}

export function parseMonthlyLaborAssignments(
  input: unknown,
  subgroup: unknown,
): MonthlyLaborAssignment[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 40) {
    throw new BadRequestException('Equipe de mao de obra invalida.');
  }
  const kind = monthlyWorkforceKind(subgroup);
  const allowed = kind === 'VIBRO'
    ? new Set<MonthlyLaborRole>(['TABLE_OPERATOR', 'ASPHALT_FOREMAN', 'RAKE_WORKER', 'LABORER'])
    : kind === 'PATROLA'
      ? new Set<MonthlyLaborRole>(['GRADER_OPERATOR'])
      : new Set<MonthlyLaborRole>();
  const seen = new Set<string>();
  const singles = new Set<MonthlyLaborRole>();
  const result: MonthlyLaborAssignment[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException('Equipe de mao de obra invalida.');
    }
    const role = String(item.role || '') as MonthlyLaborRole;
    const employeeKey = String(item.employeeKey || '').trim();
    if (!allowed.has(role) || !/^\d+-.{1,40}$/.test(employeeKey) || seen.has(employeeKey)) {
      throw new BadRequestException('Cargo ou colaborador duplicado/invalido na equipe.');
    }
    if ((role === 'TABLE_OPERATOR' || role === 'ASPHALT_FOREMAN') && singles.has(role)) {
      throw new BadRequestException('Informe apenas uma pessoa para este cargo.');
    }
    seen.add(employeeKey);
    singles.add(role);
    result.push({ role, employeeKey });
  }
  return result;
}

export function isSelectableTotvsEmployee(status: unknown) {
  return SELECTABLE_TOTVS_STATUSES.has(normalized(status));
}
