import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

describe('JwtGuard restricted production profile', () => {
  const jwtService = { verify: jest.fn().mockReturnValue({ sub: 'lucas' }) };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lucas',
        email: 'lucasrf@jrmc.com.br',
        name: 'Lucas Rodrigues Figueira',
        role: 'administrativo_producao',
        active: true,
        mustChangePassword: false,
      }),
    },
  };
  const guard = new JwtGuard(jwtService as any, prisma as any);
  const requestFor = (path: string) => {
    const request = { headers: { authorization: 'Bearer valid' }, path };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return context;
  };

  it('permits the production routine but denies other authenticated modules', async () => {
    await expect(guard.canActivate(requestFor('/production-control/2026-10'))).resolves.toBe(true);
    await expect(guard.canActivate(requestFor('/users'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(requestFor('/rnc'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still permits first-access password change', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'lucas',
      email: 'lucasrf@jrmc.com.br',
      role: 'administrativo_producao',
      active: true,
      mustChangePassword: true,
    });
    await expect(guard.canActivate(requestFor('/auth/change-password'))).resolves.toBe(true);
  });
});
