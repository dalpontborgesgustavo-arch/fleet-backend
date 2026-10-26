import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DudaShelfService } from './duda-shelf.service';

describe('DudaShelfService', () => {
  const prisma = {
    dudaShelfEntry: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    dudaShelfRevision: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new DudaShelfService(prisma as never);
  const input = {
    trackingMonth: '2026-10',
    municipality: 'Tubarão',
    workName: 'Obra A',
    amount: '200.00',
    category: 'Medição',
    note: '',
    status: 'OPEN',
    invoicedOn: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.dudaShelfEntry.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'item-1',
          version: 1,
          status: 'OPEN',
          invoicedOn: null,
          ...data,
        }),
    );
    prisma.dudaShelfRevision.create.mockResolvedValue({});
  });

  it('registra uma pendência manual com auditoria', async () => {
    await service.create('user-1', input);
    const createCalls = prisma.dudaShelfEntry.create.mock
      .calls as unknown as Array<
      [{ data: { trackingMonth: string; amount: Prisma.Decimal } }]
    >;
    const revisionCalls = prisma.dudaShelfRevision.create.mock
      .calls as unknown as Array<[{ data: { action: string } }]>;
    const created = createCalls[0][0];
    const revision = revisionCalls[0][0];
    expect(created.data.trackingMonth).toBe('2026-10');
    expect(created.data.amount).toEqual(new Prisma.Decimal('200.00'));
    expect(revision.data.action).toBe('CREATE');
  });

  it('não permite marcar faturado sem data', async () => {
    await expect(
      service.create('user-1', { ...input, status: 'INVOICED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não altera registro histórico', async () => {
    prisma.dudaShelfEntry.findUnique.mockResolvedValue({
      id: 'item-1',
      status: 'HISTORICAL',
      version: 1,
    });
    await expect(
      service.update('item-1', 'user-1', { ...input, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não transporta para um mês já preenchido', async () => {
    prisma.dudaShelfEntry.findMany.mockResolvedValue([
      { id: 'item-1', ...input },
    ]);
    prisma.dudaShelfEntry.count.mockResolvedValue(1);
    await expect(
      service.carry('user-1', { fromMonth: '2026-10', toMonth: '2026-11' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dudaShelfEntry.create).not.toHaveBeenCalled();
  });

  it('importa cada mês uma vez sem converter setembro em pendência atual', async () => {
    prisma.dudaShelfEntry.count.mockResolvedValue(0);
    await service.importSnapshot('user-1', {
      sourceSha256: 'a'.repeat(64),
      rows: [
        {
          excelRow: 3,
          trackingMonth: '2026-09',
          municipality: 'Tubarão',
          workName: 'Obra A',
          amount: '200.00',
          category: 'Medição',
        },
        {
          excelRow: 22,
          trackingMonth: '2026-10',
          municipality: 'Tubarão',
          workName: 'Obra A',
          amount: '200.00',
          category: 'Medição',
        },
      ],
    });
    const calls = prisma.dudaShelfEntry.create.mock.calls as Array<
      [{ data: { status: string } }]
    >;
    expect(calls.map((call) => call[0].data.status)).toEqual([
      'HISTORICAL',
      'OPEN',
    ]);
  });
});
