import { ForbiddenException } from '@nestjs/common';
import { assertDudaOwner } from './duda-bd-geral.access';

describe('Planilha da Duda private access', () => {
  it('accepts only the designated owner email', () => {
    expect(() =>
      assertDudaOwner(' DAlpontborgesgustavo@gmail.com '),
    ).not.toThrow();
  });

  it.each([undefined, '', 'admin@example.com', 123])(
    'rejects any other identity (%s)',
    (identity) => {
      expect(() => assertDudaOwner(identity)).toThrow(ForbiddenException);
    },
  );
});
