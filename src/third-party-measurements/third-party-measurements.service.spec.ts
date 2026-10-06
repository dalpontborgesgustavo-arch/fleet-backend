import { ForbiddenException } from '@nestjs/common';
import {
  buildMeasurementOperationalStatus,
  ensureThirdPartyMeasurementAccess,
} from './third-party-measurements.service';

describe('ThirdPartyMeasurementsService business rules', () => {
  it.each([
    'admin',
    'administrativo',
    'gestor',
    'ceo',
    'ADMIN',
    'ADMINISTRATIVO',
    'GESTOR',
    'CEO',
  ])('allows the authorized role %s', (role) => {
    expect(() => ensureThirdPartyMeasurementAccess(role)).not.toThrow();
  });

  it.each(['engenharia', 'juridico', 'consultor', undefined])(
    'denies the unauthorized role %s',
    (role) => {
      expect(() => ensureThirdPartyMeasurementAccess(role)).toThrow(
        ForbiddenException,
      );
    },
  );

  it('marks an overdue current stage', () => {
    const result = buildMeasurementOperationalStatus(
      { engineerDeliveryTargetDate: new Date('2026-08-18T12:00:00.000Z') },
      new Date('2026-08-20T12:00:00.000Z'),
    );

    expect(result).toEqual({
      status: 'ATRASADO',
      currentStage: 'Entrega ao engenheiro',
      daysToTarget: -2,
    });
  });

  it('only finishes the operational flow after all four stages', () => {
    const completed = new Date('2026-08-20T12:00:00.000Z');
    expect(
      buildMeasurementOperationalStatus({
        engineerDeliveryDate: completed,
        zanandraDeliveryDate: completed,
        invoiceRequestDate: completed,
        contractorDocumentsDeliveryDate: completed,
      }).status,
    ).toBe('CONCLUIDO');
  });

  it('keeps a rejection open until its resolution is registered', () => {
    expect(
      buildMeasurementOperationalStatus({ measurementApproved: false }).status,
    ).toBe('REPROVADO');
    expect(
      buildMeasurementOperationalStatus({
        measurementApproved: false,
        resolutionDate: new Date('2026-08-20T12:00:00.000Z'),
      }).status,
    ).toBe('RESOLVIDO');
  });
});
