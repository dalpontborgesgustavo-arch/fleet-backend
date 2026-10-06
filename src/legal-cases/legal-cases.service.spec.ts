import { ForbiddenException } from '@nestjs/common';
import {
  aggregateLegalDashboard,
  ensureLegalCasesAccess,
  legalProcessKey,
} from './legal-cases.service';

describe('LegalCasesService helpers', () => {
  it.each(['admin', 'gestor', 'ceo', 'juridico', 'JURIDICO'])(
    'permite %s',
    (role) => {
      expect(() => ensureLegalCasesAccess(role)).not.toThrow();
    },
  );

  it.each(['administrativo', 'qualidade', undefined])(
    'bloqueia %s',
    (role) => {
      expect(() => ensureLegalCasesAccess(role)).toThrow(ForbiddenException);
    },
  );

  it('normaliza numero do processo sem perder digitos', () => {
    expect(legalProcessKey('0001234-56.2026.5.12.0001')).toBe(
      '00012345620265120001',
    );
  });

  it('calcula conversoes apenas quando os dois valores sao conhecidos', () => {
    const result = aggregateLegalDashboard(
      [
        {
          area: 'TRABALHISTA',
          company: 'JR_CONSTRUCOES',
          status: 'ENCERRADO',
          referenceDate: new Date('2026-01-10T12:00:00Z'),
          originalClaimAmount: 1000,
          judgmentAmount: 500,
          finalPaidAmount: 250,
        },
        {
          area: 'CIVEL',
          company: 'PEDRA_FORTE',
          status: 'EM_ANDAMENTO',
          referenceDate: new Date('2026-01-20T12:00:00Z'),
          originalClaimAmount: 2000,
          judgmentAmount: null,
          finalPaidAmount: null,
        },
        {
          area: 'CIVEL',
          company: 'PEDRA_FORTE',
          status: null,
          referenceDate: null,
          originalClaimAmount: 0,
          judgmentAmount: 0,
          finalPaidAmount: 0,
        },
      ],
      2026,
    );
    expect(result.totalCases).toBe(2);
    expect(result.conversionOriginalPct).toBe(25);
    expect(result.conversionJudgmentPct).toBe(50);
    expect(result.months[0].caseCount).toBe(2);
  });
});
