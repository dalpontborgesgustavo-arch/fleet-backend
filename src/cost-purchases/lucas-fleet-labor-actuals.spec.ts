import { PrismaService } from '../prisma/prisma.service';
import { getLucasFleetRosterMonth } from './lucas-fleet-roster.controller';
import { getLucasFleetGroupLaborActuals } from './lucas-fleet-labor-actuals';

jest.mock('./lucas-fleet-roster.controller', () => ({
  getLucasFleetRosterMonth: jest.fn(),
}));

const current = (driverEmployeeKey: string | null, laborAssignments: unknown = []) => ({
  vehicleId: 'v1', year: 2026, month: 10, vehicleStopped: false,
  status: 'aberto', driverEmployeeKey, laborAssignments,
});
const previous = (driverEmployeeKey: string | null, laborAssignments: unknown = []) => ({
  ...current(driverEmployeeKey, laborAssignments), year: 2026, month: 9,
});

function setup(subgroup = 'CARROS FROTA JR') {
  jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({
    rows: [{ id: 'v1', name: 'Veiculo', subgroup, rollerType: null, active: true }],
  } as never);
  const prisma = {
    vehicle: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', checklistEnabled: true,
      monthlyChecklistResponsible: { name: 'Dioclesio' } }]) },
    checklist: { findMany: jest.fn() },
    fleetResultMonthlyWorkforce: { findMany: jest.fn().mockResolvedValue([]) },
    totvsFleetLaborApproval: { findFirst: jest.fn().mockResolvedValue(null) },
    totvsFleetLaborCost: { count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalGeneralIntegral: null } }),
      findMany: jest.fn().mockResolvedValue([]) },
    totvsEmployeeCostAggregate: { findMany: jest.fn().mockResolvedValue([
      { employeeKey: '1-1', totalGeneralLine: '100', officialCostEligible: true,
        syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
    ]) },
    totvsEmployeeSnapshot: { findMany: jest.fn().mockResolvedValue([
      { employeeKey: '1-1', employmentStatus: 'A' },
    ]) },
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

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', status: 'COMPLETE', inheritedVehicleCount: 1,
      inheritedFromMonths: ['2026-09'],
    });
    expect(prisma.totvsEmployeeSnapshot.findMany).toHaveBeenCalled();
  });

  it('troca para o vinculo do checklist do mes quando ele existe', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', inheritedVehicleCount: 0, inheritedFromMonths: [],
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
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: null, isPartial: true,
      missingLinks: [{ source: 'CHECKLIST', reason: 'EMPLOYEE_NOT_CURRENT_TOTVS' }],
    });
  });

  it('nao herda funcionario ausente da lista TOTVS da competencia atual', async () => {
    const prisma = setup();
    prisma.checklist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([previous('1-1')]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
  });

  it('nao substitui um checklist atual incompleto pelo vinculo antigo', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current(null)]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(prisma.checklist.findMany).toHaveBeenCalledTimes(1);
  });

  it('nao ressuscita operador de antes de uma vistoria parada', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { ...previous(null), vehicleStopped: true },
      { ...previous('1-1'), month: 8 },
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
  });

  it('nao escolhe entre dois checklists no ultimo mes anterior', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      previous('1-1'), previous('1-2'), { ...previous('1-3'), month: 8 },
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
  });

  it('usa equipe especial configurada por Lucas, sem herdar extras do checklist', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      previous('1-1', [{ role: 'RAKE_WORKER', employeeKey: '1-3' }]),
    ]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      { vehicleId: 'v1', assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-2' }] },
    ]);
    prisma.totvsEmployeeCostAggregate.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', totalGeneralLine: '100', officialCostEligible: true, syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
      { employeeKey: '1-2', totalGeneralLine: '50', officialCostEligible: true, syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
    ]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', employmentStatus: 'A' },
      { employeeKey: '1-2', employmentStatus: 'A' },
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '150.000000', inheritedVehicleCount: 1, employeeCount: 2,
    });
    const costCalls = prisma.totvsEmployeeCostAggregate.findMany.mock.calls as unknown as Array<[
      { where: { employeeKey: { in: string[] } } },
    ]>;
    const costQuery = costCalls[0][0];
    expect(costQuery.where.employeeKey.in).toEqual(['1-1', '1-2']);
  });

  it('nao presume equipe especial a partir do checklist antigo', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      previous('1-1', [{ role: 'RAKE_WORKER', employeeKey: '1-2' }]),
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', isPartial: true, missingLinkVehicleCount: 1,
      missingLinks: [{ source: 'LUCAS', reason: 'MONTHLY_TEAM_NOT_CONFIGURED',
        responsibleName: 'Lucas (Apresentação Lucas)' }],
    });
  });

  it('aceita equipe vazia quando Lucas confirmou explicitamente o mes', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      { vehicleId: 'v1', assignments: [] },
    ]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({ laborActual: '100.000000', status: 'COMPLETE' });
  });

  it('nao soma equipe mensal de frota registrada como parada', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([{ ...current(null), vehicleStopped: true }]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      { vehicleId: 'v1', assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-2' }] },
    ]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0].laborActual).toBeNull();
    expect(result.groupLaborActuals[0].employeeCount).toBe(0);
    expect(result.groupLaborActuals[0].missingLinkVehicleCount).toBe(0);
  });

  it('mostra pendencia do checklist com responsavel e parcela conhecida da equipe', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.fleetResultMonthlyWorkforce.findMany.mockResolvedValueOnce([
      { vehicleId: 'v1', assignments: [{ role: 'RAKE_WORKER', employeeKey: '1-1' }] },
    ]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', isPartial: true, missingLinkVehicleCount: 1,
      missingLinks: [{ source: 'CHECKLIST', reason: 'NO_CHECKLIST_HISTORY',
        responsibleName: 'Dioclesio' }],
    });
  });

  it('marca custo nao conciliado como provisorio sem esconde-lo', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.totvsEmployeeCostAggregate.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', totalGeneralLine: '100', officialCostEligible: false,
        syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
    ]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', isPartial: false, isProvisional: true,
    });
  });

  it('usa somente a fonte dedicada apos aprovacao integra', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.totvsFleetLaborApproval.findFirst.mockResolvedValueOnce({
      id: 'approval-1', rowCount: 1, sourceHash: 'hash', totalCost: '123.45',
      syncRun: { status: 'STAGED', sourceHash: 'hash', queryCode: 'IND.BI.0039',
        ruleVersion: 'IND.BI.0025_INTEGRAL_V1' },
    });
    prisma.totvsFleetLaborCost.count.mockResolvedValue(1);
    prisma.totvsFleetLaborCost.aggregate.mockResolvedValueOnce({
      _sum: { totalGeneralIntegral: { equals: (value: unknown) => value === '123.45' } },
    });
    prisma.totvsFleetLaborCost.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', totalGeneralIntegral: '123.45' },
    ]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '123.450000', isPartial: false, isProvisional: false,
      costSource: 'OFFICIAL_DEDICATED', costStatus: 'OFFICIAL',
    });
    expect(prisma.totvsEmployeeCostAggregate.findMany).not.toHaveBeenCalled();
  });

  it('falha fechado se a aprovacao dedicada perder linhas correntes', async () => {
    const prisma = setup();
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]);
    prisma.totvsFleetLaborApproval.findFirst.mockResolvedValueOnce({
      id: 'approval-1', rowCount: 2, sourceHash: 'hash', totalCost: '123.45',
      syncRun: { status: 'STAGED', sourceHash: 'hash', queryCode: 'IND.BI.0039',
        ruleVersion: 'IND.BI.0025_INTEGRAL_V1' },
    });
    prisma.totvsFleetLaborCost.count.mockResolvedValue(1);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: null, isPartial: true,
      costSource: 'DEDICATED_INTEGRITY_ERROR', costStatus: 'SOURCE_INTEGRITY_ERROR',
    });
    expect(prisma.totvsEmployeeCostAggregate.findMany).not.toHaveBeenCalled();
  });

  it('mostra o subtotal de uma frota mesmo que outra do grupo nunca tenha checklist', async () => {
    const prisma = setup();
    jest.mocked(getLucasFleetRosterMonth).mockResolvedValue({ rows: [
      { id: 'v1', fleet: '101', name: 'Carro 101', subgroup: 'CARROS FROTA JR', active: true },
      { id: 'v2', fleet: '102', name: 'Carro 102', subgroup: 'CARROS FROTA JR', active: true },
    ] } as never);
    prisma.vehicle.findMany.mockResolvedValueOnce([
      { id: 'v1', checklistEnabled: true, monthlyChecklistResponsible: { name: 'Silvio' } },
      { id: 'v2', checklistEnabled: true, monthlyChecklistResponsible: { name: 'Hilario' } },
    ]);
    prisma.checklist.findMany.mockResolvedValueOnce([current('1-1')]).mockResolvedValueOnce([]);
    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');
    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '100.000000', isPartial: true, missingLinkVehicleCount: 1,
      missingLinks: [{ vehicleId: 'v2', fleet: '102', responsibleName: 'Hilario' }],
    });
  });
});
