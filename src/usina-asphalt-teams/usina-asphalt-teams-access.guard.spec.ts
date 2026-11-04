import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UsinaAsphaltTeamsAccessGuard } from './usina-asphalt-teams-access.guard';

function context(role: string, method: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role }, method }) }),
  } as unknown as ExecutionContext;
}

describe('UsinaAsphaltTeamsAccessGuard', () => {
  const guard = new UsinaAsphaltTeamsAccessGuard();

  it('permite ao CEO consultar os custos das equipes', () => {
    expect(guard.canActivate(context('ceo', 'GET'))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'bloqueia %s para o CEO',
    (method) => {
      expect(() => guard.canActivate(context('ceo', method))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('mantem os cadastros para Licitacao Gestor', () => {
    expect(guard.canActivate(context('licitacao_gestor', 'POST'))).toBe(true);
  });
});
