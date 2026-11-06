import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getLucasFleetRosterMonth } from '../cost-purchases/lucas-fleet-roster.controller';
import { FleetResultMonthlyWorkforceService } from './fleet-result-monthly-workforce.service';

jest.mock('../cost-purchases/lucas-fleet-roster.controller', () => ({
  getLucasFleetRosterMonth: jest.fn(),
}));

function setup() {
  jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
    rows: [{ id: 'v1', active: true, subgroup: 'VIBRO ACABADORAS' }],
  } as never);
  const tx = {
    fleetResultMonthlyWorkforce: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({
        id: 'setting-1',
        assignments: [],
        updatedAt: new Date(),
      }),
    },
    fleetResultMonthlyWorkforceAudit: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    totvsEmployeeSnapshot: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ employeeKey: '1-0002', employmentStatus: 'A' }]),
    },
    fleetResultMonthlyWorkforce: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(
      async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  return {
    service: new FleetResultMonthlyWorkforceService(
      prisma as unknown as PrismaService,
    ),
    prisma,
    tx,
  };
}

describe('equipe mensal configurada por Lucas', () => {
  const previousEditors = process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS = 'lucas-1';
  });

  afterAll(() => {
    if (previousEditors === undefined)
      delete process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS;
    else process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS = previousEditors;
  });

  it('recusa escrita de perfis com somente leitura', async () => {
    const { service, prisma } = setup();
    await expect(
      service.saveVehicle(
        '2026-10',
        'v1',
        { assignments: [] },
        'user-1',
        'ceo',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(
      service.findEmployees('2026-10', 'ceo'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findMonth('2026-10', 'licitacao'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mantem outro licitacao_gestor somente leitura e nega por padrao sem allowlist', async () => {
    const { service, prisma } = setup();
    const readOnly = await service.findMonth(
      '2026-10',
      'licitacao_gestor',
      'outro-gestor',
    );
    expect(readOnly).toMatchObject({ canEdit: false });
    await expect(
      service.saveVehicle(
        '2026-10',
        'v1',
        { assignments: [] },
        'outro-gestor',
        'licitacao_gestor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    delete process.env.LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS;
    await expect(
      service.saveVehicle(
        '2026-10',
        'v1',
        { assignments: [] },
        'lucas-1',
        'licitacao_gestor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('informa canEdit para o Lucas autorizado e preserva escrita de administrador', async () => {
    const { service } = setup();
    await expect(
      service.findMonth('2026-10', 'licitacao_gestor', 'lucas-1'),
    ).resolves.toMatchObject({ canEdit: true });
    await expect(
      service.findEmployees('2026-10', 'admin', 'admin-1'),
    ).resolves.toMatchObject({ canEdit: true });
  });

  it('grava equipe vazia explicitamente com auditoria sem apagar checklists', async () => {
    const { service, tx } = setup();
    const result = await service.saveVehicle(
      '2026-10',
      'v1',
      { assignments: [] },
      'lucas-1',
      'licitacao_gestor',
    );
    expect(result.assignments).toEqual([]);
    const upsertCalls = tx.fleetResultMonthlyWorkforce.upsert.mock
      .calls as unknown as Array<
      [{ create: { vehicleId: string; assignments: unknown[] } }]
    >;
    const upsert = upsertCalls[0][0];
    expect(upsert.create).toMatchObject({ vehicleId: 'v1', assignments: [] });
    const auditCalls = tx.fleetResultMonthlyWorkforceAudit.create.mock
      .calls as unknown as Array<
      [{ data: { action: string; actorId: string; afterData: unknown[] } }]
    >;
    const audit = auditCalls[0][0];
    expect(audit.data).toMatchObject({
      action: 'CREATED',
      actorId: 'lucas-1',
      afterData: [],
    });
  });

  it('exige chave de colaborador ativa no TOTVS da competencia', async () => {
    const { service, prisma } = setup();
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([]);
    await expect(
      service.saveVehicle(
        '2026-10',
        'v1',
        {
          assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-0002' }],
        },
        'lucas-1',
        'licitacao_gestor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nao interpreta ausencia de lista como equipe confirmada vazia', async () => {
    const { service } = setup();
    await expect(
      service.saveVehicle('2026-10', 'v1', {}, 'lucas-1', 'licitacao_gestor'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveVehicle(
        '2026-10',
        'v1',
        { assignments: null },
        'lucas-1',
        'licitacao_gestor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
