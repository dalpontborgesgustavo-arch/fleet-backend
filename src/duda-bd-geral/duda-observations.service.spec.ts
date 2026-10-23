import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DudaObservationsService } from './duda-observations.service';

describe('DudaObservationsService', () => {
  const prisma = {
    dudaBdGeralImport: { findUnique: jest.fn() },
    dudaBdGeralRow: { findFirst: jest.fn() },
    dudaBdGeralManualEntry: { findFirst: jest.fn() },
    dudaObservation: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    dudaObservationRevision: { create: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new DudaObservationsService(prisma as never);
  const values = {
    kind: 'RECEIPT_DELAY',
    referenceMonth: '2026-10',
    targetMonth: '2026-11',
    note: 'Cliente adiou o pagamento.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma),
    );
    prisma.dudaBdGeralImport.findUnique.mockResolvedValue({ id: 'batch-1' });
    prisma.dudaBdGeralRow.findFirst.mockResolvedValue({
      id: 'row-1',
      importId: 'batch-1',
      excelRow: 12,
      classification: 'detail_candidate',
      cells: {
        A: { raw: '12' },
        E: { raw: 'Cliente' },
        G: { raw: 'Obra' },
        T: { raw: '2026-10' },
        U: { raw: 300 },
        V: { raw: 330 },
      },
      manualEntry: null,
    });
    prisma.dudaObservation.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'obs-1', version: 1, ...data }),
    );
    prisma.dudaObservationRevision.create.mockResolvedValue({ id: 'rev-1' });
  });

  it('registra somente postergação vinculada à linha sem alterar a BD Geral', async () => {
    const result = await service.create('batch-1', 'row-1', 'user-1', values);
    expect(result).toMatchObject({
      sourceRowId: 'row-1',
      manualEntryId: null,
      referenceMonth: '2026-10',
      targetMonth: '2026-11',
      status: 'OPEN',
    });
    const createCalls = prisma.dudaObservation.create.mock
      .calls as unknown as Array<
      [
        {
          data: {
            rowSnapshot: {
              work: string;
              originalExpectedReceiptAmount: string;
              expectedReceiptAmount: string;
            };
          };
        },
      ]
    >;
    const creation = createCalls[0][0];
    expect(creation.data.rowSnapshot.work).toBe('Obra');
    expect(creation.data.rowSnapshot.originalExpectedReceiptAmount).toBe('300');
    expect(creation.data.rowSnapshot.expectedReceiptAmount).toBe('330');
    const revisionCalls = prisma.dudaObservationRevision.create.mock
      .calls as unknown as Array<
      [
        {
          data: { version: number; action: string };
        },
      ]
    >;
    const revision = revisionCalls[0][0];
    expect(revision.data).toMatchObject({ version: 1, action: 'CREATE' });
    expect(prisma.dudaBdGeralRow.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.dudaObservation.updateMany).not.toHaveBeenCalled();
  });

  it('rejeita antecipação e mês inválido antes de qualquer escrita', async () => {
    await expect(
      service.create('batch-1', 'row-1', 'user-1', {
        ...values,
        kind: 'BILLING_DELAY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('batch-1', 'row-1', 'user-1', {
        ...values,
        targetMonth: '2026-09',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('batch-1', 'row-1', 'user-1', {
        ...values,
        referenceMonth: '2026-13',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('não cria observação para uma linha não classificada como lançamento', async () => {
    prisma.dudaBdGeralRow.findFirst.mockResolvedValue({
      id: 'row-1',
      classification: 'formula_only',
    });
    await expect(
      service.create('batch-1', 'row-1', 'user-1', values),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dudaObservation.create).not.toHaveBeenCalled();
  });

  it('não cria observação para linha de outra importação', async () => {
    prisma.dudaBdGeralRow.findFirst.mockResolvedValue(null);
    prisma.dudaBdGeralManualEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.create('batch-1', 'row-1', 'user-1', values),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exige versão atual na edição e mantém auditoria', async () => {
    prisma.dudaObservation.findFirst.mockResolvedValue({
      id: 'obs-1',
      importId: 'batch-1',
      version: 2,
      ...values,
      status: 'OPEN',
      resolvedAt: null,
    });
    await expect(
      service.update('batch-1', 'obs-1', 'user-1', {
        ...values,
        status: 'RESOLVED',
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dudaObservation.updateMany).not.toHaveBeenCalled();
    prisma.dudaObservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.dudaObservation.findUniqueOrThrow.mockResolvedValue({
      id: 'obs-1',
      version: 3,
      ...values,
      status: 'RESOLVED',
    });
    const updated = await service.update('batch-1', 'obs-1', 'user-1', {
      ...values,
      status: 'RESOLVED',
      expectedVersion: 2,
    });
    expect(updated.status).toBe('RESOLVED');
    const revisionCalls = prisma.dudaObservationRevision.create.mock
      .calls as unknown as Array<
      [
        {
          data: { version: number; action: string };
        },
      ]
    >;
    const revision = revisionCalls[0][0];
    expect(revision.data).toMatchObject({ action: 'RESOLVE', version: 3 });
  });

  it('consulta recebimentos pelo mês desejado, usando o original apenas sem nova previsão', async () => {
    prisma.dudaObservation.count.mockResolvedValue(0);
    prisma.dudaObservation.findMany.mockResolvedValue([]);
    await service.list('batch-1', {
      page: '1',
      status: 'OPEN',
      kind: 'RECEIPT_DELAY',
      month: '2026-10',
    });
    expect(prisma.dudaObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          importId: 'batch-1',
          status: 'OPEN',
          kind: 'RECEIPT_DELAY',
          OR: [
            { targetMonth: '2026-10' },
            { targetMonth: null, referenceMonth: '2026-10' },
          ],
        },
      }),
    );
  });
});
