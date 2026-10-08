import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Filial, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TotvsFleetMaintenanceReferenceService } from '../aethos-integration/totvs-fleet-maintenance-reference.service';
import {
  calculateCostPurchaseRows,
  CostPurchaseVehicleAggregate,
  decimalString,
  normalizeIdentifier,
  COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
  COST_PURCHASE_MANAGERIAL_ENTRY_DATASET,
  COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
} from './cost-purchases.rules';

import {
  calculateManagerialMonth,
  COST_PURCHASE_MANAGERIAL_LINES,
  maintenanceIdentity,
  ManagerialCategory,
  managerialEntryIsEligible,
  managerialEntryCategories,
  managerialMemoryFormula,
} from './cost-purchases-managerial.rules';
import {
  calculateCostPurchaseCompetence,
  CostPurchaseLaborLine,
  serializeCostPurchaseCompetenceLine,
} from './cost-purchases-competence.rules';
import type { CostPurchasesPresentationDetail } from './cost-purchases-presentation.dto';
import { setVehicleAuditContext } from '../vehicles/vehicle-audit-context';

const COST_PURCHASE_USINA_ASSETS = [
  {
    aethosVehicleId: 426,
    code: 'USI-2018',
    model: 'Usina Ciber Inova 1200',
  },
  {
    aethosVehicleId: 1324,
    code: 'USI-2025',
    model: 'Usina Lintec CSD 2500 - 160 TPH',
  },
] as const;

const ZERO = new Prisma.Decimal(0);

export type CostPurchaseReportQuery = {
  competence?: string;
  search?: string;
  type?: string;
  vehicleType?: string;
  page?: string;
  pageSize?: string;
};

export type CostPurchaseVehicleLaunchQuery = {
  competence?: string;
  aethosVehicleId?: string;
  kind?: string;
  page?: string;
  pageSize?: string;
};

export type CostPurchaseManagerialQuery = {
  year?: string;
  month?: string;
  code?: string;
  page?: string;
  pageSize?: string;
};

export type CostPurchaseCompetenceQuery = {
  competence?: string;
  lineNumber?: string;
};

function competenceDate(value?: string) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) {
    throw new BadRequestException('competence deve usar o formato AAAA-MM');
  }
  const date = new Date(`${text}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 7) !== text) {
    throw new BadRequestException('competence invalida');
  }
  return date;
}

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(
      `valor inteiro deve estar entre ${min} e ${max}`,
    );
  }
  return parsed;
}

function yearValue(value?: string) {
  return integer(value, new Date().getUTCFullYear(), 2025, 2100);
}

function monthId(date: Date) {
  return date.toISOString().slice(0, 7);
}

function scopeCoversMonth(
  run: { scopeDateFrom: Date; scopeDateTo: Date },
  month: Date,
) {
  const monthEnd = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  );
  return run.scopeDateFrom <= monthEnd && run.scopeDateTo >= month;
}

async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<TResult>,
) {
  const result = new Array<TResult>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        result[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return result;
}

function serializedRow(
  row: ReturnType<typeof calculateCostPurchaseRows>['rows'][number],
) {
  return {
    ...row,
    expenseGeneral: decimalString(row.expenseGeneral),
    expenseTotal: decimalString(row.expenseTotal),
    fuelTotal: decimalString(row.fuelTotal),
    maintenance: decimalString(row.maintenance),
    liters: decimalString(row.liters, 3),
    km: decimalString(row.km, 2),
    averageKmPerLiter: decimalString(row.averageKmPerLiter, 3),
    desiredAverage: decimalString(row.desiredAverage, 3),
    expensePerKm: decimalString(row.expensePerKm, 4),
    allocatedAmount: decimalString(row.allocatedAmount),
  };
}

type PresentationDetailVehicle = ReturnType<
  typeof calculateCostPurchaseRows
>['rows'][number];

type PresentationDetailExpenseFact = {
  id: string;
  sourceRecordId: string;
  aethosVehicleId: number;
  documentDate: Date | null;
  documentNumber: string | null;
  amount: Prisma.Decimal;
};

type PresentationDetailFuelFact = {
  id: string;
  sourceRecordId: string;
  aethosVehicleId: number;
  documentDate: Date | null;
  fuelAmount: Prisma.Decimal;
  liters: Prisma.Decimal;
  initialKm: Prisma.Decimal | null;
  currentKm: Prisma.Decimal | null;
  usesHourMeter: boolean | null;
};

type PresentationDetailInternalFact = {
  id: string;
  sourceRecordId: string;
  documentDate: Date;
  documentNumber: string | null;
  assetCode: string | null;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  amount: Prisma.Decimal;
};

const PRESENTATION_FUEL_LINES = new Set([31, 46, 63, 77, 78, 117, 119]);
const PRESENTATION_LITER_LINES = new Set([36, 51, 68, 85, 86]);
const PRESENTATION_DIRECT_EXPENSE_LINES = new Set([14, 17]);
const PRESENTATION_MAINTENANCE_LINES = new Set([
  32, 47, 64, 79, 80, 81, 118, 120,
]);
const PRESENTATION_ALLOCATION_LINES = new Set([33, 48, 65, 82]);
const PRESENTATION_TOTAL_VEHICLE_LINES = new Set([34, 49, 66, 83, 121]);
const PRESENTATION_QUANTITY_LINES = new Set([37, 52, 69, 87, 88, 89, 90]);
const PRESENTATION_USAGE_LINES = new Set([18, 19, 20, 21]);
const PRESENTATION_AVERAGE_LINES = new Set([
  40, 41, 42, 43, 56, 57, 58, 59, 60, 72, 73, 74, 93, 94, 95, 96, 97, 98, 99,
]);
const PRESENTATION_LABOR_LINES = new Set([9, 10, 11, 12, 26]);
const PRESENTATION_FIXED_LINES = new Set([15, 16]);
const PRESENTATION_COMPONENT_TOTALS = new Map<number, number[]>([
  [22, [9, 10, 11, 12, 14, 15, 16, 17]],
  [28, [26, 27]],
]);

function dateLabel(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function detailText(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return dateLabel(value);
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    typeof value !== 'boolean'
  ) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function makePresentationDetail(
  title: string,
  description: string,
  columns: CostPurchasesPresentationDetail['columns'],
  rows: CostPurchasesPresentationDetail['rows'],
): CostPurchasesPresentationDetail {
  return {
    title,
    description,
    columns,
    rows,
    emptyMessage: 'Nenhum lançamento encontrado para esta competência.',
  };
}

function vehicleDetailValues(vehicle: PresentationDetailVehicle) {
  return {
    fleet: detailText(vehicle.fleet),
    plate: detailText(vehicle.plate),
    model: detailText(vehicle.model),
    subgroup: detailText(vehicle.subgroup),
  };
}

function buildCompetenceLineDetail(input: {
  line: any;
  blockLines: any[];
  vehicles: PresentationDetailVehicle[];
  expenseFacts: PresentationDetailExpenseFact[];
  fuelFacts: PresentationDetailFuelFact[];
  internalFacts: PresentationDetailInternalFact[];
  laborLines: CostPurchaseLaborLine[];
}): CostPurchasesPresentationDetail {
  const { line } = input;
  const title = `${line.label} — composição`;
  const assetIds = new Set<number>(line.assetIds || []);
  const selectedVehicles = input.vehicles.filter((vehicle) =>
    assetIds.has(vehicle.aethosVehicleId),
  );
  const vehicleById = new Map(
    input.vehicles.map((vehicle) => [vehicle.aethosVehicleId, vehicle]),
  );
  const baseVehicleColumns: CostPurchasesPresentationDetail['columns'] = [
    { key: 'fleet', label: 'Frota', kind: 'TEXT' },
    { key: 'plate', label: 'Placa', kind: 'TEXT' },
    { key: 'model', label: 'Modelo', kind: 'TEXT' },
  ];

  if (PRESENTATION_LABOR_LINES.has(line.lineNumber)) {
    const labor = input.laborLines.find(
      (entry) => entry.lineNumber === line.lineNumber,
    );
    const rows =
      line.value === null || line.value === undefined
        ? []
        : [
            {
              id: `labor-${line.lineNumber}`,
              values: {
                description: 'Valor mensal consolidado da equipe',
                records: String(labor?.sourceRows || 0),
                amount: decimalString(line.value),
              },
            },
          ];
    return makePresentationDetail(
      title,
      'Resumo da mão de obra considerada no mês.',
      [
        { key: 'description', label: 'Composição', kind: 'TEXT' },
        { key: 'records', label: 'Registros considerados', kind: 'INTEGER' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      rows,
    );
  }

  const componentLineNumbers = PRESENTATION_COMPONENT_TOTALS.get(
    line.lineNumber,
  );
  if (componentLineNumbers) {
    const rows = input.blockLines
      .filter((candidate) =>
        componentLineNumbers.includes(candidate.lineNumber),
      )
      .map((candidate) => ({
        id: `component-${candidate.lineNumber}`,
        values: {
          description:
            candidate.lineNumber === 27
              ? 'Outras despesas de Suprimentos'
              : detailText(candidate.label),
          amount:
            candidate.value === null || candidate.value === undefined
              ? null
              : decimalString(candidate.value),
        },
      }));
    return makePresentationDetail(
      title,
      'Linhas que formam o total apresentado.',
      [
        { key: 'description', label: 'Composição', kind: 'TEXT' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      rows,
    );
  }

  if (
    PRESENTATION_FUEL_LINES.has(line.lineNumber) ||
    PRESENTATION_LITER_LINES.has(line.lineNumber)
  ) {
    const rows = input.fuelFacts
      .filter((fact) => assetIds.has(fact.aethosVehicleId))
      .map((fact) => {
        const vehicle = vehicleById.get(fact.aethosVehicleId);
        return {
          id: fact.id,
          values: {
            date: dateLabel(fact.documentDate),
            fleet: detailText(vehicle?.fleet),
            plate: detailText(vehicle?.plate),
            model: detailText(vehicle?.model),
            liters: decimalString(fact.liters, 3),
            amount: decimalString(fact.fuelAmount),
          },
        };
      });
    return makePresentationDetail(
      title,
      'Abastecimentos que formam o valor ou volume apresentado.',
      [
        { key: 'date', label: 'Data', kind: 'DATE' },
        ...baseVehicleColumns,
        { key: 'liters', label: 'Litros', kind: 'LITERS' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      rows,
    );
  }

  if (PRESENTATION_DIRECT_EXPENSE_LINES.has(line.lineNumber)) {
    const rows = input.expenseFacts
      .filter((fact) => assetIds.has(fact.aethosVehicleId))
      .map((fact) => {
        const vehicle = vehicleById.get(fact.aethosVehicleId);
        return {
          id: fact.id,
          values: {
            date: dateLabel(fact.documentDate),
            document: detailText(fact.documentNumber),
            fleet: detailText(vehicle?.fleet),
            plate: detailText(vehicle?.plate),
            model: detailText(vehicle?.model),
            amount: decimalString(fact.amount),
          },
        };
      });
    return makePresentationDetail(
      title,
      'Lançamentos de despesa considerados na linha.',
      [
        { key: 'date', label: 'Data', kind: 'DATE' },
        { key: 'document', label: 'Documento', kind: 'TEXT' },
        ...baseVehicleColumns,
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      rows,
    );
  }

  if (line.factKeys?.length) {
    const factKeys = new Set<string>(line.factKeys);
    const rows = input.internalFacts
      .filter((fact) => factKeys.has(fact.sourceRecordId))
      .map((fact) => ({
        id: fact.id,
        values: {
          date: dateLabel(fact.documentDate),
          document: detailText(fact.documentNumber),
          asset: detailText(fact.assetCode),
          quantity:
            fact.quantity === null ? null : decimalString(fact.quantity, 3),
          unit: detailText(fact.unit),
          amount: decimalString(fact.amount),
        },
      }));
    return makePresentationDetail(
      title,
      'Lançamentos considerados na linha.',
      [
        { key: 'date', label: 'Data', kind: 'DATE' },
        { key: 'document', label: 'Documento', kind: 'TEXT' },
        { key: 'asset', label: 'Ativo', kind: 'TEXT' },
        { key: 'quantity', label: 'Quantidade', kind: 'DECIMAL' },
        { key: 'unit', label: 'Unidade', kind: 'TEXT' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      rows,
    );
  }

  if (PRESENTATION_MAINTENANCE_LINES.has(line.lineNumber)) {
    return makePresentationDetail(
      title,
      'Composição da manutenção por veículo.',
      [
        ...baseVehicleColumns,
        { key: 'expense', label: 'Despesa total', kind: 'MONEY' },
        { key: 'fuel', label: 'Combustível', kind: 'MONEY' },
        { key: 'maintenance', label: 'Manutenção', kind: 'MONEY' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          expense: decimalString(vehicle.expenseTotal),
          fuel: decimalString(vehicle.fuelTotal),
          maintenance: decimalString(vehicle.maintenance),
        },
      })),
    );
  }

  if (PRESENTATION_ALLOCATION_LINES.has(line.lineNumber)) {
    return makePresentationDetail(
      title,
      'Rateio de mão de obra considerado para cada veículo.',
      [
        ...baseVehicleColumns,
        { key: 'allocation', label: 'Valor rateado', kind: 'MONEY' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          allocation: decimalString(vehicle.allocatedAmount),
        },
      })),
    );
  }

  if (PRESENTATION_TOTAL_VEHICLE_LINES.has(line.lineNumber)) {
    return makePresentationDetail(
      title,
      'Composição do total por veículo.',
      [
        ...baseVehicleColumns,
        { key: 'fuel', label: 'Combustível', kind: 'MONEY' },
        { key: 'maintenance', label: 'Manutenção', kind: 'MONEY' },
        { key: 'allocation', label: 'Mão de obra', kind: 'MONEY' },
        { key: 'total', label: 'Total', kind: 'MONEY' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          fuel: decimalString(vehicle.fuelTotal),
          maintenance: decimalString(vehicle.maintenance),
          allocation: decimalString(vehicle.allocatedAmount),
          total: decimalString(
            vehicle.fuelTotal
              .plus(vehicle.maintenance)
              .plus(vehicle.allocatedAmount),
          ),
        },
      })),
    );
  }

  if (PRESENTATION_QUANTITY_LINES.has(line.lineNumber)) {
    return makePresentationDetail(
      title,
      'Veículos que formam a quantidade apresentada.',
      [
        ...baseVehicleColumns,
        { key: 'subgroup', label: 'Subgrupo', kind: 'TEXT' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: vehicleDetailValues(vehicle),
      })),
    );
  }

  if (PRESENTATION_FIXED_LINES.has(line.lineNumber)) {
    const valuePerVehicle = selectedVehicles.length
      ? new Prisma.Decimal(line.value || 0).div(selectedVehicles.length)
      : null;
    return makePresentationDetail(
      title,
      'Veículos considerados no valor mensal.',
      [
        ...baseVehicleColumns,
        { key: 'amount', label: 'Valor considerado', kind: 'MONEY' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          amount: valuePerVehicle ? decimalString(valuePerVehicle) : null,
        },
      })),
    );
  }

  if (PRESENTATION_USAGE_LINES.has(line.lineNumber)) {
    return makePresentationDetail(
      title,
      'Veículos e quilometragem considerados na linha.',
      [
        ...baseVehicleColumns,
        { key: 'usage', label: 'Quilômetros', kind: 'USAGE' },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          usage: decimalString(vehicle.km, 2),
        },
      })),
    );
  }

  if (PRESENTATION_AVERAGE_LINES.has(line.lineNumber)) {
    const usesHours = line.kind === 'LITERS_PER_HOUR';
    return makePresentationDetail(
      title,
      usesHours
        ? 'Consumo por veículo calculado com horas trabalhadas.'
        : 'Consumo por veículo calculado com quilômetros rodados.',
      [
        ...baseVehicleColumns,
        { key: 'liters', label: 'Litros', kind: 'LITERS' },
        {
          key: 'usage',
          label: usesHours ? 'Horas' : 'Quilômetros',
          kind: usesHours ? 'DECIMAL' : 'USAGE',
        },
        {
          key: 'average',
          label: usesHours ? 'Consumo (L/h)' : 'Média (km/L)',
          kind: 'AVERAGE',
        },
      ],
      selectedVehicles.map((vehicle) => ({
        id: vehicle.vehicleId,
        values: {
          ...vehicleDetailValues(vehicle),
          liters: decimalString(
            usesHours ? vehicle.hourMeterLiters : vehicle.liters,
            3,
          ),
          usage: decimalString(
            usesHours ? vehicle.hourMeterHours : vehicle.km,
            2,
          ),
          average: decimalString(
            usesHours
              ? vehicle.averageLitersPerHour
              : vehicle.averageKmPerLiter,
            3,
          ),
        },
      })),
    );
  }

  return makePresentationDetail(
    title,
    'Composição disponível para a linha selecionada.',
    [...baseVehicleColumns, { key: 'amount', label: 'Valor', kind: 'MONEY' }],
    selectedVehicles.map((vehicle) => ({
      id: vehicle.vehicleId,
      values: {
        ...vehicleDetailValues(vehicle),
        amount: decimalString(line.value || ZERO),
      },
    })),
  );
}

function managerialCategoryLabel(category: string | null | undefined) {
  const labels: Record<string, string> = {
    CAL: 'Compras e entradas da Usina',
    OLEO_RESIVALE: 'Óleo para queima',
    ANTIADERENTE_REMOTIN: 'Antiaderente',
    CAP: 'CAP',
    RR: 'RR',
    SEMI_IMPRIMA: 'Semi-imprima',
    DIESEL: 'Diesel',
  };
  return labels[String(category || '')] || 'Lançamento';
}

function buildManagerialLineDetail(input: {
  code: string;
  label: string;
  value: string | null;
  monthValues: Record<string, string | null>;
  mappedEntryFacts: Array<{ fact: any; mapping: any }>;
  payableExpenseFacts: any[];
  gasolineFacts: any[];
  maintenanceRows: any[];
}): CostPurchasesPresentationDetail {
  const title = `${input.label} — composição`;
  if (input.code === 'TOTAL') {
    const monetaryLines = COST_PURCHASE_MANAGERIAL_LINES.filter(
      (line) => line.kind === 'MONEY' && line.code !== 'TOTAL',
    );
    return makePresentationDetail(
      title,
      'Contas que formam o total geral do mês.',
      [
        { key: 'description', label: 'Conta', kind: 'TEXT' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      monetaryLines.map((line) => ({
        id: `managerial-${line.code}`,
        values: {
          description: line.label,
          amount: input.monthValues[line.code],
        },
      })),
    );
  }

  if (input.code === 'MANUTENCAO') {
    return makePresentationDetail(
      title,
      'Composição da manutenção por veículo.',
      [
        { key: 'fleet', label: 'Frota', kind: 'TEXT' },
        { key: 'plate', label: 'Placa', kind: 'TEXT' },
        { key: 'model', label: 'Modelo', kind: 'TEXT' },
        { key: 'expense', label: 'Despesa total', kind: 'MONEY' },
        { key: 'fuel', label: 'Combustível', kind: 'MONEY' },
        { key: 'maintenance', label: 'Manutenção', kind: 'MONEY' },
      ],
      input.maintenanceRows.map((vehicle) => ({
        id: String(vehicle.vehicleId),
        values: {
          fleet: detailText(vehicle.fleet),
          plate: detailText(vehicle.plate),
          model: detailText(vehicle.model),
          expense: detailText(vehicle.expenseTotal),
          fuel: detailText(vehicle.fuelTotal),
          maintenance: detailText(vehicle.maintenance),
        },
      })),
    );
  }

  if (
    ['GASOLINA', 'GASOLINA_LITROS', 'GASOLINA_PRECO_MEDIO'].includes(input.code)
  ) {
    const vehicleById = new Map(
      input.maintenanceRows.map((vehicle) => [
        Number(vehicle.aethosVehicleId),
        vehicle,
      ]),
    );
    return makePresentationDetail(
      title,
      'Abastecimentos de gasolina considerados no mês.',
      [
        { key: 'date', label: 'Data', kind: 'DATE' },
        { key: 'fleet', label: 'Frota', kind: 'TEXT' },
        { key: 'plate', label: 'Placa', kind: 'TEXT' },
        { key: 'model', label: 'Modelo', kind: 'TEXT' },
        { key: 'liters', label: 'Litros', kind: 'LITERS' },
        { key: 'amount', label: 'Valor', kind: 'MONEY' },
      ],
      input.gasolineFacts.map((fact) => {
        const vehicle = vehicleById.get(Number(fact.aethosVehicleId));
        return {
          id: String(fact.sourceRecordId),
          values: {
            date: dateLabel(fact.documentDate),
            fleet: detailText(vehicle?.fleet),
            plate: detailText(vehicle?.plate),
            model: detailText(vehicle?.model),
            liters: decimalString(fact.liters, 3),
            amount: decimalString(fact.fuelAmount),
          },
        };
      }),
    );
  }

  const categories = new Set(managerialEntryCategories(input.code));
  const entryRows = input.mappedEntryFacts
    .filter((entry) => categories.has(entry.mapping?.category))
    .map(({ fact, mapping }) => ({
      id: String(fact.sourceRecordId),
      values: {
        date: dateLabel(fact.documentDate),
        document: detailText(fact.documentNumber),
        description: managerialCategoryLabel(mapping?.category),
        quantity:
          fact.quantity === null ? null : decimalString(fact.quantity, 3),
        unit: detailText(fact.unit),
        amount: decimalString(fact.totalValue),
      },
    }));
  const payableRows =
    input.code === 'USINA'
      ? input.payableExpenseFacts.map((fact) => ({
          id: String(fact.sourceRecordId),
          values: {
            date: dateLabel(fact.occurredDate),
            document: detailText(
              fact.sourceDocumentId || fact.sourceNoteNumber,
            ),
            description:
              detailText(fact.accountPlanDescription) || 'Despesa da Usina',
            quantity: null,
            unit: null,
            amount: decimalString(fact.amount),
          },
        }))
      : [];
  return makePresentationDetail(
    title,
    'Lançamentos que formam o indicador apresentado.',
    [
      { key: 'date', label: 'Data', kind: 'DATE' },
      { key: 'document', label: 'Documento', kind: 'TEXT' },
      { key: 'description', label: 'Descrição', kind: 'TEXT' },
      { key: 'quantity', label: 'Quantidade', kind: 'DECIMAL' },
      { key: 'unit', label: 'Unidade', kind: 'TEXT' },
      { key: 'amount', label: 'Valor', kind: 'MONEY' },
    ],
    [...entryRows, ...payableRows],
  );
}

@Injectable()
export class CostPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totvsReference: TotvsFleetMaintenanceReferenceService,
  ) {}

  async vehicleSettings() {
    const vehicles = await this.prisma.vehicle.findMany({
      select: {
        id: true,
        fleet: true,
        plate: true,
        name: true,
        model: true,
        active: true,
        group: true,
        subgroup: true,
        company: true,
        tipoFrota: true,
        vehicleType: true,
        filial: true,
        keepMonthlyCostReport: true,
        veiculoManutencao: true,
        costPurchaseProfiles: {
          orderBy: { effectiveFrom: 'desc' },
          take: 24,
          select: {
            id: true,
            effectiveFrom: true,
            provenance: true,
            group: true,
            subgroup: true,
            company: true,
            tipoFrota: true,
            vehicleType: true,
            filial: true,
            keepMonthlyCostReport: true,
            veiculoManutencao: true,
            changedByName: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ fleet: 'asc' }, { plate: 'asc' }],
    });

    const optionValues = (field: 'group' | 'subgroup' | 'company') =>
      [
        ...new Set(
          vehicles
            .map((vehicle) => vehicle[field]?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((left, right) => left.localeCompare(right, 'pt-BR'));

    const rows = vehicles.map((vehicle) => {
      const missingFields = [
        !vehicle.group?.trim() ? 'Grupo' : null,
        !vehicle.subgroup?.trim() ? 'Subgrupo' : null,
        !vehicle.company?.trim() ? 'Empresa' : null,
        !vehicle.tipoFrota?.trim() ||
        normalizeIdentifier(vehicle.tipoFrota) === 'NAOCLASSIFICADO'
          ? 'Tipo de frota'
          : null,
        !vehicle.filial?.trim() ||
        normalizeIdentifier(vehicle.filial) === 'NAOCLASSIFICADA'
          ? 'Filial'
          : null,
      ].filter((value): value is string => Boolean(value));

      return {
        ...vehicle,
        costPurchaseProfiles: undefined,
        history: vehicle.costPurchaseProfiles.map((profile) => ({
          ...profile,
          id: profile.id.toString(),
          competence: profile.effectiveFrom.toISOString().slice(0, 7),
          effectiveFrom: profile.effectiveFrom.toISOString().slice(0, 10),
          updatedAt: profile.updatedAt.toISOString(),
        })),
        latestEffectiveFrom:
          vehicle.costPurchaseProfiles[0]?.effectiveFrom
            .toISOString()
            .slice(0, 7) || null,
        completeForPresentation: missingFields.length === 0,
        missingFields,
      };
    });

    return {
      rows,
      summary: {
        vehicles: rows.length,
        included: rows.filter((row) => row.keepMonthlyCostReport).length,
        excluded: rows.filter((row) => !row.keepMonthlyCostReport).length,
        incomplete: rows.filter((row) => !row.completeForPresentation).length,
      },
      options: {
        groups: optionValues('group'),
        subgroups: optionValues('subgroup'),
        companies: optionValues('company'),
      },
    };
  }

  async updateVehicleSettings(
    id: string,
    input: unknown,
    actor?: { id?: string | null; name?: string | null; email?: string | null },
  ) {
    const body =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const existing = await this.prisma.vehicle.findUnique({
      where: { id },
      select: {
        id: true,
        group: true,
        subgroup: true,
        company: true,
        tipoFrota: true,
        vehicleType: true,
        filial: true,
        keepMonthlyCostReport: true,
        veiculoManutencao: true,
      },
    });
    if (!existing) throw new NotFoundException('Veículo não encontrado.');

    const textOrNull = (field: string) => {
      const value = body[field];
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string') {
        throw new BadRequestException(`${field} inválido.`);
      }
      return value.trim() || null;
    };
    const requiredBoolean = (field: string) => {
      if (typeof body[field] !== 'boolean') {
        throw new BadRequestException(`${field} deve ser verdadeiro ou falso.`);
      }
      return body[field] as boolean;
    };

    const effectiveFrom = competenceDate(textOrNull('effectiveFrom') || '');
    const effectiveYear = effectiveFrom.getUTCFullYear();
    if (effectiveYear < 2020 || effectiveYear > 2100) {
      throw new BadRequestException(
        'A competência deve estar entre 2020 e 2100.',
      );
    }
    const tipoFrota = textOrNull('tipoFrota');
    const filial = textOrNull('filial');
    const allowedFleetTypes = new Set([
      'Terraplanagem',
      'Caminhões',
      'Asfalto',
      'Veiculos',
    ]);
    const allowedBranches = new Set(['MATRIZ', 'NORTE', 'MAFRA', 'PEDRAFORTE']);
    if (!tipoFrota || !allowedFleetTypes.has(tipoFrota)) {
      throw new BadRequestException('Selecione um tipo de frota válido.');
    }
    if (!filial || !allowedBranches.has(filial)) {
      throw new BadRequestException('Selecione uma filial válida.');
    }
    const vehicleTypeByFleetType: Record<string, string> = {
      Terraplanagem: 'equipamento',
      Caminhões: 'caminhao',
      Asfalto: 'asfalto',
      Veiculos: 'veiculos',
    };
    const data = {
      group: textOrNull('group'),
      subgroup: textOrNull('subgroup'),
      company: textOrNull('company'),
      tipoFrota,
      vehicleType: vehicleTypeByFleetType[tipoFrota],
      filial: filial as Filial,
      keepMonthlyCostReport: requiredBoolean('keepMonthlyCostReport'),
      veiculoManutencao: requiredBoolean('veiculoManutencao'),
    };

    return this.prisma.$transaction(async (transaction) => {
      await setVehicleAuditContext(transaction, {
        source: 'MANUAL',
        userId: actor?.id,
        name: actor?.name,
        email: actor?.email,
      });

      const firstProfile =
        await transaction.costPurchaseVehicleProfile.findFirst({
          where: { vehicleId: id },
          select: { id: true },
        });
      if (!firstProfile) {
        await transaction.costPurchaseVehicleProfile.create({
          data: {
            vehicleId: id,
            effectiveFrom: new Date('1900-01-01T00:00:00.000Z'),
            provenance: 'INFERRED_CURRENT_BASELINE',
            group: existing.group,
            subgroup: existing.subgroup,
            company: existing.company,
            tipoFrota: existing.tipoFrota,
            vehicleType: existing.vehicleType,
            filial: existing.filial,
            keepMonthlyCostReport: existing.keepMonthlyCostReport,
            veiculoManutencao: existing.veiculoManutencao,
            changedByUserId: actor?.id,
            changedByName: actor?.name,
            changedByEmail: actor?.email,
          },
        });
      }

      await transaction.costPurchaseVehicleProfile.upsert({
        where: {
          vehicleId_effectiveFrom: { vehicleId: id, effectiveFrom },
        },
        create: {
          vehicleId: id,
          effectiveFrom,
          provenance: 'USER_CONFIRMED',
          ...data,
          changedByUserId: actor?.id,
          changedByName: actor?.name,
          changedByEmail: actor?.email,
        },
        update: {
          provenance: 'USER_CONFIRMED',
          ...data,
          changedByUserId: actor?.id,
          changedByName: actor?.name,
          changedByEmail: actor?.email,
        },
      });

      const latest =
        await transaction.costPurchaseVehicleProfile.findFirstOrThrow({
          where: { vehicleId: id },
          orderBy: { effectiveFrom: 'desc' },
        });
      await transaction.vehicle.update({
        where: { id },
        data: {
          group: latest.group,
          subgroup: latest.subgroup,
          company: latest.company,
          tipoFrota: latest.tipoFrota,
          vehicleType: latest.vehicleType,
          filial: latest.filial,
          keepMonthlyCostReport: latest.keepMonthlyCostReport,
          veiculoManutencao: latest.veiculoManutencao,
        },
      });
      return {
        vehicleId: id,
        effectiveFrom: effectiveFrom.toISOString().slice(0, 7),
      };
    });
  }

  private async resolveCompetenceLaborLines(
    competence: Date,
    nextMonth: Date,
  ): Promise<{
    lines: CostPurchaseLaborLine[];
    sourceAvailable: boolean;
    errorCode: string | null;
  }> {
    const dateFrom = competence.toISOString().slice(0, 10);
    const dateTo = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    try {
      const source = await this.totvsReference.competenceLaborLines(
        dateFrom,
        dateTo,
      );
      const lines = ([9, 10, 11, 12, 26] as const).map((lineNumber) => {
        const match = source.find((entry) => entry.lineNumber === lineNumber);
        return {
          lineNumber,
          value: new Prisma.Decimal(match?.amount || 0),
          sourceRows: match?.sourceRowCount || 0,
        };
      });
      return { lines, sourceAvailable: true, errorCode: null };
    } catch {
      return {
        lines: ([9, 10, 11, 12, 26] as const).map((lineNumber) => ({
          lineNumber,
          value: null,
          sourceRows: 0,
        })),
        sourceAvailable: false,
        errorCode: 'TOTVS_ONLINE_UNAVAILABLE',
      };
    }
  }

  private async resolveLaborPool(competence: Date, nextMonth: Date) {
    const competenceIso = competence.toISOString().slice(0, 10);
    const lastDay = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const retrievedAt = new Date();
    try {
      const reference = await this.totvsReference.reference(
        competenceIso,
        lastDay,
      );
      const pool = reference.laborPools.find(
        (entry) => entry.competence === competenceIso,
      );
      return {
        amount: new Prisma.Decimal(pool?.eligibleLaborPoolAmount || 0),
        memory: {
          fonteTotvs: 'TOTVS_ONLINE_IND.BI.0035',
          competence: competenceIso,
          retrievedAt: retrievedAt.toISOString(),
          sourceGeneratedAt: reference.sourceGeneratedAt,
          authoritativeEligibilityField:
            reference.authoritativeEligibilityField,
          sourceRows: pool?.sourceRowCount || 0,
          fallbackUsed: false,
          fallbackReason: null,
        },
      };
    } catch {
      const rows =
        await this.prisma.usinaFleetMaintenanceLaborAllocation.findMany({
          where: { competence, active: true },
          orderBy: { syncedAt: 'desc' },
          select: {
            eligibleLaborPoolAmount: true,
            sourceSentence: true,
            sourceGeneratedAt: true,
            syncedAt: true,
          },
        });
      const amount = rows.reduce(
        (maximum, row) =>
          row.eligibleLaborPoolAmount.gt(maximum)
            ? row.eligibleLaborPoolAmount
            : maximum,
        ZERO,
      );
      return {
        amount,
        memory: {
          fonteTotvs: 'JR_SNAPSHOT_FALLBACK',
          competence: competenceIso,
          retrievedAt: retrievedAt.toISOString(),
          sourceGeneratedAt: rows[0]?.sourceGeneratedAt?.toISOString() || null,
          authoritativeEligibilityField: rows[0]?.sourceSentence || null,
          sourceRows: rows.length,
          fallbackUsed: true,
          fallbackReason: 'TOTVS_ONLINE_UNAVAILABLE',
        },
      };
    }
  }

  async competences() {
    const [expenses, fuel] = await Promise.all([
      this.prisma.costPurchaseVehicleExpenseFact.findMany({
        where: { active: true },
        distinct: ['competence'],
        orderBy: { competence: 'desc' },
        select: { competence: true },
      }),
      this.prisma.costPurchaseVehicleFuelFact.findMany({
        where: { active: true },
        distinct: ['competence'],
        orderBy: { competence: 'desc' },
        select: { competence: true },
      }),
    ]);
    return Array.from(
      new Set(
        [...expenses, ...fuel].map((entry) =>
          entry.competence.toISOString().slice(0, 7),
        ),
      ),
    ).sort((a, b) => b.localeCompare(a));
  }

  async vehicleLaunches(query: CostPurchaseVehicleLaunchQuery) {
    const competence = competenceDate(query.competence);
    const requestedCompetence = competence.toISOString().slice(0, 7);
    const aethosVehicleId = integer(query.aethosVehicleId, 0, 1, 2_147_483_647);
    const kind = String(query.kind || 'EXPENSE').toUpperCase();
    if (!['EXPENSE', 'FUEL'].includes(kind)) {
      throw new BadRequestException('kind deve ser EXPENSE ou FUEL');
    }
    const page = integer(query.page, 1, 1, 100_000);
    const pageSize = integer(query.pageSize, 25, 1, 100);
    const skip = (page - 1) * pageSize;
    const where = { competence, aethosVehicleId, active: true };

    const [expenseAggregate, expenseCount, fuelAggregate, fuelCount] =
      await Promise.all([
        this.prisma.costPurchaseVehicleExpenseFact.aggregate({
          where,
          _sum: { amount: true },
        }),
        this.prisma.costPurchaseVehicleExpenseFact.count({ where }),
        this.prisma.costPurchaseVehicleFuelFact.aggregate({
          where,
          _sum: { fuelAmount: true, liters: true },
        }),
        this.prisma.costPurchaseVehicleFuelFact.count({ where }),
      ]);

    const expenseTotal = expenseAggregate._sum.amount || ZERO;
    const fuelTotal = fuelAggregate._sum.fuelAmount || ZERO;
    const liters = fuelAggregate._sum.liters || ZERO;
    let rows: Array<Record<string, string | null>>;
    let total: number;

    if (kind === 'FUEL') {
      const fuelRows = await this.prisma.costPurchaseVehicleFuelFact.findMany({
        where,
        orderBy: [{ documentDate: 'desc' }, { sourceRecordId: 'asc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          documentDate: true,
          sourceRecordId: true,
          fuelAmount: true,
          liters: true,
          initialKm: true,
          currentKm: true,
          desiredAverage: true,
          syncedAt: true,
        },
      });
      total = fuelCount;
      rows = fuelRows.map((entry) => ({
        id: entry.id,
        kind: 'FUEL',
        documentDate: entry.documentDate?.toISOString().slice(0, 10) || null,
        documentNumber: null,
        sourceReference: entry.sourceRecordId,
        amount: decimalString(entry.fuelAmount),
        liters: decimalString(entry.liters, 3),
        initialKm:
          entry.initialKm === null ? null : decimalString(entry.initialKm, 2),
        currentKm:
          entry.currentKm === null ? null : decimalString(entry.currentKm, 2),
        desiredAverage:
          entry.desiredAverage === null
            ? null
            : decimalString(entry.desiredAverage, 3),
        syncedAt: entry.syncedAt.toISOString(),
      }));
    } else {
      const expenseRows =
        await this.prisma.costPurchaseVehicleExpenseFact.findMany({
          where,
          orderBy: [{ documentDate: 'desc' }, { sourceRecordId: 'asc' }],
          skip,
          take: pageSize,
          select: {
            id: true,
            documentDate: true,
            documentNumber: true,
            sourceRecordId: true,
            amount: true,
            desiredAverage: true,
            syncedAt: true,
          },
        });
      total = expenseCount;
      rows = expenseRows.map((entry) => ({
        id: entry.id,
        kind: 'EXPENSE',
        documentDate: entry.documentDate?.toISOString().slice(0, 10) || null,
        documentNumber: entry.documentNumber,
        sourceReference: entry.sourceRecordId,
        amount: decimalString(entry.amount),
        liters: null,
        initialKm: null,
        currentKm: null,
        desiredAverage:
          entry.desiredAverage === null
            ? null
            : decimalString(entry.desiredAverage, 3),
        syncedAt: entry.syncedAt.toISOString(),
      }));
    }

    return {
      competence: requestedCompetence,
      aethosVehicleId,
      kind,
      rows,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
      summary: {
        expenseCount,
        fuelCount,
        expenseTotal: decimalString(expenseTotal),
        fuelTotal: decimalString(fuelTotal),
        maintenance: decimalString(expenseTotal.minus(fuelTotal)),
        liters: decimalString(liters, 3),
      },
    };
  }

  async report(
    query: CostPurchaseReportQuery,
    options: {
      skipLaborPool?: boolean;
      includeRented?: boolean;
      unpaginated?: boolean;
      availableCompetences?: string[];
    } = {},
  ) {
    const availableCompetences =
      options.availableCompetences ?? (await this.competences());
    const requestedCompetence = query.competence || availableCompetences[0];
    if (!requestedCompetence) {
      return {
        competence: null,
        rows: [],
        pagination: { page: 1, pageSize: 50, total: 0, pages: 0 },
        filters: { types: [], vehicleTypes: [] },
        summary: {
          vehicles: 0,
          expenseGeneral: '0.00',
          expenseTotal: '0.00',
          fuelTotal: '0.00',
          maintenance: '0.00',
          liters: '0.000',
          km: '0.00',
          allocation: '0.00',
        },
        allocationMemory: null,
        availableCompetences,
      };
    }
    const competence = competenceDate(requestedCompetence);
    const page = integer(query.page, 1, 1, 100000);
    const pageSize = integer(query.pageSize, 50, 1, 250);
    const nextMonth = new Date(
      Date.UTC(competence.getUTCFullYear(), competence.getUTCMonth() + 1, 1),
    );

    const [expenses, fuel, exceptions, policy, laborPoolResolution, vehicles] =
      await Promise.all([
        this.prisma.costPurchaseVehicleExpenseFact.findMany({
          where: { competence, active: true },
          select: {
            aethosVehicleId: true,
            amount: true,
            desiredAverage: true,
          },
        }),
        this.prisma.costPurchaseVehicleFuelFact.findMany({
          where: { competence, active: true },
          select: {
            aethosVehicleId: true,
            fuelAmount: true,
            liters: true,
            initialKm: true,
            currentKm: true,
            usesHourMeter: true,
            sourceAverage: true,
            desiredAverage: true,
          },
        }),
        this.prisma.costPurchaseReportException.findMany({
          where: {
            active: true,
            deletedAt: null,
            validFrom: { lt: nextMonth },
            OR: [{ validTo: null }, { validTo: { gt: competence } }],
          },
          select: {
            identifierType: true,
            identifierValue: true,
            displayFleet: true,
            displayModel: true,
            displayType: true,
            includeInReport: true,
            includeInAllocation: true,
            rateGroup: true,
          },
        }),
        this.prisma.costPurchaseAllocationPolicy.findFirst({
          where: {
            active: true,
            validFrom: { lt: nextMonth },
            OR: [{ validTo: null }, { validTo: { gt: competence } }],
          },
          orderBy: { validFrom: 'desc' },
        }),
        options.skipLaborPool
          ? Promise.resolve({
              amount: ZERO,
              memory: {
                fonteTotvs: 'SKIPPED_FOR_MANAGERIAL_MAINTENANCE',
                competence: competence.toISOString().slice(0, 10),
                retrievedAt: new Date().toISOString(),
                sourceGeneratedAt: null,
                authoritativeEligibilityField: null,
                sourceRows: 0,
                fallbackUsed: false,
                fallbackReason: null,
              },
            })
          : this.resolveLaborPool(competence, nextMonth),
        this.prisma.vehicle.findMany({
          where: { aethosVehicleId: { not: null } },
          select: {
            id: true,
            aethosVehicleId: true,
            fleet: true,
            plate: true,
            model: true,
            type: true,
            vehicleType: true,
            tipoFrota: true,
            group: true,
            subgroup: true,
            company: true,
            filial: true,
            responsibleName: true,
            currentResponsibleName: true,
            active: true,
            keepMonthlyCostReport: true,
            veiculoManutencao: true,
            createdAt: true,
            costPurchaseProfiles: {
              where: { effectiveFrom: { lte: competence } },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
              select: {
                group: true,
                subgroup: true,
                company: true,
                tipoFrota: true,
                vehicleType: true,
                filial: true,
                keepMonthlyCostReport: true,
                veiculoManutencao: true,
              },
            },
            manutencaoHistorico: {
              where: { dtInicio: { lt: nextMonth } },
              orderBy: { dtInicio: 'desc' },
              take: 1,
              select: {
                veiculoManutencao: true,
                dtInicio: true,
                dtFim: true,
              },
            },
            aethosStatusHistory: {
              where: {
                changedAt: { lt: nextMonth },
                applicationStatus: 'APPLIED',
              },
              orderBy: { changedAt: 'asc' },
              select: {
                currentStatus: true,
                changedAt: true,
                effectiveEndAt: true,
              },
            },
          },
        }),
      ]);

    if (!policy) {
      throw new BadRequestException(
        `Politica de rateio nao configurada para ${requestedCompetence}`,
      );
    }

    const aggregates = new Map<number, CostPurchaseVehicleAggregate>();
    const aggregateFor = (aethosVehicleId: number) => {
      const existing = aggregates.get(aethosVehicleId);
      if (existing) return existing;
      const created: CostPurchaseVehicleAggregate = {
        expenseTotal: ZERO,
        fuelTotal: ZERO,
        liters: ZERO,
        initialKms: [],
        currentKms: [],
        hourMeterRateSum: ZERO,
        hourMeterReadingCount: 0,
        hourMeterHours: ZERO,
        hourMeterLiters: ZERO,
        desiredAverages: [],
      };
      aggregates.set(aethosVehicleId, created);
      return created;
    };
    for (const entry of expenses) {
      const aggregate = aggregateFor(entry.aethosVehicleId);
      aggregate.expenseTotal = aggregate.expenseTotal.plus(entry.amount);
      if (entry.desiredAverage)
        aggregate.desiredAverages.push(entry.desiredAverage);
    }
    const hourlyCandidates = new Map<
      number,
      Array<{
        rate: Prisma.Decimal;
        hours: Prisma.Decimal;
        liters: Prisma.Decimal;
      }>
    >();
    const hourMeterQuality = {
      fuelFacts: fuel.length,
      hourMeterFacts: 0,
      odometerFacts: 0,
      unknownType: 0,
      missingReading: 0,
      nonPositiveLiters: 0,
      nonPositiveDelta: 0,
      sourceAverageMismatch: 0,
      robustOutlier: 0,
      eligibleHourMeterFacts: 0,
    };
    for (const entry of fuel) {
      const aggregate = aggregateFor(entry.aethosVehicleId);
      aggregate.fuelTotal = aggregate.fuelTotal.plus(entry.fuelAmount);
      aggregate.liters = aggregate.liters.plus(entry.liters);
      if (entry.usesHourMeter === true) {
        hourMeterQuality.hourMeterFacts += 1;
        if (!entry.initialKm || !entry.currentKm) {
          hourMeterQuality.missingReading += 1;
        } else if (!entry.liters.gt(0)) {
          hourMeterQuality.nonPositiveLiters += 1;
        } else if (!entry.currentKm.gt(entry.initialKm)) {
          hourMeterQuality.nonPositiveDelta += 1;
        } else {
          const hours = entry.currentKm.minus(entry.initialKm);
          const rate = entry.liters.div(hours);
          const sourceMatches =
            !entry.sourceAverage ||
            rate
              .minus(entry.sourceAverage)
              .abs()
              .lte(new Prisma.Decimal('0.00001'));
          if (sourceMatches) {
            const candidates =
              hourlyCandidates.get(entry.aethosVehicleId) || [];
            candidates.push({ rate, hours, liters: entry.liters });
            hourlyCandidates.set(entry.aethosVehicleId, candidates);
          } else hourMeterQuality.sourceAverageMismatch += 1;
        }
      } else if (entry.usesHourMeter === false) {
        hourMeterQuality.odometerFacts += 1;
        if (entry.initialKm) aggregate.initialKms.push(entry.initialKm);
        if (entry.currentKm) aggregate.currentKms.push(entry.currentKm);
      } else hourMeterQuality.unknownType += 1;
      if (entry.desiredAverage)
        aggregate.desiredAverages.push(entry.desiredAverage);
    }
    for (const [aethosVehicleId, candidates] of hourlyCandidates) {
      const aggregate = aggregateFor(aethosVehicleId);
      const rates = candidates.map((candidate) => candidate.rate.toNumber());
      const sorted = [...rates].sort((left, right) => left - right);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      const deviations = rates
        .map((rate) => Math.abs(rate - median))
        .sort((left, right) => left - right);
      const mad = deviations[Math.floor(deviations.length / 2)] || 0;
      for (const candidate of candidates) {
        const numericRate = candidate.rate.toNumber();
        const ratio =
          median > 0 ? Math.max(numericRate / median, median / numericRate) : 1;
        const modifiedZ =
          mad > 0 ? (0.6745 * Math.abs(numericRate - median)) / mad : 0;
        const robustOutlier =
          candidates.length >= 5 && ratio > 5 && (mad === 0 || modifiedZ > 10);
        if (robustOutlier) {
          hourMeterQuality.robustOutlier += 1;
          continue;
        }
        aggregate.hourMeterRateSum = aggregate.hourMeterRateSum.plus(
          candidate.rate,
        );
        aggregate.hourMeterReadingCount += 1;
        aggregate.hourMeterHours = aggregate.hourMeterHours.plus(
          candidate.hours,
        );
        aggregate.hourMeterLiters = aggregate.hourMeterLiters.plus(
          candidate.liters,
        );
        hourMeterQuality.eligibleHourMeterFacts += 1;
      }
    }

    let maintenanceHistoryMatches = 0;
    let maintenanceCurrentFallbacks = 0;
    const vehiclesForRules = vehicles.map((vehicle) => {
      const inactiveEvent = vehicle.aethosStatusHistory.find((event) => {
        const status = normalizeIdentifier(event.currentStatus);
        return ['INATIVO', 'INACTIVE', 'I', 'BAIXADO'].includes(status);
      });
      const historicalMaintenance = vehicle.manutencaoHistorico[0];
      const costProfile = vehicle.costPurchaseProfiles[0];
      if (costProfile || historicalMaintenance) maintenanceHistoryMatches += 1;
      else maintenanceCurrentFallbacks += 1;
      return {
        ...vehicle,
        group: costProfile ? costProfile.group : vehicle.group,
        subgroup: costProfile ? costProfile.subgroup : vehicle.subgroup,
        company: costProfile ? costProfile.company : vehicle.company,
        tipoFrota: costProfile?.tipoFrota ?? vehicle.tipoFrota,
        vehicleType: costProfile?.vehicleType ?? vehicle.vehicleType,
        filial: costProfile?.filial ?? vehicle.filial,
        keepMonthlyCostReport:
          costProfile?.keepMonthlyCostReport ?? vehicle.keepMonthlyCostReport,
        veiculoManutencao:
          costProfile?.veiculoManutencao ??
          historicalMaintenance?.veiculoManutencao ??
          vehicle.veiculoManutencao,
        inactiveAt: inactiveEvent
          ? inactiveEvent.effectiveEndAt || inactiveEvent.changedAt
          : null,
      };
    });
    const calculated = calculateCostPurchaseRows({
      competence,
      vehicles: vehiclesForRules,
      aggregates,
      exceptions,
      policy,
      eligibleLaborPoolAmount: laborPoolResolution.amount,
      includeRented: options.includeRented,
    });

    const types = Array.from(
      new Set(calculated.rows.map((row) => row.type)),
    ).sort();
    const vehicleTypes = Array.from(
      new Set(calculated.rows.map((row) => row.vehicleType)),
    ).sort();
    const search = normalizeIdentifier(query.search);
    let filtered = calculated.rows.filter((row) => {
      if (query.type && row.type !== query.type) return false;
      if (query.vehicleType && row.vehicleType !== query.vehicleType)
        return false;
      if (!search) return true;
      return normalizeIdentifier(
        [row.fleet, row.plate, row.model, row.responsible, row.type].join(' '),
      ).includes(search);
    });
    filtered = filtered.sort((left, right) => {
      const typeComparison = left.type.localeCompare(right.type, 'pt-BR');
      if (typeComparison) return typeComparison;
      const leftNumber = Number(left.fleet);
      const rightNumber = Number(right.fleet);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }
      if (Number.isFinite(leftNumber)) return -1;
      if (Number.isFinite(rightNumber)) return 1;
      return left.fleet.localeCompare(right.fleet, 'pt-BR');
    });

    const summary = filtered.reduce(
      (result, row) => ({
        expenseGeneral: result.expenseGeneral.plus(row.expenseGeneral),
        expenseTotal: result.expenseTotal.plus(row.expenseTotal),
        fuelTotal: result.fuelTotal.plus(row.fuelTotal),
        maintenance: result.maintenance.plus(row.maintenance),
        liters: result.liters.plus(row.liters),
        km: result.km.plus(row.km),
        allocation: result.allocation.plus(row.allocatedAmount),
      }),
      {
        expenseGeneral: ZERO,
        expenseTotal: ZERO,
        fuelTotal: ZERO,
        maintenance: ZERO,
        liters: ZERO,
        km: ZERO,
        allocation: ZERO,
      },
    );
    const offset = (page - 1) * pageSize;
    const groupBases = Array.from(calculated.memory.groupBases.entries()).map(
      ([group, value]) => ({ group, expenseBase: decimalString(value) }),
    );
    const groupShares = Object.entries(calculated.memory.groupShares).map(
      ([group, value]) => ({ group, share: decimalString(value, 6) }),
    );
    const groupTargets = Array.from(
      calculated.memory.groupTargets.entries(),
    ).map(([group, value]) => ({ group, targetAmount: decimalString(value) }));
    return {
      competence: requestedCompetence,
      rows: (options.unpaginated
        ? filtered
        : filtered.slice(offset, offset + pageSize)
      ).map(serializedRow),
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        pages: Math.ceil(filtered.length / pageSize),
      },
      filters: { types, vehicleTypes },
      summary: {
        vehicles: filtered.length,
        expenseGeneral: decimalString(summary.expenseGeneral),
        expenseTotal: decimalString(summary.expenseTotal),
        fuelTotal: decimalString(summary.fuelTotal),
        maintenance: decimalString(summary.maintenance),
        liters: decimalString(summary.liters, 3),
        km: decimalString(summary.km),
        allocation: decimalString(summary.allocation),
      },
      allocationMemory: {
        maintenanceVehicles: calculated.memory.maintenanceVehicles,
        maintenanceExpense: decimalString(calculated.memory.maintenanceExpense),
        maintenanceFixed: decimalString(calculated.memory.maintenanceFixed),
        comboioVehicles: calculated.memory.comboioVehicles,
        comboioPlates: calculated.memory.comboioPlates,
        comboioExpense: decimalString(calculated.memory.comboioExpense),
        comboioFixed: decimalString(calculated.memory.comboioFixed),
        eligibleLaborPoolAmount: decimalString(
          calculated.memory.eligibleLaborPoolAmount,
        ),
        totalAllocationPool: decimalString(
          calculated.memory.totalAllocationPool,
        ),
        groupBases,
        groupShares,
        groupTargets,
        allocatedAmountTotal: decimalString(
          calculated.memory.allocatedAmountTotal,
        ),
        allocationDifference: decimalString(
          calculated.memory.allocationDifference,
        ),
        reconciliationIssues: calculated.memory.reconciliationIssues.map(
          (issue) => ({
            code: issue.code,
            rateGroup: issue.rateGroup,
            share: decimalString(issue.share, 6),
            targetAmount: decimalString(issue.targetAmount),
          }),
        ),
        maintenanceClassification: {
          source: 'JR_VEHICLE_MAINTENANCE_HISTORY_BY_COMPETENCE',
          historyMatches: maintenanceHistoryMatches,
          currentStateFallbacks: maintenanceCurrentFallbacks,
        },
        laborSource: laborPoolResolution.memory,
      },
      hourMeterQuality,
      availableCompetences,
    };
  }

  async competenceExpenses(
    query: CostPurchaseCompetenceQuery,
    options: { availableCompetences?: string[] } = {},
  ) {
    const availableCompetences =
      options.availableCompetences ?? (await this.competences());
    const requestedCompetence = query.competence || availableCompetences[0];
    if (!requestedCompetence) {
      return {
        competence: null,
        blocks: [],
        summary: { blocks: 0, lines: 0, calculated: 0, pending: 0, assets: 0 },
        filters: { groups: [], assets: [] },
        sources: {
          vehicleFacts: false,
          internalConsumption: false,
          preventiveOrders: false,
          totvsLabor: false,
          totvsLaborError: null,
        },
        updatedAt: null,
        availableCompetences,
      };
    }
    const competence = competenceDate(requestedCompetence);
    const nextMonth = new Date(
      Date.UTC(competence.getUTCFullYear(), competence.getUTCMonth() + 1, 1),
    );
    const [
      report,
      internalFacts,
      preventiveFacts,
      benchmarks,
      policy,
      labor,
      detailExpenseFacts,
      detailFuelFacts,
      sourceRuns,
    ] = await Promise.all([
      this.report(
        { competence: requestedCompetence, page: '1', pageSize: '250' },
        {
          includeRented: true,
          unpaginated: true,
          availableCompetences,
        },
      ),
      this.prisma.costPurchaseInternalConsumptionFact.findMany({
        where: { competence, active: true },
        select: {
          id: true,
          sourceRecordId: true,
          documentDate: true,
          documentNumber: true,
          planAccountId: true,
          categoryId: true,
          aethosItemId: true,
          assetCode: true,
          quantity: true,
          unit: true,
          amount: true,
          syncedAt: true,
        },
        orderBy: { sourceRecordId: 'asc' },
      }),
      this.prisma.costPurchasePreventiveOrderFact.findMany({
        where: { competence, active: true },
        select: {
          id: true,
          sourceRecordId: true,
          orderId: true,
          amount: true,
          syncedAt: true,
        },
        orderBy: { sourceRecordId: 'asc' },
      }),
      this.prisma.costPurchaseCompetenceBenchmark.findMany({
        where: { competence },
        select: { lineNumber: true, value: true, note: true },
        orderBy: { lineNumber: 'asc' },
      }),
      this.prisma.costPurchaseAllocationPolicy.findFirst({
        where: {
          active: true,
          validFrom: { lt: nextMonth },
          OR: [{ validTo: null }, { validTo: { gt: competence } }],
        },
        orderBy: { validFrom: 'desc' },
        select: {
          maintenanceVehicleFixed: true,
          comboioPlateFixed: true,
        },
      }),
      this.resolveCompetenceLaborLines(competence, nextMonth),
      this.prisma.costPurchaseVehicleExpenseFact.findMany({
        where: {
          competence,
          active: true,
        },
        select: {
          id: true,
          sourceRecordId: true,
          aethosVehicleId: true,
          documentDate: true,
          documentNumber: true,
          amount: true,
        },
        orderBy: [{ documentDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.costPurchaseVehicleFuelFact.findMany({
        where: {
          competence,
          active: true,
        },
        select: {
          id: true,
          sourceRecordId: true,
          aethosVehicleId: true,
          documentDate: true,
          fuelAmount: true,
          liters: true,
          initialKm: true,
          currentKm: true,
          usesHourMeter: true,
        },
        orderBy: [{ documentDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          dataset: {
            in: [
              COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET,
              COST_PURCHASE_PREVENTIVE_ORDER_DATASET,
            ],
          },
          status: 'COMPLETED',
          scopeDateFrom: { lt: nextMonth },
          scopeDateTo: { gte: competence },
        },
        select: {
          dataset: true,
          scopeDateFrom: true,
          scopeDateTo: true,
          completedAt: true,
        },
      }),
    ]);
    if (!policy) {
      throw new BadRequestException(
        `Politica de rateio nao configurada para ${requestedCompetence}`,
      );
    }

    const decimalFields = [
      'expenseGeneral',
      'expenseTotal',
      'fuelTotal',
      'maintenance',
      'liters',
      'km',
      'averageKmPerLiter',
      'averageLitersPerHour',
      'hourMeterRateSum',
      'hourMeterHours',
      'hourMeterLiters',
      'desiredAverage',
      'expensePerKm',
      'allocatedAmount',
    ] as const;
    const rows = report.rows.map((row) => {
      const converted: Record<string, unknown> = { ...row };
      for (const field of decimalFields) {
        converted[field] = new Prisma.Decimal(row[field]);
      }
      return converted as unknown as Parameters<
        typeof calculateCostPurchaseCompetence
      >[0]['rows'][number];
    });
    for (const asset of COST_PURCHASE_USINA_ASSETS) {
      if (rows.some((row) => row.aethosVehicleId === asset.aethosVehicleId))
        continue;
      const expenseTotal = detailExpenseFacts
        .filter((fact) => fact.aethosVehicleId === asset.aethosVehicleId)
        .reduce(
          (total, fact) => total.plus(fact.amount),
          new Prisma.Decimal(0),
        );
      const fuelTotal = detailFuelFacts
        .filter((fact) => fact.aethosVehicleId === asset.aethosVehicleId)
        .reduce(
          (total, fact) => total.plus(fact.fuelAmount),
          new Prisma.Decimal(0),
        );
      const liters = detailFuelFacts
        .filter((fact) => fact.aethosVehicleId === asset.aethosVehicleId)
        .reduce(
          (total, fact) => total.plus(fact.liters),
          new Prisma.Decimal(0),
        );
      if (expenseTotal.eq(0) && fuelTotal.eq(0) && liters.eq(0)) continue;
      const maintenance = expenseTotal.minus(fuelTotal);
      rows.push({
        vehicleId: `AETHOS:${asset.aethosVehicleId}`,
        aethosVehicleId: asset.aethosVehicleId,
        competence: requestedCompetence,
        type: 'USINAS',
        vehicleType: 'usina',
        fleet: asset.code,
        plate: asset.code,
        model: asset.model,
        responsible: 'Não informado',
        group: 'DESPESAS USINAS',
        subgroup: 'USINAS',
        company: 'JR CONSTRUÇÕES',
        filial: 'MATRIZ',
        isRented: false,
        maintenanceSupport: false,
        rateGroup: null,
        participatesInAllocation: false,
        expenseGeneral: expenseTotal,
        expenseTotal,
        fuelTotal,
        maintenance: maintenance.gt(0) ? maintenance : new Prisma.Decimal(0),
        liters,
        km: new Prisma.Decimal(0),
        averageKmPerLiter: new Prisma.Decimal(0),
        averageLitersPerHour: new Prisma.Decimal(0),
        hourMeterRateSum: new Prisma.Decimal(0),
        hourMeterReadingCount: 0,
        hourMeterHours: new Prisma.Decimal(0),
        hourMeterLiters: new Prisma.Decimal(0),
        desiredAverage: new Prisma.Decimal(0),
        expensePerKm: new Prisma.Decimal(0),
        allocatedAmount: new Prisma.Decimal(0),
      });
    }
    const internalConsumptionCovered = sourceRuns.some(
      (run) =>
        run.dataset === COST_PURCHASE_INTERNAL_CONSUMPTION_DATASET &&
        scopeCoversMonth(run, competence),
    );
    const preventiveOrdersCovered = sourceRuns.some(
      (run) =>
        run.dataset === COST_PURCHASE_PREVENTIVE_ORDER_DATASET &&
        scopeCoversMonth(run, competence),
    );
    const calculated = calculateCostPurchaseCompetence({
      rows,
      laborLines: labor.lines,
      internalFacts,
      preventiveFacts,
      benchmarks,
      policy,
      coverage: {
        internalConsumption: internalConsumptionCovered,
        preventiveOrders: preventiveOrdersCovered,
      },
    });
    const blocks = calculated.blocks.map((block) => ({
      ...block,
      lines: block.lines.map((line) => ({
        ...serializeCostPurchaseCompetenceLine(line),
        detail: buildCompetenceLineDetail({
          line,
          blockLines: block.lines,
          vehicles: rows,
          expenseFacts: detailExpenseFacts,
          fuelFacts: detailFuelFacts,
          internalFacts,
          laborLines: labor.lines,
        }),
      })),
    }));
    const selectedLineNumber = query.lineNumber
      ? integer(query.lineNumber, 0, 1, 999)
      : null;
    const selectedLine = selectedLineNumber
      ? blocks
          .flatMap((block) => block.lines)
          .find((line) => line.lineNumber === selectedLineNumber) || null
      : null;
    const timestamps = [
      ...internalFacts.map((fact) => fact.syncedAt),
      ...preventiveFacts.map((fact) => fact.syncedAt),
      ...sourceRuns
        .map((run) => run.completedAt)
        .filter((value): value is Date => value !== null),
    ];
    const updatedAt = timestamps.length
      ? new Date(
          Math.max(...timestamps.map((value) => value.getTime())),
        ).toISOString()
      : null;

    return {
      competence: requestedCompetence,
      blocks,
      summary: calculated.summary,
      filters: {
        groups: blocks.map((block) => ({
          code: block.code,
          label: block.title,
        })),
        assets: rows
          .map((row) => ({
            aethosVehicleId: row.aethosVehicleId,
            fleet: row.fleet,
            plate: row.plate,
            subgroup: row.subgroup,
          }))
          .sort((left, right) =>
            left.fleet.localeCompare(right.fleet, 'pt-BR', { numeric: true }),
          ),
      },
      sources: {
        vehicleFacts: report.rows.length > 0,
        internalConsumption: internalConsumptionCovered,
        preventiveOrders: preventiveOrdersCovered,
        totvsLabor: labor.sourceAvailable,
        totvsLaborError: labor.errorCode,
      },
      selectedLine,
      updatedAt,
      availableCompetences,
      metadata: {
        excelRuntimeDependency: false,
        nullPolicy: 'NULL_IS_NOT_ZERO',
        allocationPolicy:
          'Linha 13 exibida fora do pool; demais parcelas seguem a politica versionada do JR.',
      },
    };
  }

  private async managerialYearContext(
    year: number,
    options: { months?: number[]; availableCompetences?: string[] } = {},
  ) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const [
      entryFacts,
      mappings,
      dopFacts,
      gasolineFacts,
      runs,
      expenseMonths,
      fuelMonths,
    ] = await Promise.all([
      this.prisma.costPurchaseManagerialEntryFact.findMany({
        where: { competence: { gte: start, lt: end }, active: true },
        orderBy: [{ documentDate: 'asc' }, { sourceRecordId: 'asc' }],
      }),
      this.prisma.costPurchaseManagerialItemMapping.findMany({
        where: {
          active: true,
          deletedAt: null,
          validFrom: { lt: end },
          OR: [{ validTo: null }, { validTo: { gt: start } }],
        },
        orderBy: [{ aethosItemId: 'asc' }, { validFrom: 'desc' }],
      }),
      this.prisma.usinaOperationalCostFact.findMany({
        where: {
          competence: { gte: start, lt: end },
          dataset: 'PAYABLE_EXPENSES',
          costClass: 'DOP',
          active: true,
        },
        select: {
          competence: true,
          sourceRecordId: true,
          sourceDocumentId: true,
          sourceNoteNumber: true,
          occurredDate: true,
          accountPlanDescription: true,
          amount: true,
        },
      }),
      this.prisma.costPurchaseVehicleFuelFact.findMany({
        where: {
          competence: { gte: start, lt: end },
          planAccountId: 131,
          active: true,
        },
        select: {
          competence: true,
          sourceRecordId: true,
          aethosVehicleId: true,
          documentDate: true,
          fuelAmount: true,
          liters: true,
        },
      }),
      this.prisma.usinaSyncRun.findMany({
        where: {
          status: 'COMPLETED',
          dataset: {
            in: [COST_PURCHASE_MANAGERIAL_ENTRY_DATASET, 'PAYABLE_EXPENSES'],
          },
          scopeDateFrom: { lt: end },
          scopeDateTo: { gte: start },
        },
        select: {
          dataset: true,
          scopeDateFrom: true,
          scopeDateTo: true,
          generatedAt: true,
        },
      }),
      this.prisma.costPurchaseVehicleExpenseFact.findMany({
        where: { competence: { gte: start, lt: end }, active: true },
        distinct: ['competence'],
        select: { competence: true },
      }),
      this.prisma.costPurchaseVehicleFuelFact.findMany({
        where: { competence: { gte: start, lt: end }, active: true },
        distinct: ['competence'],
        select: { competence: true },
      }),
    ]);

    const selectedMonths = options.months ? new Set(options.months) : null;
    const maintenanceCompetences = [
      ...new Set(
        [...expenseMonths, ...fuelMonths]
          .map((entry) => monthId(entry.competence))
          .filter((competence) => {
            if (!selectedMonths) return true;
            return selectedMonths.has(Number(competence.slice(5, 7)));
          }),
      ),
    ];
    const availableCompetences =
      options.availableCompetences ?? (await this.competences());
    const maintenanceReports = await mapWithConcurrency(
      maintenanceCompetences,
      2,
      async (competence) =>
        [
          competence,
          await this.report(
            { competence, page: '1', pageSize: '250' },
            {
              skipLaborPool: true,
              unpaginated: true,
              availableCompetences,
            },
          ),
        ] as const,
    );
    return {
      start,
      end,
      entryFacts,
      mappings,
      dopFacts,
      gasolineFacts,
      runs,
      maintenanceReports: new Map(maintenanceReports),
    };
  }

  private mappingFor(
    fact: { aethosItemId: number; documentDate: Date },
    mappings: Array<{
      aethosItemId: number;
      category: string;
      validFrom: Date;
      validTo: Date | null;
    }>,
  ) {
    return (
      mappings.find(
        (mapping) =>
          mapping.aethosItemId === fact.aethosItemId &&
          mapping.validFrom <= fact.documentDate &&
          (!mapping.validTo || mapping.validTo > fact.documentDate),
      ) || null
    );
  }

  async managerialAccounts(
    query: CostPurchaseManagerialQuery,
    options: { months?: number[]; availableCompetences?: string[] } = {},
  ) {
    const year = yearValue(query.year);
    const context = await this.managerialYearContext(year, options);
    const monthResults: Array<{
      month: number;
      competence: string;
      values: Record<string, string | null>;
      coverage: Record<string, boolean>;
      details: Record<string, CostPurchasesPresentationDetail>;
    }> = [];

    for (let month = 1; month <= 12; month += 1) {
      const competenceDateValue = new Date(Date.UTC(year, month - 1, 1));
      const competence = monthId(competenceDateValue);
      const monthEntryFacts = context.entryFacts.filter(
        (fact) => monthId(fact.competence) === competence,
      );
      const mappedMonthEntryFacts = monthEntryFacts
        .map((fact) => ({
          fact,
          mapping: this.mappingFor(fact, context.mappings),
        }))
        .filter(
          ({ fact, mapping }) =>
            !mapping ||
            managerialEntryIsEligible({
              category: mapping.category as ManagerialCategory,
              sourceOrderStatus: fact.sourceOrderStatus,
            }),
        );
      const entryCovered = context.runs.some(
        (run) =>
          run.dataset === COST_PURCHASE_MANAGERIAL_ENTRY_DATASET &&
          scopeCoversMonth(run, competenceDateValue),
      );
      const dopCovered = context.runs.some(
        (run) =>
          run.dataset === 'PAYABLE_EXPENSES' &&
          scopeCoversMonth(run, competenceDateValue),
      );
      const entryValues: Partial<Record<ManagerialCategory, Prisma.Decimal>> =
        {};
      const entryQuantities: Partial<
        Record<ManagerialCategory, Prisma.Decimal>
      > = {};
      const calDocumentKeys = new Set<string>();
      for (const { fact, mapping } of mappedMonthEntryFacts) {
        if (!mapping) continue;
        const category = mapping.category as ManagerialCategory;
        entryValues[category] = (entryValues[category] || ZERO).plus(
          fact.totalValue,
        );
        entryQuantities[category] = (entryQuantities[category] || ZERO).plus(
          fact.quantity || ZERO,
        );
        if (category === 'CAL') {
          calDocumentKeys.add(fact.sourceHeaderId);
          if (fact.documentNumber) calDocumentKeys.add(fact.documentNumber);
        }
      }
      let dop = ZERO;
      let dopDuplicateDocuments = 0;
      const includedDopFacts: typeof context.dopFacts = [];
      for (const fact of context.dopFacts.filter(
        (entry) => monthId(entry.competence) === competence,
      )) {
        const keys = [fact.sourceDocumentId, fact.sourceNoteNumber].filter(
          Boolean,
        ) as string[];
        if (keys.some((key) => calDocumentKeys.has(key))) {
          dopDuplicateDocuments += 1;
          continue;
        }
        dop = dop.plus(fact.amount);
        includedDopFacts.push(fact);
      }
      const monthGasoline = context.gasolineFacts.filter(
        (fact) => monthId(fact.competence) === competence,
      );
      const gasolineCovered = monthGasoline.length > 0;
      const gasoline = monthGasoline.reduce(
        (sum, fact) => sum.plus(fact.fuelAmount),
        ZERO,
      );
      const gasolineLiters = monthGasoline.reduce(
        (sum, fact) => sum.plus(fact.liters),
        ZERO,
      );
      const maintenanceReport = context.maintenanceReports.get(competence);
      const maintenanceCovered = Boolean(maintenanceReport);
      const maintenance = new Prisma.Decimal(
        maintenanceReport?.summary.maintenance || 0,
      );
      const calculated = calculateManagerialMonth({
        entryCovered,
        entryValues,
        entryQuantities,
        dopCovered,
        dop,
        gasolineCovered,
        gasoline,
        gasolineLiters,
        maintenanceCovered,
        maintenance,
      });
      const details = Object.fromEntries(
        COST_PURCHASE_MANAGERIAL_LINES.map((line) => [
          line.code,
          buildManagerialLineDetail({
            code: line.code,
            label: line.label,
            value: calculated.values[line.code],
            monthValues: calculated.values,
            mappedEntryFacts: mappedMonthEntryFacts.filter(
              (entry) => entry.mapping !== null,
            ),
            payableExpenseFacts: includedDopFacts,
            gasolineFacts: monthGasoline,
            maintenanceRows: maintenanceReport?.rows || [],
          }),
        ]),
      );
      monthResults.push({
        month,
        competence,
        values: calculated.values,
        coverage: {
          managerialEntries: entryCovered,
          payableExpenses: dopCovered,
          gasolinePlan131: gasolineCovered,
          monthlyVehicleReport: maintenanceCovered,
          dopDuplicateDocumentsExcluded: dopDuplicateDocuments > 0,
        },
        details,
      });
    }

    return {
      year,
      months: monthResults,
      lines: COST_PURCHASE_MANAGERIAL_LINES.map((line) => ({
        ...line,
        values: Object.fromEntries(
          monthResults.map((month) => [month.month, month.values[line.code]]),
        ),
      })),
      metadata: {
        source: 'JR_POSTGRES_READ_MODELS',
        maintenanceRule:
          'Toda a frota elegível: despesa total menos abastecimento total; sem filtro de placa USI',
        nullPolicy:
          'NULL indica fonte sem cobertura; zero indica resultado factual zero',
      },
    };
  }

  async managerialSummary(query: CostPurchaseManagerialQuery) {
    const report = await this.managerialAccounts(query);
    const annual = Object.fromEntries(
      report.lines.map((line) => {
        const values = Object.values(line.values);
        if (values.some((value) => value === null)) return [line.code, null];
        return [
          line.code,
          values
            .reduce((sum, value) => sum.plus(value || 0), ZERO)
            .toFixed(
              line.kind === 'QUANTITY' ? 3 : line.kind === 'UNIT_PRICE' ? 6 : 2,
            ),
        ];
      }),
    );
    return {
      year: report.year,
      annual,
      coverage: report.months.map((month) => ({
        month: month.month,
        ...month.coverage,
      })),
    };
  }

  async managerialMemory(query: CostPurchaseManagerialQuery) {
    const year = yearValue(query.year);
    const month = integer(query.month, 0, 1, 12);
    const code = String(query.code || '')
      .trim()
      .toUpperCase();
    if (!COST_PURCHASE_MANAGERIAL_LINES.some((line) => line.code === code)) {
      throw new BadRequestException('code gerencial invalido');
    }
    const competence = `${year}-${String(month).padStart(2, '0')}`;
    const context = await this.managerialYearContext(year);
    const report = await this.managerialAccounts({ year: String(year) });
    const monthResult = report.months[month - 1];
    const monthEntryFacts = context.entryFacts.filter(
      (fact) => monthId(fact.competence) === competence,
    );
    const entryCategories = new Set(managerialEntryCategories(code));
    const mappedMonthEntryFacts = monthEntryFacts
      .map((fact) => ({
        fact,
        mapping: this.mappingFor(fact, context.mappings),
      }))
      .filter(
        (entry) =>
          entry.mapping &&
          entryCategories.has(entry.mapping.category as ManagerialCategory) &&
          managerialEntryIsEligible({
            category: entry.mapping.category as ManagerialCategory,
            sourceOrderStatus: entry.fact.sourceOrderStatus,
          }),
      );
    const excludedOrderFacts = monthEntryFacts
      .map((fact) => ({
        fact,
        mapping: this.mappingFor(fact, context.mappings),
      }))
      .filter(
        (entry) =>
          entry.mapping &&
          entryCategories.has(entry.mapping.category as ManagerialCategory) &&
          !managerialEntryIsEligible({
            category: entry.mapping.category as ManagerialCategory,
            sourceOrderStatus: entry.fact.sourceOrderStatus,
          }),
      )
      .map(({ fact }) => ({
        sourceRecordId: fact.sourceRecordId,
        documentNumber: fact.documentNumber,
        sourceOrderId: fact.sourceOrderId,
        sourceOrderItemId: fact.sourceOrderItemId,
        sourceOrderStatus: fact.sourceOrderStatus,
        totalValue: fact.totalValue.toFixed(2),
        reason:
          fact.sourceOrderStatus === 'I'
            ? 'ORDEM_FINALIZADA'
            : 'ORDEM_CANCELADA',
      }));
    const entryFacts = mappedMonthEntryFacts.map(({ fact, mapping }) => ({
      sourceRecordId: fact.sourceRecordId,
      documentNumber: fact.documentNumber,
      documentDate: fact.documentDate.toISOString().slice(0, 10),
      aethosItemId: fact.aethosItemId,
      category: mapping?.category || null,
      unit: fact.unit,
      quantity: fact.quantity?.toFixed(3) || null,
      totalValue: fact.totalValue.toFixed(2),
    }));
    const calDocumentKeys = new Set<string>();
    for (const { fact, mapping } of mappedMonthEntryFacts) {
      if (mapping?.category !== 'CAL') continue;
      calDocumentKeys.add(fact.sourceHeaderId);
      if (fact.documentNumber) calDocumentKeys.add(fact.documentNumber);
    }
    const includesPayableExpenses = code === 'USINA' || code === 'TOTAL';
    const payableExpenseFacts = includesPayableExpenses
      ? context.dopFacts
          .filter((fact) => monthId(fact.competence) === competence)
          .filter((fact) => {
            const keys = [fact.sourceDocumentId, fact.sourceNoteNumber].filter(
              Boolean,
            ) as string[];
            return !keys.some((key) => calDocumentKeys.has(key));
          })
          .map((fact) => ({
            sourceRecordId: fact.sourceRecordId,
            sourceDocumentId: fact.sourceDocumentId,
            sourceNoteNumber: fact.sourceNoteNumber,
            amount: fact.amount.toFixed(2),
          }))
      : [];
    const maintenanceReport = context.maintenanceReports.get(competence);
    const gasolineRows = context.gasolineFacts.filter(
      (fact) => monthId(fact.competence) === competence,
    );
    const includesGasoline =
      code === 'GASOLINA' ||
      code === 'GASOLINA_LITROS' ||
      code === 'GASOLINA_PRECO_MEDIO' ||
      code === 'TOTAL';
    const contributingFuelFacts = includesGasoline
      ? gasolineRows.map((fact) => ({
          sourceRecordId: fact.sourceRecordId,
          aethosVehicleId: fact.aethosVehicleId,
          amount: fact.fuelAmount.toFixed(2),
          liters: fact.liters.toFixed(3),
        }))
      : [];
    const gasoline = gasolineRows.reduce(
      (sum, fact) => sum.plus(fact.fuelAmount),
      ZERO,
    );
    const grossExpense = new Prisma.Decimal(
      maintenanceReport?.summary.expenseTotal || 0,
    );
    const fuelTotal = new Prisma.Decimal(
      maintenanceReport?.summary.fuelTotal || 0,
    );
    const maintenance = new Prisma.Decimal(
      maintenanceReport?.summary.maintenance || 0,
    );
    return {
      year,
      month,
      competence,
      code,
      value: monthResult.values[code],
      coverage: monthResult.coverage,
      formula: managerialMemoryFormula(code),
      maintenance:
        code === 'MANUTENCAO'
          ? {
              ...maintenanceIdentity({
                grossExpense,
                fuelTotal,
                gasoline,
                maintenance,
              }),
              eligibleVehicles: maintenanceReport?.summary.vehicles || 0,
              expenseGeneralIgnored:
                maintenanceReport?.summary.expenseGeneral || null,
              allocationIgnored: maintenanceReport?.summary.allocation || null,
              gasolineFacts: gasolineRows.length,
              filterByUsi: false,
            }
          : null,
      contributingEntryFacts: entryFacts,
      contributingEntryFactsCount: entryFacts.length,
      excludedOrderFacts,
      excludedOrderFactsCount: excludedOrderFacts.length,
      contributingPayableExpenseFacts: payableExpenseFacts,
      contributingPayableExpenseFactsCount: payableExpenseFacts.length,
      contributingFuelFacts,
      contributingFuelFactsCount: contributingFuelFacts.length,
    };
  }

  async managerialPending(query: CostPurchaseManagerialQuery) {
    const year = yearValue(query.year);
    const page = integer(query.page, 1, 1, 100000);
    const pageSize = integer(query.pageSize, 50, 1, 250);
    const context = await this.managerialYearContext(year);
    const unmapped = context.entryFacts
      .filter((fact) => !this.mappingFor(fact, context.mappings))
      .map((fact) => ({
        kind: 'UNMAPPED_ITEM',
        id: fact.id,
        competence: monthId(fact.competence),
        sourceRecordId: fact.sourceRecordId,
        aethosItemId: fact.aethosItemId,
        documentNumber: fact.documentNumber,
        totalValue: fact.totalValue.toFixed(2),
      }));
    const quarantine =
      await this.prisma.costPurchaseManagerialQuarantine.findMany({
        where: {
          active: true,
          OR: [
            { competence: { gte: context.start, lt: context.end } },
            { competence: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          dataset: true,
          sourceRecordId: true,
          competence: true,
          reasonCode: true,
          reasonDetail: true,
          createdAt: true,
        },
      });
    const rows = [
      ...unmapped,
      ...quarantine.map((entry) => ({
        kind: 'QUARANTINE',
        id: entry.id,
        competence: entry.competence ? monthId(entry.competence) : null,
        sourceRecordId: entry.sourceRecordId,
        dataset: entry.dataset,
        reasonCode: entry.reasonCode,
        reasonDetail: entry.reasonDetail,
        createdAt: entry.createdAt.toISOString(),
      })),
    ];
    const offset = (page - 1) * pageSize;
    return {
      year,
      rows: rows.slice(offset, offset + pageSize),
      pagination: {
        page,
        pageSize,
        total: rows.length,
        pages: Math.ceil(rows.length / pageSize),
      },
    };
  }

  async filters(query: CostPurchaseReportQuery) {
    const report = await this.report({ ...query, page: '1', pageSize: '1' });
    return {
      competence: report.competence,
      availableCompetences: report.availableCompetences,
      ...report.filters,
    };
  }

  async summary(query: CostPurchaseReportQuery) {
    const report = await this.report({ ...query, page: '1', pageSize: '1' });
    return { competence: report.competence, summary: report.summary };
  }

  async allocationMemory(query: CostPurchaseReportQuery) {
    const report = await this.report({ ...query, page: '1', pageSize: '1' });
    return {
      competence: report.competence,
      allocationMemory: report.allocationMemory,
    };
  }
}
