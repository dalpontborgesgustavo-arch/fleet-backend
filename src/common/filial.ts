import { BadRequestException } from '@nestjs/common';

export const DEFAULT_FILIAL = 'MATRIZ' as const;
export const FILIAIS = ['MATRIZ', 'NORTE', 'MAFRA', 'PEDRAFORTE'] as const;

export type FilialValue = (typeof FILIAIS)[number];

export function normalizeFilial(value: unknown): FilialValue {
  const normalized = String(value ?? DEFAULT_FILIAL)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (normalized === 'MATRIZ' || normalized === 'FILIALMATRIZ') {
    return 'MATRIZ';
  }
  if (normalized === 'NORTE' || normalized === 'FILIALNORTE') {
    return 'NORTE';
  }
  if (normalized === 'MAFRA' || normalized === 'FILIALMAFRA') {
    return 'MAFRA';
  }
  if (
    normalized === 'PEDRAFORTE' ||
    normalized === 'FILIALPEDRAFORTE'
  ) {
    return 'PEDRAFORTE';
  }

  throw new BadRequestException(
    'Filial invalida. Use MATRIZ, NORTE, MAFRA ou PEDRAFORTE.',
  );
}
