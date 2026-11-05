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
    vehicle: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', checklistEnabled: true }]) },
    checklist: { findMany: jest.fn() },
    totvsEmployeeCostAggregate: { findMany: jest.fn().mockResolvedValue([
      { employeeKey: '1-1', totalGeneralLine: '100',
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
    expect(prisma.totvsEmployeeSnapshot.findMany).not.toHaveBeenCalled();
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

  it('herda equipe especial somente quando o ultimo checklist tem lista estruturada', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      previous('1-1', [{ role: 'RAKE_WORKER', employeeKey: '1-2' }]),
    ]);
    prisma.totvsEmployeeCostAggregate.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', totalGeneralLine: '100', syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
      { employeeKey: '1-2', totalGeneralLine: '50', syncRun: { status: 'SUCCEEDED', rejectedRows: 0 } },
    ]);
    prisma.totvsEmployeeSnapshot.findMany.mockResolvedValueOnce([
      { employeeKey: '1-1', employmentStatus: 'A' },
      { employeeKey: '1-2', employmentStatus: 'A' },
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0]).toMatchObject({
      laborActual: '150.000000', inheritedVehicleCount: 1, employeeCount: 2,
    });
  });

  it('nao presume equipe especial de um checklist antigo sem lista', async () => {
    const prisma = setup('VIBRO ACABADORAS');
    prisma.checklist.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      previous('1-1', null),
    ]);

    const result = await getLucasFleetGroupLaborActuals(prisma as unknown as PrismaService, '2026-10');

    expect(result.groupLaborActuals[0].laborActual).toBeNull();
  });
});
