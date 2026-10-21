import { ForbiddenException } from '@nestjs/common';

// JwtGuard refreshes the role from the active user record before each request.
export function assertDudaAdmin(role: unknown): void {
  if (role !== 'admin') {
    throw new ForbiddenException('Acesso restrito à Planilha da Duda');
  }
}
