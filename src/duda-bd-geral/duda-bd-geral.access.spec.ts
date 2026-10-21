import { ForbiddenException } from '@nestjs/common';
import { assertDudaAdmin } from './duda-bd-geral.access';

describe('Planilha da Duda administrator access', () => {
  it('accepts the system admin role', () => {
    expect(() => assertDudaAdmin('admin')).not.toThrow();
  });

  it.each([
    undefined,
    '',
    'administrativo',
    'prumare_admin',
    'gestor',
    'ceo',
    123,
  ])('rejects any other role (%s)', (role) => {
    expect(() => assertDudaAdmin(role)).toThrow(ForbiddenException);
  });
});
