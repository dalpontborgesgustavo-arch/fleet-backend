import { ForbiddenException } from '@nestjs/common';
import { RncProfileAccessGuard } from './rnc-profile-access.guard';

function contextWithRole(role: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as any;
}

describe('RncProfileAccessGuard', () => {
  const guard = new RncProfileAccessGuard();

  it.each(['motorista', 'operador', 'MOTORISTA'])(
    'blocks the shared driver profile %s from every authenticated RNC route',
    (role) => {
      expect(() => guard.canActivate(contextWithRole(role))).toThrow(
        ForbiddenException,
      );
    },
  );

  it.each([
    'admin',
    'engenharia',
    'gestor',
    'consultor',
    'qualidade',
    'juridico',
    'almoxarifado',
    'licitacao',
    'usina_icara',
  ])('keeps the existing RNC access flow for %s', (role) => {
    expect(guard.canActivate(contextWithRole(role))).toBe(true);
  });
});
