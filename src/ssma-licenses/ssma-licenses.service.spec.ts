import { ForbiddenException } from '@nestjs/common';
import { SsmaLicensesService } from './ssma-licenses.service';

describe('SsmaLicensesService individual access', () => {
  const prisma = {
    ssmaLicense: { findMany: jest.fn() },
  };
  const service = new SsmaLicensesService(prisma as any, {} as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ssmaLicense.findMany.mockResolvedValue([]);
  });

  it('allows support to list licenses only with the grant', async () => {
    await expect(service.findAll('supervisor_apoio', true)).resolves.toEqual(
      [],
    );
    await expect(
      service.findAll('supervisor_apoio', false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow another role to reuse the grant', async () => {
    await expect(service.findAll('motorista', true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('keeps renewals restricted even for a support user granted license access', async () => {
    await expect(
      service.createRenewal('license-1', {}, 'supervisor_apoio', 'support-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
