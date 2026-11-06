import { PrismaService } from '../prisma/prisma.service';
import { getLucasFleetRosterMonth } from './lucas-fleet-roster.controller';
import { getLucasFleetGroupLaborActuals } from './lucas-fleet-labor-actuals';
import { Prisma } from '@prisma/client';
import {
  fingerprint0025Aggregate,
  fingerprint0025Manifest,
} from './fleet-labor-integrity';

jest.mock('./lucas-fleet-roster.controller', () => ({
  getLucasFleetRosterMonth: jest.fn(),
}));

const current = (
  driverEmployeeKey: string | null,
  laborAssignments: unknown = [],
) => ({
  vehicleId: 'v1',
  year: 2026,
  month: 10,
  vehicleStopped: false,
  status: 'aberto',
  driverEmployeeKey,
  laborAssignments,
});
const previous = (
  driverEmployeeKey: string | null,
  laborAssignments: unknown = [],
) => ({
  ...current(driverEmployeeKey, laborAssignments),
  year: 2026,
  month: 9,
});

function aggregate(
  employeeNumber: string,
  value: string,
  id = `aggregate-${employeeNumber}`,
) {
  const source = {
    id,
    companyCode: '1',
    employeeNumber,
    employeeKey: `1-${employeeNumber}`,
    competence: new Date('2026-10-01T00:00:00.000Z'),
    period: 20,
    totalGeneralLine: new Prisma.Decimal(value),
    sourceRows: 1,
    allocationRows: 0,
    fixedAllocationValue: null,
    allocationClosed: false,
    officialCostEligible: false,
    pendingReason: 'PFRATEIOFIXO_CARDINALIDADE_NAO_RECONCILIADA',
    contentHash: '',
    syncRunId: 'run-0025-source',
    isCurrent: true,
    active: true,
    syncRun: { status: 'SUCCEEDED', rejectedRows: 0 },
  };
  return { ...source, contentHash: fingerprint0025Aggregate(source) };
}

function manifest(rows: ReturnType<typeof aggregate>[], runId = 'run-0025') {
  return {
    syncRunId: runId,
    rowCount: rows.length,
    contentHash: fingerprint0025Manifest(rows).contentHash,
    syncRun: {
      status: 'SUCCEEDED',
      contextCode: '0/P',
      rejectedRows: 0,
      finishedAt: new Date(),
    },
    memberships: rows.map((row) => ({ aggregate: row })),
  };
}

function setCostRows(
  prisma: ReturnType<typeof setup>,
  rows: ReturnType<typeof aggregate>[],
  runId = 'run-0025',
) {
  prisma.totvsEmployeeCostAggregate.findMany.mockResolvedValue(rows);
  prisma.totvsEmployeeCostRunManifest.findFirst.mockResolvedValue(
    manifest(rows, runId),
  );
}

function setup(subgroup = 'CARROS FROTA JR') {
  const now = new Date();
  const rows = [aggregate('1', '100')];
  jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
    rows: [
      { id: 'v1', name: 'Veiculo', subgroup, rollerType: null, active: true },
    ],
  } as never);
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          checklistEnabled: true,
          monthlyChecklistResponsible: { name: 'Dioclesio' },
        },
      ]),
    },
    checklist: { findMany: jest.fn() },
    fleetResultMonthlyWorkforce: { findMany: jest.fn().mockResolvedValue([]) },
    totvsEmployeeSyncRun: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'run-0025',
        contextCode: '0/P',
        status: 'SUCCEEDED',
        rejectedRows: 0,
        finishedAt: now,
      }),
    },
    totvsEmployeeCostRunManifest: {
      findFirst: jest.fn().mockResolvedValue(manifest(rows)),
    },
    totvsEmployeeCostAggregate: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
    totvsEmployeeSnapshot: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ employeeKey: '1-1', employmentStatus: 'A' }]),
    },
  };
  return prisma;
}

describe('mao de obra da frota com ultimo vinculo mensal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('usa o ultimo operador quando o mes consultado nao tem checklist', async () => {
    const prisma = setup();
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([previous('1-1')]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      status: 'COMPLETE',
      inheritedVehicleCount: 1,
      inheritedFromMonths: ['2026-09'],
    });
    expect(prisma.totvsEmployeeSnapshot.findMany).toHaveBeenCalled();
  });

  it('troca para o vinculo do checklist do mes quando ele existe', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      inheritedVehicleCount: 0,
      inheritedFromMonths: [],
    });
    expect(prisma.checklist.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.totvsEmployeeSnapshot.findMany).toHaveBeenCalled();
  });

  it('nao considera custo oficial de operador atual inativo no TOTVS', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', employmentStatus: 'D' },
    ]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: null,
      isPartial: true,
      missingLinks: [
        { source: 'CHECKLIST', reason: 'EMPLOYEE_NOT_CURRENT_TOTVS' },
      ],
    });
  });

  it('nao herda funcionario ausente da lista TOTVS da competencia atual', async () => {
    const prisma = setup();
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([previous('1-1')]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
  });

  it('nao substitui um checklist atual incompleto pelo vinculo antigo', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current(null)]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(prisma.checklist.findMany).toHaveBeenCalledTimes(1);
  });

  it('nao ressuscita operador de antes de uma vistoria parada', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { ...previous(null), vehicleStopped: true },
      { ...previous('1-1'), month: 8 },
    ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
  });

  it('nao escolhe entre dois checklists no ultimo mes anterior', async () => {
    const prisma = setup();
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        previous('1-1'),
        previous('1-2'),
        { ...previous('1-3'), month: 8 },
      ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
  });

  it('usa equipe especial configurada por Lucas, sem herdar extras do checklist', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        previous('1-1', [{ role: 'RAKE_WORKER', employeeKey: '1-3' }]),
      ]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      {
        vehicleId: 'v1',
        assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-2' }],
      },
    ]);
    setCostRows(prisma, [aggregate('1', '100'), aggregate('2', '50')]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', employmentStatus: 'A' },
      { employeeKey: '1-2', employmentStatus: 'A' },
    ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '150.000000',
      inheritedVehicleCount: 1,
      employeeCount: 2,
    });
    const costCalls = prisma.totvsEmployeeCostAggregate.findMany.mock
      .calls as unknown as Array<
      [{ where: { queryCode: string; competence: Date } }]
    >;
    const costQuery = costCalls[0][0];
    expect(costQuery.where.queryCode).toBe('IND.BI.0025');
    expect(costQuery.where.competence).toEqual(
      new Date('2026-10-01T00:00:00.000Z'),
    );
  });

  it('nao presume equipe especial a partir do checklist antigo', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        previous('1-1', [{ role: 'RAKE_WORKER', employeeKey: '1-2' }]),
      ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      isPartial: true,
      missingLinkVehicleCount: 1,
      missingLinks: [
        {
          source: 'LUCAS',
          reason: 'MONTHLY_TEAM_NOT_CONFIGURED',
          responsibleName: 'Lucas (Apresentação Lucas)',
        },
      ],
    });
  });

  it('aceita equipe vazia quando Lucas confirmou explicitamente o mes', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      { vehicleId: 'v1', assignments: [] },
    ]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      status: 'COMPLETE',
    });
  });

  it('nao soma equipe mensal de frota registrada como parada', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([
      { ...current(null), vehicleStopped: true },
    ]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      {
        vehicleId: 'v1',
        assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-2' }],
      },
    ]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
    expect(result.groupLaborActuals[0].missingLinkVehicleCount).toBe(0);
  });

  it('mostra pendencia do checklist com responsavel e parcela conhecida da equipe', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      {
        vehicleId: 'v1',
        assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-1' }],
      },
    ]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      isPartial: true,
      missingLinkVehicleCount: 1,
      missingLinks: [
        {
          source: 'CHECKLIST',
          reason: 'NO_CHECKLIST_HISTORY',
          responsibleName: 'Dioclesio',
        },
      ],
    });
  });

  it('trata o rateio 0025 como oficial nesta rotina apesar do flag legado', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      isPartial: false,
      isProvisional: false,
      costSource: 'OFFICIAL_0025',
      costStatus: 'OFFICIAL',
    });
  });

  it('nao consulta a fonte 0039 mesmo se existir aprovacao antiga', async () => {
    const prisma = setup();
    const approval = jest.fn().mockResolvedValue({ id: 'legacy-0039' });
    const dedicated = jest
      .fn()
      .mockResolvedValue([{ totalGeneralRateado: '999' }]);
    Object.assign(prisma, {
      totvsFleetLaborApproval: { findFirst: approval },
      totvsFleetLaborCost: { findMany: dedicated },
    });
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0].laborActual).toBe('100.000000');
    expect(approval).not.toHaveBeenCalled();
    expect(dedicated).not.toHaveBeenCalled();
  });

  it('falha fechado se o manifesto 0025 nao corresponder aos dados correntes', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.totvsEmployeeCostRunManifest.findFirst.mockResolvedValueOnce({
      ...manifest([aggregate('1', '100')]),
      contentHash: 'hash-incorreto',
    });
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: null,
      isPartial: true,
      costSource: 'SOURCE_INTEGRITY_ERROR',
      costStatus: 'SOURCE_INTEGRITY_ERROR',
    });
  });

  it('reflete a captura 0025 seguinte automaticamente sem aprovacao manual', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValue([current('1-1')]);
    const first = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(first.groupLaborActuals[0].laborActual).toBe('100.000000');
    setCostRows(
      prisma,
      [aggregate('1', '111', 'aggregate-next')],
      'run-0025-next',
    );
    prisma.totvsEmployeeSyncRun.findFirst.mockResolvedValue({
      id: 'run-0025-next',
      status: 'SUCCEEDED',
      contextCode: '0/P',
      rejectedRows: 0,
      finishedAt: new Date(),
    });
    const second = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(second.groupLaborActuals[0]).toMatchObject({
      laborActual: '111.000000',
      costSource: 'OFFICIAL_0025',
    });
  });

  it('mostra o subtotal de uma frota mesmo que outra do grupo nunca tenha checklist', async () => {
    const prisma = setup();
    jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
      rows: [
        {
          id: 'v1',
          fleet: '101',
          name: 'Carro 101',
          subgroup: 'CARROS FROTA JR',
          active: true,
        },
        {
          id: 'v2',
          fleet: '102',
          name: 'Carro 102',
          subgroup: 'CARROS FROTA JR',
          active: true,
        },
      ],
    } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: 'v1',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      },
      {
        id: 'v2',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Hilario' },
      },
    ]);
    prisma.checklist.findMany
      .mockResolvedValueOnce([current('1-1')])
      .mockResolvedValueOnce([]);
    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000',
      isPartial: true,
      missingLinkVehicleCount: 1,
      missingLinks: [
        { vehicleId: 'v2', fleet: '102', responsibleName: 'Hilario' },
      ],
    });
  });

  it('rateia em centavos o custo do operador de duas frotas em grupos diferentes sem duplicar o total', async () => {
    const prisma = setup();
    const rows = [aggregate('1', '100.01')];
    setCostRows(prisma, rows);
    const vehicles = [
      {
        id: 'v1',
        fleet: '68',
        name: 'Frontier',
        subgroup: 'CAMINHONETES',
        rollerType: null,
        active: true,
      },
      {
        id: 'v2',
        fleet: '313',
        name: 'Strada',
        subgroup: 'CARROS FROTA JR',
        rollerType: null,
        active: true,
      },
    ];
    jest
      .mocked(getLucasFleetRosterMonth)
      .mockResolvedValue({ rows: vehicles } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      })),
    );
    prisma.checklist.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        ...current('1-1'),
        vehicleId: vehicle.id,
      })),
    );

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    const amounts = result.groupLaborActuals.map((group) =>
      new Prisma.Decimal(group.laborActual ?? '0').toFixed(2),
    );
    expect(amounts.sort()).toEqual(['50.00', '50.01']);
    expect(result.groupLaborActuals).toHaveLength(2);
    expect(
      result.groupLaborActuals.every(
        (group) =>
          group.status === 'COMPLETE' &&
          group.missingLinkVehicleCount === 0 &&
          group.missingCostEmployeeCount === 0 &&
          group.valuedEmployeeCount === 1,
      ),
    ).toBe(true);
    expect(
      result.groupLaborActuals
        .reduce(
          (sum, group) => sum.plus(group.laborActual ?? '0'),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    ).toBe('100.01');
  });

  it('rateia um operador de tres frotas por veiculo: duas em um grupo e uma em outro', async () => {
    const prisma = setup();
    setCostRows(prisma, [aggregate('1', '90.00')]);
    const vehicles = [
      {
        id: 'v1',
        fleet: '68',
        name: 'Frontier',
        subgroup: 'CAMINHONETES',
        rollerType: null,
        active: true,
      },
      {
        id: 'v2',
        fleet: '69',
        name: 'Outra caminhonete',
        subgroup: 'CAMINHONETES',
        rollerType: null,
        active: true,
      },
      {
        id: 'v3',
        fleet: '313',
        name: 'Strada',
        subgroup: 'CARROS FROTA JR',
        rollerType: null,
        active: true,
      },
    ];
    jest
      .mocked(getLucasFleetRosterMonth)
      .mockResolvedValue({ rows: vehicles } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      })),
    );
    prisma.checklist.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        ...current('1-1'),
        vehicleId: vehicle.id,
      })),
    );

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    const byGroup = new Map(
      result.groupLaborActuals.map((group) => [group.groupKey, group]),
    );
    expect(
      new Prisma.Decimal(
        byGroup.get('SUBGROUP:CAMINHONETES')?.laborActual ?? '0',
      ).toFixed(2),
    ).toBe('60.00');
    expect(
      new Prisma.Decimal(
        byGroup.get('SUBGROUP:CARROS FROTA JR')?.laborActual ?? '0',
      ).toFixed(2),
    ).toBe('30.00');
    expect(
      result.groupLaborActuals
        .reduce(
          (sum, group) => sum.plus(group.laborActual ?? '0'),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    ).toBe('90.00');
  });

  it('conta o custo uma vez quando o mesmo operador esta em duas frotas do mesmo grupo', async () => {
    const prisma = setup();
    setCostRows(prisma, [aggregate('1', '100.00')]);
    const vehicles = [
      {
        id: 'v1',
        fleet: '68',
        name: 'Frontier',
        subgroup: 'CAMINHONETES',
        rollerType: null,
        active: true,
      },
      {
        id: 'v2',
        fleet: '69',
        name: 'Outra caminhonete',
        subgroup: 'CAMINHONETES',
        rollerType: null,
        active: true,
      },
    ];
    jest
      .mocked(getLucasFleetRosterMonth)
      .mockResolvedValue({ rows: vehicles } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      })),
    );
    prisma.checklist.findMany.mockResolvedValueOnce(
      vehicles.map((vehicle) => ({
        ...current('1-1'),
        vehicleId: vehicle.id,
      })),
    );

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals).toHaveLength(1);
    expect(result.groupLaborActuals[0]).toMatchObject({
      groupKey: 'SUBGROUP:CAMINHONETES',
      laborActual: '100.000000',
      employeeCount: 1,
      valuedEmployeeCount: 1,
      status: 'COMPLETE',
    });
  });

  it('divide apenas uma vez o operador tambem listado na equipe da mesma frota', async () => {
    const prisma = setup();
    setCostRows(prisma, [aggregate('1', '100.00')]);
    jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
      rows: [
        {
          id: 'v1',
          fleet: '230',
          name: 'Vibro',
          subgroup: 'VIBROACABADORAS',
          rollerType: null,
          active: true,
        },
        {
          id: 'v2',
          fleet: '68',
          name: 'Frontier',
          subgroup: 'CAMINHONETES',
          rollerType: null,
          active: true,
        },
      ],
    } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: 'v1',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      },
      {
        id: 'v2',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      },
    ]);
    prisma.checklist.findMany.mockResolvedValueOnce([
      current('1-1'),
      { ...current('1-1'), vehicleId: 'v2' },
    ]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      {
        vehicleId: 'v1',
        assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-1' }],
      },
    ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    expect(result.groupLaborActuals).toHaveLength(2);
    expect(
      result.groupLaborActuals
        .map((group) => new Prisma.Decimal(group.laborActual ?? '0').toFixed(2))
        .sort(),
    ).toEqual(['50.00', '50.00']);
    expect(
      result.groupLaborActuals.every(
        (group) =>
          group.status === 'COMPLETE' && group.valuedEmployeeCount === 1,
      ),
    ).toBe(true);
    expect(
      result.groupLaborActuals
        .reduce(
          (sum, group) => sum.plus(group.laborActual ?? '0'),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    ).toBe('100.00');
  });

  it('nao aplica o rateio de operadores a quem tambem esta como equipe extra em outro grupo', async () => {
    const prisma = setup();
    setCostRows(prisma, [aggregate('1', '100.00'), aggregate('2', '50.00')]);
    jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
      rows: [
        {
          id: 'v1',
          fleet: '68',
          name: 'Frontier',
          subgroup: 'CAMINHONETES',
          rollerType: null,
          active: true,
        },
        {
          id: 'v2',
          fleet: '230',
          name: 'Vibro',
          subgroup: 'VIBROACABADORAS',
          rollerType: null,
          active: true,
        },
      ],
    } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: 'v1',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      },
      {
        id: 'v2',
        checklistEnabled: true,
        monthlyChecklistResponsible: { name: 'Silvio' },
      },
    ]);
    prisma.checklist.findMany.mockResolvedValueOnce([
      current('1-1'),
      { ...current('1-2'), vehicleId: 'v2' },
    ]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      {
        vehicleId: 'v2',
        assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-1' }],
      },
    ]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', employmentStatus: 'A' },
      { employeeKey: '1-2', employmentStatus: 'A' },
    ]);

    const result = await getLucasFleetGroupLaborActuals(
      prisma as unknown as PrismaService,
      '2026-10',
    );
    const byGroup = new Map(
      result.groupLaborActuals.map((group) => [group.groupKey, group]),
    );
    expect(byGroup.get('SUBGROUP:CAMINHONETES')).toMatchObject({
      laborActual: null,
      status: 'PENDING_ASSIGNMENT_OR_SOURCE',
    });
    expect(byGroup.get('SUBGROUP:VIBROACABADORAS')).toMatchObject({
      laborActual: '50.000000',
      status: 'PENDING_ASSIGNMENT_OR_SOURCE',
    });
  });
});
