import { BadRequestException } from '@nestjs/common';
import { EnvironmentalService } from './environmental.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';

describe('EnvironmentalService — resultados atmosféricos', () => {
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'air-1',
      ...data,
      factor: null,
      attachments: [],
    }),
  );
  const findMany = jest.fn();
  const prisma = {
    environmentalRecord: { create, findMany },
    environmentalEmissionFactor: { findUnique: jest.fn() },
  } as unknown as PrismaService;
  const service = new EnvironmentalService(prisma, {} as S3UploadService);

  const input = {
    domain: 'AIR_EMISSION',
    metric: 'NOX',
    company: 'JR_CONSTRUCOES',
    competence: '2026-10',
    recordedAt: '2026-10-06T12:00:00.000Z',
    amount: '108,90',
    unit: 'unidade adulterada',
    details: {
      lme: 'Não aplicável',
      evaluator: 'Responsável de teste',
      regulation: 'texto adulterado',
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it('salva resultado decimal sem gerar CO₂e e define regulamentação pelo poluente', async () => {
    const record = await service.createRecord(input, 'ssma', 'user-1');

    expect(record.amount).toBe(108.9);
    expect(record.co2eKg).toBeNull();
    expect(record.factorId).toBeNull();
    expect(record.unit).toBe('mg/Nm³');
    expect(record.details).toEqual(
      expect.objectContaining({
        lme: 'Não aplicável',
        evaluator: 'Responsável de teste',
        regulation: expect.stringContaining('Art. 33'),
      }),
    );
    expect(record.details.regulation).not.toBe('texto adulterado');
  });

  it('rejeita resultado não numérico, poluente desconhecido ou avaliação sem responsável', async () => {
    await expect(
      service.createRecord({ ...input, amount: '108 mg' }, 'ssma'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createRecord({ ...input, metric: 'CO2' }, 'ssma'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createRecord({ ...input, details: { lme: '90' } }, 'ssma'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('exige que competência e data da realização coincidam, sem fator de emissão', async () => {
    await expect(
      service.createRecord({ ...input, competence: '2026-09' }, 'ssma'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const record = await service.createRecord(
      { ...input, factorId: 'fator-antigo' },
      'ssma',
    );
    expect(record.factorId).toBeNull();
  });

  it('não mistura esses resultados com o inventário GEE ou os gráficos mensais', async () => {
    findMany.mockResolvedValue([
      {
        domain: 'AIR_EMISSION',
        metric: 'MP',
        amount: 991.73,
        competence: new Date('2026-10-01T12:00:00.000Z'),
        co2eKg: null,
        source: 'MANUAL',
      },
    ]);
    const dashboard = await service.dashboard(
      { from: '2026-10', to: '2026-10' },
      'admin',
    );
    expect(dashboard.totals.ghgKgCo2e).toBe(0);
    expect(dashboard.totals.opacityMeasurements).toBe(0);
    expect(dashboard.dataQuality.hasGhgInventory).toBe(false);
    expect(dashboard.trend).toHaveLength(0);
  });
});
