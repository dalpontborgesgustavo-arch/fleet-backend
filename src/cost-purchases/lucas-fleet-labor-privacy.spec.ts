import { canReadFleetLaborCost, suppressSmallLaborGroups } from './lucas-fleet-actuals.controller';

describe('privacidade do custo de mao de obra por subgrupo', () => {
  it('suprime valores conhecidos de menos de tres funcionarios', () => {
    const result = suppressSmallLaborGroups([
      { laborActual: '100.000000', valuedEmployeeCount: 1, costStatus: 'OFFICIAL' },
      { laborActual: '200.000000', valuedEmployeeCount: 2, costStatus: 'PROVISIONAL' },
      { laborActual: '300.000000', valuedEmployeeCount: 3, costStatus: 'OFFICIAL' },
    ], true);
    expect(result[0]).toMatchObject({ laborActual: null,
      costStatus: 'PRIVACY_SUPPRESSED', privacySuppressed: true });
    expect(result[1]).toMatchObject({ laborActual: null,
      costStatus: 'PRIVACY_SUPPRESSED', privacySuppressed: true });
    expect(result[2]).toMatchObject({ laborActual: '300.000000',
      privacySuppressed: false });
    expect(result).not.toHaveProperty('totalLabor');
  });

  it('nao mascara erro de integridade como supressao de privacidade', () => {
    const result = suppressSmallLaborGroups([
      { laborActual: null, valuedEmployeeCount: 0,
        costStatus: 'SOURCE_INTEGRITY_ERROR' },
    ], true);
    expect(result[0]).toMatchObject({ laborActual: null,
      costStatus: 'SOURCE_INTEGRITY_ERROR', privacySuppressed: false });
  });

  it('restringe custo ate de grupo grande para perfis sem autorizacao sensivel', () => {
    const result = suppressSmallLaborGroups([
      { laborActual: '300.000000', valuedEmployeeCount: 3, costStatus: 'OFFICIAL' },
    ], false);
    expect(result[0]).toMatchObject({ laborActual: null,
      costStatus: 'ACCESS_RESTRICTED', privacySuppressed: true });
    expect(canReadFleetLaborCost({ role: 'licitacao', sub: 'user-1' })).toBe(false);
    expect(canReadFleetLaborCost({ role: 'gestor', sub: 'user-2' })).toBe(false);
    expect(canReadFleetLaborCost({ role: 'ceo', sub: 'user-3' })).toBe(true);
  });

  it('permite acesso especifico a um usuario autorizado por id sem liberar o perfil inteiro', () => {
    const prior = process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS;
    process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS = 'lucas-id';
    try {
      expect(canReadFleetLaborCost({ role: 'licitacao', sub: 'lucas-id' })).toBe(true);
      expect(canReadFleetLaborCost({ role: 'licitacao', sub: 'outro-id' })).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS;
      else process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS = prior;
    }
  });
});
