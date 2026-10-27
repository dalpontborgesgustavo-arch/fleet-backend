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
import {
  municipalityFromWorkName,
  uniqueCanonicalName,
  PRODUCTION_SERVICES,
} from './production-control.catalog';

describe('production control guard and calendar', () => {
  it('keeps service units and price suggestions explicit without changing historic prices', () => {
    expect(
      PRODUCTION_SERVICES.find((item) => item.activity === 'Asfalto'),
    ).toEqual(
      expect.objectContaining({
        unit: 't',
        suggestedPrice: '565',
        priceVaries: true,
      }),
    );
    expect(uniqueCanonicalName('Gabriel Búrigo', ['GABRIEL BÚRIGO'])).toBe(
      'GABRIEL BÚRIGO',
    );
    expect(
      uniqueCanonicalName('Rafael', ['RAFAEL CARLOS', 'RAFAEL DA SILVA']),
    ).toBeNull();
    expect(municipalityFromWorkName('CANELINHA - CC 05-2026 - OBRA')).toBe(
      'CANELINHA',
    );
    expect(
      municipalityFromWorkName('PRUMARE - CONDOMINIO SERENA CITTÀ'),
    ).toBeNull();
  });

  it('uses the Aethos work code and does not silently accept an unknown work', async () => {
    const prisma = {
      aethosObra: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ProductionControlService(prisma);
    await expect(service.findWork('999999')).rejects.toThrow(
      'Obra não encontrada',
    );
    await expect(service.findWork('abc')).rejects.toThrow(BadRequestException);
  });

  it('prefers the exact Controle de Obras engineer and city over contract or spreadsheet data', async () => {
    const prisma = {
      aethosObra: {
        findUnique: jest.fn().mockResolvedValue({
          code: '542',
          name: 'IÇARA - RODOVIA HILDEBRANDO',
          active: true,
        }),
      },
      constructionControlState: {
        findUnique: jest.fn().mockResolvedValue({
          data: {
            works: [
              {
                codigoObra: '542',
                cidade: 'IÇARA',
                engenheiro: 'Gabriel Búrigo',
              },
            ],
            engineers: [{ nome: 'GABRIEL BÚRIGO', status: 'Ativo' }],
          },
        }),
      },
      aethosContract: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ engineerName: 'OUTRO ENGENHEIRO' }]),
      },
      productionControlLine: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ engineer: 'Gabriel', municipality: null }]),
      },
    } as unknown as PrismaService;
    const result = await new ProductionControlService(prisma).findWork('542');
    expect(result).toEqual(
      expect.objectContaining({
        code: '542',
        engineer: 'GABRIEL BÚRIGO',
        municipality: 'IÇARA',
      }),
    );
  });

  it('takes the canonical work name when an existing line receives a new code', async () => {
    const current = {
      id: 'line-1',
      workCode: null,
      workName: 'Rua antiga',
      municipality: null,
      engineer: 'GABRIEL BÚRIGO',
      unitPrice: new Prisma.Decimal(14),
    };
    const update = jest.fn(
      (args: { data: Record<string, unknown> }) => args.data,
    );
    const transaction = {
      productionControlLine: { update },
      productionControlRevision: { create: jest.fn() },
    };
    const prisma = {
      productionControlLine: {
        findUnique: jest.fn().mockResolvedValue(current),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aethosObra: {
        findUnique: jest.fn().mockResolvedValue({
          code: '542',
          name: 'IÇARA - CC 67-2026 - RODOVIA HILDEBRANDO',
          active: true,
        }),
      },
      constructionControlState: {
        findUnique: jest.fn().mockResolvedValue({
          data: {
            works: [
              {
                codigoObra: '542',
                cidade: 'IÇARA',
                engenheiro: 'Gabriel Búrigo',
              },
            ],
            engineers: [{ nome: 'GABRIEL BÚRIGO', status: 'Ativo' }],
          },
        }),
      },
      aethosContract: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as PrismaService;
    await new ProductionControlService(prisma).updateLine(
      'line-1',
      { workCode: '542' },
      'admin',
    );
    expect(update.mock.calls[0][0].data).toMatchObject({
      workCode: '542',
      workName: 'IÇARA - CC 67-2026 - RODOVIA HILDEBRANDO',
      municipality: 'IÇARA',
    });
  });
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
    const update = jest.fn(
      ({ data }: { data: Record<string, Prisma.Decimal> }) => ({
        ...before,
        ...data,
      }),
    );
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
    expect(update.mock.calls[0][0].data.weeklyPlanQuantity).toEqual(
      new Prisma.Decimal(5),
    );
    expect(update.mock.calls[0][0].data).not.toHaveProperty(
      'monthPlanQuantity',
    );
  });
});
