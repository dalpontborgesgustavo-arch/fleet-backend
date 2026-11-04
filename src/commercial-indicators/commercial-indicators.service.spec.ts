import { ForbiddenException } from '@nestjs/common';
import { CommercialIndicatorsService } from './commercial-indicators.service';

describe('CommercialIndicatorsService access', () => {
  it('permite consulta ao CEO, mas bloqueia todos os cadastros comerciais', async () => {
    const prisma = {
      commercialOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
      commercialProcessRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    const service = new CommercialIndicatorsService(prisma as never);
    await expect(service.listOpportunities('ceo')).resolves.toEqual([]);
    await expect(service.listProcesses('ceo')).resolves.toEqual([]);
    for (const mutation of [
      () => service.createOpportunity({}, 'ceo', 'eder'),
      () => service.updateOpportunity('id', {}, 'ceo', 'eder'),
      () => service.removeOpportunity('id', 'ceo', 'eder'),
      () => service.createProcess({}, 'ceo', 'eder'),
      () => service.updateProcess('id', {}, 'ceo', 'eder'),
      () => service.removeProcess('id', 'ceo', 'eder'),
    ]) {
      await expect(mutation()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
