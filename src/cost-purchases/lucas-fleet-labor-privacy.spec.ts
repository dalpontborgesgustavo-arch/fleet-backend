import {
  canReadFleetLaborCost,
  restrictLaborGroups,
} from './lucas-fleet-actuals.controller';

describe('acesso ao custo de mao de obra por subgrupo', () => {
  it('mostra grupos de um, dois ou mais funcionarios ao perfil autorizado', () => {
    const result = restrictLaborGroups(
      [
        {
          laborActual: '100.000000',
          valuedEmployeeCount: 1,
          costStatus: 'OFFICIAL',
        },
        {
          laborActual: '200.000000',
          valuedEmployeeCount: 2,
          costStatus: 'PROVISIONAL',
        },
        {
          laborActual: '300.000000',
          valuedEmployeeCount: 3,
          costStatus: 'OFFICIAL',
        },
      ],
      true,
    );
    expect(result[0]).toMatchObject({
      laborActual: '100.000000',
      costStatus: 'OFFICIAL',
      privacySuppressed: false,
    });
    expect(result[1]).toMatchObject({
      laborActual: '200.000000',
      costStatus: 'PROVISIONAL',
      privacySuppressed: false,
    });
    expect(result[2]).toMatchObject({
      laborActual: '300.000000',
      privacySuppressed: false,
    });
    expect(result).not.toHaveProperty('totalLabor');
  });

  it('nao mascara erro de integridade como custo conhecido', () => {
    const result = restrictLaborGroups(
      [
        {
          laborActual: null,
          valuedEmployeeCount: 0,
          costStatus: 'SOURCE_INTEGRITY_ERROR',
        },
      ],
      true,
    );
    expect(result[0]).toMatchObject({
      laborActual: null,
      costStatus: 'SOURCE_INTEGRITY_ERROR',
      privacySuppressed: false,
    });
  });

  it('restringe custo ate de grupo pequeno para perfis sem autorizacao sensivel', () => {
    const result = restrictLaborGroups(
      [
        {
          laborActual: '100.000000',
          valuedEmployeeCount: 1,
          costStatus: 'OFFICIAL',
        },
      ],
      false,
    );
    expect(result[0]).toMatchObject({
      laborActual: null,
      costStatus: 'ACCESS_RESTRICTED',
      privacySuppressed: true,
    });
    expect(canReadFleetLaborCost({ role: 'licitacao', sub: 'user-1' })).toBe(
      false,
    );
    expect(canReadFleetLaborCost({ role: 'gestor', sub: 'user-2' })).toBe(
      false,
    );
    expect(canReadFleetLaborCost({ role: 'ceo', sub: 'user-3' })).toBe(true);
  });

  it('permite acesso especifico a um usuario autorizado por id sem liberar o perfil inteiro', () => {
    const prior = process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS;
    process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS = 'lucas-id';
    try {
      expect(
        canReadFleetLaborCost({ role: 'licitacao', sub: 'lucas-id' }),
      ).toBe(true);
      expect(
        canReadFleetLaborCost({ role: 'licitacao', sub: 'outro-id' }),
      ).toBe(false);
    } finally {
      if (prior === undefined)
        delete process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS;
      else process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS = prior;
    }
  });
});
