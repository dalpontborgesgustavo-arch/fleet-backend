import { ForbiddenException } from '@nestjs/common';

// The first version is a private review surface for Gustavo. Expanding access
// later requires a separate, audited decision; the admin role is not enough.
const OWNER_EMAIL = 'dalpontborgesgustavo@gmail.com';

export function assertDudaOwner(email: unknown): void {
  if (typeof email !== 'string' || email.trim().toLowerCase() !== OWNER_EMAIL) {
    throw new ForbiddenException('Acesso restrito à Planilha da Duda');
  }
}
