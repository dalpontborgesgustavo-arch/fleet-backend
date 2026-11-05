import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CostPurchasesService } from './cost-purchases.service';
import { LucasFleetRevenueSyncService } from '../aethos-integration/lucas-fleet-revenue-sync.service';
import { getLucasFleetGroupLaborActuals } from './lucas-fleet-labor-actuals';
import { calculateMonthlyKm } from './lucas-fleet-monthly-km';

const READ_ROLES = new Set([
  'admin',
  'administrador',
  'licitacao_gestor',
  'licitacao',
  'gestor',
  'ceo',
]);
const LABOR_COST_ROLES = new Set(['admin', 'administrador', 'ceo']);

export function canReadFleetLaborCost(user: { role?: string; sub?: string }) {
  if (LABOR_COST_ROLES.has(String(user.role || '').trim().toLowerCase())) return true;
  const explicitIds = String(process.env.LUCAS_FLEET_LABOR_VIEWER_USER_IDS || '')
    .split(',').map((id) => id.trim()).filter(Boolean);
  return Boolean(user.sub && explicitIds.includes(String(user.sub)));
}

// Group totals for one or two workers disclose individual payroll by inference.
// This endpoint deliberately has no overall labor total from which a suppressed
// group's value could be reconstructed by subtraction.
export function suppressSmallLaborGroups<T extends {
  laborActual: string | null;
  valuedEmployeeCount: number;
  costStatus: string;
}>(groups: T[], canReadCost = false) {
  return groups.map((group) => {
    if (!canReadCost && group.laborActual !== null) {
      return { ...group, laborActual: null, costStatus: 'ACCESS_RESTRICTED',
        privacySuppressed: true };
    }
    const privacySuppressed = group.laborActual !== null &&
      group.valuedEmployeeCount < 3;
    return privacySuppressed
      ? { ...group, laborActual: null, costStatus: 'PRIVACY_SUPPRESSED',
        privacySuppressed: true }
      : { ...group, privacySuppressed: false };
  });
}

@UseGuards(JwtGuard)
@Controller('lucas-fleet-results/actuals')
export class LucasFleetActualsController {
  constructor(
    private readonly purchases: CostPurchasesService,
    private readonly prisma: PrismaService,
    private readonly revenues: LucasFleetRevenueSyncService,
  ) {}

  @Get()
  async findMonth(@Req() req: any, @Query('competence') competence?: string) {
    if (
      !READ_ROLES.has(
        String(req.user?.role ?? '')
          .trim()
          .toLowerCase(),
      )
    ) {
      throw new ForbiddenException(
        'Sem permissao para acessar os resultados da frota.',
      );
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(competence ?? ''))) {
      throw new BadRequestException(
        'Competencia deve estar no formato AAAA-MM.',
      );
    }
    const month = new Date(`${competence}-01T00:00:00.000Z`);
    const [
      expenses,
      fuel,
      odometerFacts,
      dieselFacts,
      mappedVehicles,
      revenue,
      labor,
    ] = await Promise.all([
      this.prisma.costPurchaseVehicleExpenseFact.groupBy({
        by: ['aethosVehicleId'],
        where: { competence: month, active: true },
        _count: { _all: true },
      }),
      this.prisma.costPurchaseVehicleFuelFact.groupBy({
        by: ['aethosVehicleId'],
        where: { competence: month, active: true },
        _count: { _all: true },
      }),
      this.prisma.costPurchaseVehicleFuelFact.findMany({
        where: {
          competence: month,
          active: true,
          usesHourMeter: false,
          initialKm: { gt: 0 },
          currentKm: { gt: 0 },
        },
        select: {
          aethosVehicleId: true,
          documentDate: true,
          initialKm: true,
          currentKm: true,
        },
      }),
      this.prisma.costPurchaseVehicleFuelFact.groupBy({
        by: ['aethosVehicleId'],
        where: { competence: month, active: true, planAccountId: 37 },
        _sum: { fuelAmount: true },
      }),
      this.prisma.vehicle.findMany({
        where: { aethosVehicleId: { not: null } },
        select: { id: true, aethosVehicleId: true },
      }),
      this.revenues.monthActuals(month),
      getLucasFleetGroupLaborActuals(this.prisma, competence!),
    ]);
    const limitations = [
      'Custos e abastecimentos seguem a elegibilidade do relatorio mensal; o faturamento usa o vinculo do veiculo local com o Aethos.',
      'KM usa a diferenca entre a primeira e a ultima leitura valida de hodometro no mes; sem leituras suficientes ou consistentes, o valor fica indisponivel.',
      'Horas trabalhadas somam somente intervalos validos de horimetro aceitos pelo relatorio Custos Compras; sem leitura valida, o valor e null.',
      'fuelTotal soma todos os combustiveis dos abastecimentos; dieselActual soma somente fatos da conta 37 e fica null sem fatos dessa conta.',
      'maintenance segue o relatorio Custos Compras: despesas do veiculo menos abastecimentos.',
      revenue.coverage
        ? 'Faturamento realizado usa a fonte Receita Total do Power BI Frota, publicada por snapshot finalizado e reconciliado.'
        : 'Faturamento realizado fica null enquanto nao houver snapshot finalizado e reconciliado cobrindo a competencia.',
      'Mao de obra realizada soma apenas custos TOTVS conhecidos dos vinculos validos. Quando faltam vinculos ou custos, o subtotal aparece como parcial; sem nenhum custo conhecido, fica indisponivel. Custos TOTVS nao conciliados sao provisórios.',
    ];
    const mappedAethosIds = new Set(
      mappedVehicles.map((vehicle) => String(vehicle.aethosVehicleId)),
    );
    const unmappedRevenue = revenue.rows.filter(
      (row) => !mappedAethosIds.has(String(row.aethosVehicleId)),
    );
    if (unmappedRevenue.length) {
      limitations.push(
        `${unmappedRevenue.length} veiculo(s) com faturamento no Aethos ainda nao possuem vinculo com o cadastro JR; esses valores nao entram nos grupos da previa.`,
      );
    }
    const publicLaborGroups = suppressSmallLaborGroups(labor.groupLaborActuals,
      canReadFleetLaborCost(req.user || {}));
    if (expenses.length === 0 && fuel.length === 0 && !revenue.coverage) {
      return {
        competence,
        rows: [],
        groupLaborActuals: publicLaborGroups,
        source: 'COST_PURCHASES_AND_FLEET_REVENUE_PBI',
        coverage: { revenue: revenue.coverage, labor: labor.coverage },
        limitations,
      };
    }
    const result =
      expenses.length || fuel.length
        ? await this.purchases.report(
            { competence },
            { skipLaborPool: true, includeRented: true, unpaginated: true },
          )
        : { rows: [] };
    const expenseIds = new Set(expenses.map((row) => row.aethosVehicleId));
    const fuelIds = new Set(fuel.map((row) => row.aethosVehicleId));
    const dieselByVehicle = new Map(
      dieselFacts.map((row) => [
        row.aethosVehicleId,
        row._sum.fuelAmount === null ? null : Number(row._sum.fuelAmount),
      ]),
    );
    const revenueByAethosVehicle = new Map(
      revenue.rows.map(
        (row) =>
          [String(row.aethosVehicleId), Number(row.revenueActual)] as const,
      ),
    );
    const { kmByVehicle, inconsistentVehicles } =
      calculateMonthlyKm(odometerFacts);
    if (inconsistentVehicles) {
      limitations.push(
        `${inconsistentVehicles} veiculo(s) com leituras de hodometro contraditorias ficaram sem KM ate revisao da origem.`,
      );
    }
    const rows = result.rows.map((row) => ({
      vehicleId: row.vehicleId,
      km: kmByVehicle.get(row.aethosVehicleId) ?? null,
      hours: row.hourMeterReadingCount > 0 ? Number(row.hourMeterHours) : null,
      maintenance: expenseIds.has(row.aethosVehicleId)
        ? Number(row.maintenance)
        : null,
      fuelTotal: fuelIds.has(row.aethosVehicleId)
        ? Number(row.fuelTotal)
        : null,
      dieselActual: dieselByVehicle.get(row.aethosVehicleId) ?? null,
      revenueActual: revenue.coverage
        ? (revenueByAethosVehicle.get(String(row.aethosVehicleId)) ?? 0)
        : null,
    }));
    const includedVehicleIds = new Set(rows.map((row) => row.vehicleId));
    for (const vehicle of mappedVehicles) {
      if (!vehicle.aethosVehicleId || includedVehicleIds.has(vehicle.id))
        continue;
      rows.push({
        vehicleId: vehicle.id,
        km: null,
        hours: null,
        maintenance: null,
        fuelTotal: null,
        dieselActual: null,
        revenueActual: revenue.coverage
          ? (revenueByAethosVehicle.get(String(vehicle.aethosVehicleId)) ?? 0)
          : null,
      });
    }
    return {
      competence,
      rows,
      groupLaborActuals: publicLaborGroups,
      source: 'COST_PURCHASES_AND_FLEET_REVENUE_PBI',
      coverage: { revenue: revenue.coverage, labor: labor.coverage },
      limitations,
    };
  }
}
