import { BadRequestException } from '@nestjs/common';
import { normalizeEquipmentHourlyRateInput } from './usina-asphalt-equipment-hourly-rate.rules';

describe('usina asphalt equipment hourly rate rules', () => {
  it('normaliza competencia, virgula decimal e preserva zero factual', () => {
    const result = normalizeEquipmentHourlyRateInput({
      competence: '2026-08-19',
      category: 'vibroacabadora',
      productiveRate: '1.234,567891',
      unproductiveRate: '0',
      reason: 'Cadastro mensal confirmado',
    });

    expect(result.competence.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(result.category).toBe('VIBROACABADORA');
    expect(result.productiveRate.toFixed(6)).toBe('1234.567891');
    expect(result.unproductiveRate.toFixed(6)).toBe('0.000000');
  });

  it.each([
    { productiveRate: '-1', unproductiveRate: '0' },
    { productiveRate: '1', unproductiveRate: '-0,01' },
  ])('rejeita tarifa negativa', (rates) => {
    expect(() =>
      normalizeEquipmentHourlyRateInput({
        competence: '2026-08-01',
        category: 'ROLO_LISO',
        reason: 'Teste de validacao',
        ...rates,
      }),
    ).toThrow(BadRequestException);
  });

  it('aceita justificativa vazia e registra texto neutro na auditoria', () => {
    const result = normalizeEquipmentHourlyRateInput({
      competence: '2026-08-01',
      category: 'ROLO_PNEUS',
      productiveRate: 10,
      unproductiveRate: 5,
    });

    expect(result.reason).toBe(
      'Cadastro ou alteração sem justificativa informada.',
    );
  });
});
