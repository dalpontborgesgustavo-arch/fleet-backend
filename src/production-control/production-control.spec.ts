import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertProductionAccess } from './production-control.access';
import {
  monthWeeks,
  parseCompetence,
  parseDateInMonth,
  parseQuantity,
  parseUnitPrice,
} from './production-control.rules';
import { ProductionControlService } from './production-control.service';
import { PrismaService } from '../prisma/prisma.service';

describe('production control guard and calendar', () => {
  it('limits access to administrators and the restricted production role', () => {
    expect(assertProductionAccess({ sub: 'admin', role: 'admin' })).toBe(
      'admin',
    );
    expect(
      assertProductionAccess({
        sub: 'lucas',
        role: 'administrativo_producao',
      }),
    ).toBe('lucas');
    expect(() =>
      assertProductionAccess({
        sub: 'other',
        role: 'engenharia',
        canManageProductionControl: true,
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertProductionAccess({ sub: 'other', role: 'engenharia' }),
    ).toThrow(ForbiddenException);
    expect(() => assertProductionAccess()).toThrow(ForbiddenException);
  });

  it('starts only in October 2026 and follows the workbook week boundaries', () => {
    expect(() => parseCompetence('2026-09')).toThrow(BadRequestException);
    expect(monthWeeks('2026-10')).toEqual([
      { index: 0, start: '2026-10-01', end: '2026-10-03' },
      { index: 1, start: '2026-10-04', end: '2026-10-10' },
      { index: 2, start: '2026-10-11', end: '2026-10-17' },
      { index: 3, start: '2026-10-18', end: '2026-10-24' },
      { index: 4, start: '2026-10-25', end: '2026-10-31' },
    ]);
    expect(() => parseDateInMonth('2026-11-01', '2026-10')).toThrow(
      BadRequestException,
    );
  });

  it('distinguishes blank, zero, and invalid quantities', () => {
    expect(parseQuantity(null, 'Quantidade', true)).toBeNull();
    expect(parseQuantity('0', 'Quantidade', true)).toBe('0');
    expect(() => parseQuantity('-1', 'Quantidade', true)).toThrow(
      BadRequestException,
    );
    expect(parseUnitPrice('86.0405809956758')).toBe('86.0405809956758');
  });

  it('updates one weekly target without erasing the other', async () => {
    const before = {
      weeklyPlanQuantity: new Prisma.Decimal(4),
      monthPlanQuantity: new Prisma.Decimal(3),
    };
    const update = jest
      .fn()
      .mockImplementation(({ data }) => ({ ...before, ...data }));
    const transaction = {
      productionControlWeek: {
        findUnique: jest.fn().mockResolvedValue(before),
        update,
      },
      productionControlRevision: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      productionControlLine: {
        findUnique: jest.fn().mockResolvedValue({ competence: '2026-10' }),
      },
      $transaction: (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as PrismaService;
    const service = new ProductionControlService(prisma);
    await service.setWeek('line', '0', { weeklyPlanQuantity: '5' }, 'lucas');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          weeklyPlanQuantity: new Prisma.Decimal(5),
        }),
      }),
    );
    expect(update.mock.calls[0][0].data).not.toHaveProperty(
      'monthPlanQuantity',
    );
  });
});
