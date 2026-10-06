import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const enterpriseInclude = {
  _count: {
    select: {
      lots: true,
      simulations: true,
    },
  },
};

const lotInclude = {
  broker: true,
};

const lotWithEnterpriseInclude = {
  broker: true,
  enterprise: {
    select: {
      id: true,
      name: true,
    },
  },
};

const receivableSelect = {
  id: true,
  enterpriseId: true,
  lotId: true,
  type: true,
  installmentNo: true,
  dueDate: true,
  baseValue: true,
  correctedValue: true,
  appliedIpcaRate: true,
  createdAt: true,
  updatedAt: true,
  enterprise: {
    select: {
      id: true,
      name: true,
    },
  },
  lot: {
    select: {
      id: true,
      block: true,
      lot: true,
      buyerName: true,
    },
  },
};

const LOT_STATUSES = [
  'Disponivel',
  'Reservado',
  'Vendido',
  'Bloqueado',
  'Caucionado',
];
const ENTERPRISE_STAGES = [
  'Lancamento',
  'Obras iniciadas',
  'Infraestrutura 50%',
  'Entrega proxima',
  'Entregue',
];
const BARTER_TYPES = ['Imovel', 'Prestacao de servico', 'Veiculo', 'Outros'];

function compareLotIdentification(
  left: { block: string; lot: string },
  right: { block: string; lot: string },
) {
  const blockOrder = left.block.localeCompare(right.block, 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
  if (blockOrder !== 0) return blockOrder;

  return left.lot.localeCompare(right.lot, 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
}

type SaleBarter = {
  type: string;
  amount: number;
  entryDate: string | null;
};

type SaleDownPayment = {
  amount: number;
  dueDate: string | null;
};

type SaleCustomInstallment = {
  amount: number;
  dueDate: string | null;
  notes: string | null;
};

type SaleReinforcement = {
  amount: number;
  dueDate: string | null;
  notes: string | null;
};

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function canAccessPrumare(role?: string | null) {
  const normalized = normalizeRole(role);
  return (
    normalized === 'prumare' ||
    normalized === 'prumare_admin' ||
    normalized === 'corretor' ||
    normalized === 'ceo' ||
    normalized === 'admin'
  );
}

function canManagePrumare(role?: string | null) {
  const normalized = normalizeRole(role);
  return (
    normalized === 'prumare' ||
    normalized === 'prumare_admin' ||
    normalized === 'ceo' ||
    normalized === 'admin'
  );
}

function isBrokerRole(role?: string | null) {
  return normalizeRole(role) === 'corretor';
}

function ensureAccess(role?: string | null) {
  if (!canAccessPrumare(role)) {
    throw new ForbiddenException('Sem permissao para acessar Prumare');
  }
}

function ensureManageAccess(role?: string | null) {
  if (!canManagePrumare(role)) {
    throw new ForbiddenException('Sem permissao para alterar dados da Prumare');
  }
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function requiredText(value: unknown, label: string) {
  const text = coerceText(value);
  if (!text) {
    throw new BadRequestException(`${label} e obrigatorio`);
  }
  return text;
}

function optionalText(value: unknown) {
  const text = coerceText(value);
  return text || null;
}

function numberValue(value: unknown, label: string) {
  const raw =
    typeof value === 'string'
      ? value.trim().includes(',')
        ? value
            .trim()
            .replace(/[^\d,.-]/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
        : value.trim().replace(/[^\d.-]/g, '')
      : value;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    throw new BadRequestException(`${label} invalido`);
  }
  return number;
}

function optionalNumber(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  return numberValue(value, label);
}

function normalizeMonthlyRatePercent(value: number | null) {
  if (value === null) return null;
  if (value < 0) {
    throw new BadRequestException('Juros a.m. nao pode ser negativo');
  }

  const normalized = value > 10 && value <= 100 ? value / 100 : value;
  if (normalized > 10) {
    throw new BadRequestException('Juros a.m. fora da faixa esperada');
  }

  return money(normalized);
}

function normalizeBrokerCommission(
  value: number | null,
  salePrice: number | null,
) {
  if (value === null) return null;
  if (value < 0) {
    throw new BadRequestException('Comissao do corretor nao pode ser negativa');
  }

  const reference = salePrice && salePrice > 0 ? salePrice : 0;
  if (!reference || value <= reference * 0.2) return money(value);

  const normalized = [value / 10, value / 100, value / 1000].find(
    (candidate) => candidate <= reference * 0.2,
  );

  if (normalized !== undefined) return money(normalized);

  throw new BadRequestException('Comissao do corretor fora da faixa esperada');
}

function optionalMapCoordinate(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  const number = numberValue(value, label);
  if (number < 0 || number > 10000) {
    throw new BadRequestException(`${label} fora da area valida do mapa`);
  }
  return number;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} invalida`);
  }
  return date;
}

function optionalInteger(value: unknown, label: string) {
  const number = optionalNumber(value, label);
  if (number === null) return null;
  return Math.trunc(number);
}

function optionalPositiveInteger(value: unknown, label: string) {
  const number = optionalInteger(value, label);
  if (number === null) return null;
  if (number <= 0 || number > 50000) {
    throw new BadRequestException(`${label} invalida`);
  }
  return number;
}

function optionalMonthList(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label} invalido`);
  }

  const months = Array.from(
    new Set(value.map((item) => Math.trunc(numberValue(item, label)))),
  ).sort((a, b) => a - b);

  const invalid = months.some((month) => month < 1 || month > 12);
  if (invalid) {
    throw new BadRequestException(`${label} deve conter meses entre 1 e 12`);
  }

  return months;
}

function normalizeBarterType(value: unknown) {
  const text = requiredText(value, 'Tipo de permuta');
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (normalized === 'imovel') return 'Imovel';
  if (normalized === 'prestacao de servico') return 'Prestacao de servico';
  if (normalized === 'permuta' || normalized === 'veiculo') return 'Veiculo';
  if (normalized === 'outros') return 'Outros';

  throw new BadRequestException('Tipo de permuta invalido');
}

function optionalSaleBarters(value: unknown) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('Permutas invalidas');
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(`Permuta ${index + 1} invalida`);
      }

      const row = item as Record<string, unknown>;
      const amount = optionalNumber(
        row.amount,
        `Valor da permuta ${index + 1}`,
      );
      const entryDate = optionalDate(
        row.entryDate,
        `Data de entrada da permuta ${index + 1}`,
      );

      if (!amount && !entryDate) {
        return null;
      }

      if (!amount || amount <= 0) {
        throw new BadRequestException(
          `Valor da permuta ${index + 1} deve ser maior que zero`,
        );
      }

      if (!entryDate) {
        throw new BadRequestException(
          `Data de entrada da permuta ${index + 1} e obrigatoria`,
        );
      }

      return {
        type: normalizeBarterType(row.type),
        amount: money(amount),
        entryDate: entryDate.toISOString().slice(0, 10),
      };
    })
    .filter(Boolean) as SaleBarter[];
}

function optionalSaleDownPayments(value: unknown) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('Entradas invalidas');
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(`Entrada ${index + 1} invalida`);
      }

      const row = item as Record<string, unknown>;
      const amount = optionalNumber(
        row.amount,
        `Valor da entrada ${index + 1}`,
      );
      const dueDate = optionalDate(
        row.dueDate,
        `Data de pagamento da entrada ${index + 1}`,
      );

      if (!amount && !dueDate) {
        return null;
      }

      if (!amount || amount <= 0) {
        throw new BadRequestException(
          `Valor da entrada ${index + 1} deve ser maior que zero`,
        );
      }

      if (!dueDate) {
        throw new BadRequestException(
          `Data de pagamento da entrada ${index + 1} e obrigatoria`,
        );
      }

      return {
        amount: money(amount),
        dueDate: dueDate.toISOString().slice(0, 10),
      };
    })
    .filter(Boolean) as SaleDownPayment[];
}

function optionalSaleCustomInstallments(value: unknown) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('Parcelas personalizadas invalidas');
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(
          `Parcela personalizada ${index + 1} invalida`,
        );
      }

      const row = item as Record<string, unknown>;
      const amount = optionalNumber(
        row.amount,
        `Valor da parcela personalizada ${index + 1}`,
      );
      const dueDate = optionalDate(
        row.dueDate,
        `Data da parcela personalizada ${index + 1}`,
      );

      if (!amount && !dueDate && !optionalText(row.notes)) {
        return null;
      }

      if (!amount || amount <= 0) {
        throw new BadRequestException(
          `Valor da parcela personalizada ${index + 1} deve ser maior que zero`,
        );
      }

      if (!dueDate) {
        throw new BadRequestException(
          `Data da parcela personalizada ${index + 1} e obrigatoria`,
        );
      }

      return {
        amount: money(amount),
        dueDate: dueDate.toISOString().slice(0, 10),
        notes: optionalText(row.notes),
      };
    })
    .filter(Boolean) as SaleCustomInstallment[];
}

function optionalSaleReinforcements(value: unknown) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('Reforcos invalidos');
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(`Reforco ${index + 1} invalido`);
      }

      const row = item as Record<string, unknown>;
      const amount = optionalNumber(
        row.amount,
        `Valor do reforco ${index + 1}`,
      );
      const dueDate = optionalDate(
        row.dueDate,
        `Data prevista do reforco ${index + 1}`,
      );

      if (!amount && !dueDate && !optionalText(row.notes)) {
        return null;
      }

      if (!amount || amount <= 0) {
        throw new BadRequestException(
          `Valor do reforco ${index + 1} deve ser maior que zero`,
        );
      }

      if (!dueDate) {
        throw new BadRequestException(
          `Data prevista do reforco ${index + 1} e obrigatoria`,
        );
      }

      return {
        amount: money(amount),
        dueDate: dueDate.toISOString().slice(0, 10),
        notes: optionalText(row.notes),
      };
    })
    .filter(Boolean) as SaleReinforcement[];
}

function saleBartersFromJson(value: Prisma.JsonValue | null): SaleBarter[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const row = item as Record<string, Prisma.JsonValue>;
      const amount = Number(row.amount ?? 0);
      const entryDate =
        typeof row.entryDate === 'string' ? row.entryDate : null;
      let type = 'Veiculo';
      if (typeof row.type === 'string') {
        try {
          type = normalizeBarterType(row.type);
        } catch {
          type = 'Veiculo';
        }
      }

      if (!Number.isFinite(amount) || amount <= 0 || !entryDate) return null;
      return {
        type,
        amount: money(amount),
        entryDate,
      };
    })
    .filter(Boolean) as SaleBarter[];
}

function saleCustomInstallmentsFromJson(
  value: Prisma.JsonValue | null,
): SaleCustomInstallment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const row = item as Record<string, Prisma.JsonValue>;
      const amount = Number(row.amount ?? 0);
      const dueDate = typeof row.dueDate === 'string' ? row.dueDate : null;
      const notes = typeof row.notes === 'string' ? row.notes : null;

      if (!Number.isFinite(amount) || amount <= 0 || !dueDate) return null;
      return {
        amount: money(amount),
        dueDate,
        notes,
      };
    })
    .filter(Boolean) as SaleCustomInstallment[];
}

function saleReinforcementsFromJson(
  value: Prisma.JsonValue | null,
): SaleReinforcement[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const row = item as Record<string, Prisma.JsonValue>;
      const amount = Number(row.amount ?? 0);
      const dueDate = typeof row.dueDate === 'string' ? row.dueDate : null;
      const notes = typeof row.notes === 'string' ? row.notes : null;

      if (!Number.isFinite(amount) || amount <= 0 || !dueDate) return null;
      return {
        amount: money(amount),
        dueDate,
        notes,
      };
    })
    .filter(Boolean) as SaleReinforcement[];
}

function saleDownPaymentsFromJson(
  value: Prisma.JsonValue | null,
  fallbackAmount: number,
  fallbackDate: Date | null,
): SaleDownPayment[] {
  if (Array.isArray(value)) {
    const rows = value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          return null;
        const row = item as Record<string, Prisma.JsonValue>;
        const amount = Number(row.amount ?? 0);
        const dueDate = typeof row.dueDate === 'string' ? row.dueDate : null;

        if (!Number.isFinite(amount) || amount <= 0 || !dueDate) return null;
        return {
          amount: money(amount),
          dueDate,
        };
      })
      .filter(Boolean) as SaleDownPayment[];

    if (rows.length) return rows;
  }

  if (fallbackAmount > 0) {
    return [
      {
        amount: money(fallbackAmount),
        dueDate: (fallbackDate ?? new Date()).toISOString().slice(0, 10),
      },
    ];
  }

  return [];
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizePositivePercent(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function mRound(value: number, multiple: number) {
  if (!multiple) return value;
  return Math.round(value / multiple) * multiple;
}

type ReinforcementSchedule = Map<number, number>;

function reinforcementValueForMonth(
  schedule: ReinforcementSchedule,
  month: number,
) {
  return money(schedule.get(month) ?? 0);
}

function simulateFinalBalance(
  initialBalance: number,
  payment: number,
  installments: number,
  monthlyRate: number,
  reinforcementSchedule: ReinforcementSchedule,
) {
  let balance = initialBalance;
  for (let i = 1; i <= installments; i += 1) {
    balance = balance * (1 + monthlyRate) - payment;
    balance -= reinforcementValueForMonth(reinforcementSchedule, i);
  }
  return balance;
}

function calculatePayment(
  initialBalance: number,
  installments: number,
  monthlyRate: number,
  reinforcementSchedule: ReinforcementSchedule,
) {
  let low = 0;
  let high =
    (initialBalance * Math.pow(1 + monthlyRate, installments)) /
    Math.max(installments, 1);
  let payment = 0;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    payment = (low + high) / 2;
    const finalBalance = simulateFinalBalance(
      initialBalance,
      payment,
      installments,
      monthlyRate,
      reinforcementSchedule,
    );

    if (Math.abs(finalBalance) < 0.01) break;
    if (finalBalance > 0) low = payment;
    else high = payment;
  }

  return money(payment);
}

function buildLegacyReinforcementSchedule(
  installments: number,
  annualReinforcement: number,
  firstReinforcementInstallment?: number | null,
) {
  const schedule: ReinforcementSchedule = new Map();
  if (annualReinforcement <= 0) return schedule;

  const firstInstallment =
    firstReinforcementInstallment && firstReinforcementInstallment > 0
      ? Math.trunc(firstReinforcementInstallment)
      : 12;
  const step = 12;

  for (let month = firstInstallment; month <= installments; month += step) {
    schedule.set(month, annualReinforcement);
  }

  return schedule;
}

function buildCalendarReinforcementSchedule(
  installments: number,
  annualReinforcement: number,
  reinforcementMonths?: number[] | null,
  firstInstallmentDate?: Date | null,
  dueDay?: number | null,
  firstReinforcementInstallment?: number | null,
) {
  const months = (reinforcementMonths || [])
    .map((month) => Math.trunc(Number(month)))
    .filter((month) => month >= 1 && month <= 12);

  if (!months.length || !firstInstallmentDate) {
    return buildLegacyReinforcementSchedule(
      installments,
      annualReinforcement,
      firstReinforcementInstallment,
    );
  }

  const selectedMonths = new Set(months);
  const schedule: ReinforcementSchedule = new Map();
  if (annualReinforcement <= 0) return schedule;
  const startInstallment =
    firstReinforcementInstallment && firstReinforcementInstallment > 0
      ? Math.trunc(firstReinforcementInstallment)
      : 1;

  for (let installment = 1; installment <= installments; installment += 1) {
    if (installment < startInstallment) continue;

    const dueDate = resolveInstallmentDueDate(
      firstInstallmentDate,
      installment - 1,
      dueDay,
    );
    const calendarMonth = dueDate.getUTCMonth() + 1;
    if (selectedMonths.has(calendarMonth)) {
      schedule.set(installment, annualReinforcement);
    }
  }

  return schedule;
}

function buildPriceSchedule(
  totalValue: number,
  downPayment: number,
  installments: number,
  monthlyRatePercent: number,
  annualReinforcement: number,
  reinforcementMonths?: number[] | null,
  firstInstallmentDate?: Date | null,
  dueDay?: number | null,
  firstReinforcementInstallment?: number | null,
) {
  if (installments <= 0) {
    throw new BadRequestException('Numero de parcelas invalido');
  }
  if (downPayment >= totalValue) {
    throw new BadRequestException('Entrada deve ser menor que o valor total');
  }

  const monthlyRate = monthlyRatePercent / 100;
  const financedValue = money(totalValue - downPayment);
  const reinforcementSchedule = buildCalendarReinforcementSchedule(
    installments,
    annualReinforcement,
    reinforcementMonths,
    firstInstallmentDate,
    dueDay,
    firstReinforcementInstallment,
  );
  const monthlyPayment = calculatePayment(
    financedValue,
    installments,
    monthlyRate,
    reinforcementSchedule,
  );
  let balance = financedValue;
  let totalInterest = 0;
  let totalReinforcement = 0;

  const rows = Array.from({ length: installments }, (_, index) => {
    const month = index + 1;
    const interest = money(balance * monthlyRate);
    const amortization = money(monthlyPayment - interest);
    balance = balance * (1 + monthlyRate) - monthlyPayment;

    const reinforcement = reinforcementValueForMonth(
      reinforcementSchedule,
      month,
    );
    balance -= reinforcement;

    if (balance < 0) balance = 0;
    totalInterest += interest;
    totalReinforcement += reinforcement;

    return {
      month,
      payment: monthlyPayment,
      interest,
      amortization,
      reinforcement: money(reinforcement),
      balance: money(balance),
    };
  });

  return {
    totalValue: money(totalValue),
    downPayment: money(downPayment),
    financedValue,
    installments,
    monthlyRatePercent: money(monthlyRatePercent),
    annualReinforcement: money(annualReinforcement),
    reinforcementMonths: reinforcementMonths || [],
    monthlyPayment,
    totalInterest: money(totalInterest),
    totalReinforcement: money(totalReinforcement),
    rows,
  };
}

function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthStart(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function withDueDay(date: Date, dueDay: number) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const day = Math.min(Math.max(dueDay, 1), daysInUtcMonth(year, monthIndex));
  return utcDate(year, monthIndex, day);
}

function resolveInstallmentDueDate(
  firstInstallmentDate: Date,
  installmentIndex: number,
  dueDay?: number | null,
) {
  const month = addMonths(monthStart(firstInstallmentDate), installmentIndex);
  return withDueDay(month, dueDay ?? firstInstallmentDate.getUTCDate());
}

function monthSerial(year: number, month: number) {
  return year * 12 + month;
}

function yearMonthFromSerial(serial: number) {
  const year = Math.floor((serial - 1) / 12);
  const month = serial - year * 12;
  return { year, month };
}

type IpcaIndex = {
  year: number;
  month: number;
  percent: Prisma.Decimal;
};

type AppliedIpcaIndex = {
  year: number;
  month: number;
  percent: number;
  source: 'real' | 'media_12';
  sampleSize: number;
};

function averageLastRealIpca(
  indexed: Array<{ serial: number; percent: number }>,
  serial: number,
) {
  const previous = indexed.filter((index) => index.serial < serial).slice(-12);
  if (!previous.length) {
    return { percent: 0, sampleSize: 0 };
  }

  return {
    percent:
      previous.reduce((sum, index) => sum + index.percent, 0) / previous.length,
    sampleSize: previous.length,
  };
}

function monthlyIpcaForPeriod(
  indexes: IpcaIndex[],
  startDate: Date,
  dueDate: Date,
): AppliedIpcaIndex[] {
  const startSerial = monthSerial(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth() + 1,
  );
  const dueSerial = monthSerial(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth() + 1,
  );

  if (dueSerial < startSerial) return [];

  const realBySerial = new Map<number, number>();
  const indexed = indexes
    .map((index) => {
      const serial = monthSerial(index.year, index.month);
      const percent = normalizePositivePercent(Number(index.percent));
      if (Number.isFinite(percent)) {
        realBySerial.set(serial, percent);
      }
      return { serial, percent };
    })
    .filter((index) => Number.isFinite(index.percent))
    .sort((a, b) => a.serial - b.serial);

  const months: AppliedIpcaIndex[] = [];
  for (let serial = startSerial; serial <= dueSerial; serial += 1) {
    const { year, month } = yearMonthFromSerial(serial);
    const realPercent = realBySerial.get(serial);

    if (realPercent !== undefined) {
      months.push({
        year,
        month,
        percent: realPercent,
        source: 'real',
        sampleSize: 1,
      });
      continue;
    }

    const average = averageLastRealIpca(indexed, serial);
    months.push({
      year,
      month,
      percent: average.percent,
      source: 'media_12',
      sampleSize: average.sampleSize,
    });
  }

  return months;
}

function compoundIpca(indexes: AppliedIpcaIndex[]) {
  const multiplier = indexes.reduce(
    (acc, index) =>
      acc * (1 + normalizePositivePercent(Number(index.percent)) / 100),
    1,
  );
  return {
    multiplier,
    appliedRate: rate((multiplier - 1) * 100),
    snapshot: indexes.map((index) => ({
      year: index.year,
      month: index.month,
      percent: rate(index.percent),
      source: index.source,
      sampleSize: index.sampleSize,
    })),
  };
}

function correctedReceivableValue(
  baseValue: number,
  indexes: AppliedIpcaIndex[],
) {
  const compound = compoundIpca(indexes);
  return {
    correctedValue: money(baseValue * compound.multiplier),
    appliedIpcaRate: compound.appliedRate,
    ipcaSnapshot: compound.snapshot,
  };
}

@Injectable()
export class PrumareService {
  constructor(private readonly prisma: PrismaService) {}

  findEnterprises(role?: string | null) {
    ensureAccess(role);
    return this.prisma.prumareEnterprise.findMany({
      orderBy: { createdAt: 'desc' },
      include: enterpriseInclude,
    });
  }

  async createEnterprise(data: any, role?: string | null) {
    ensureManageAccess(role);

    return this.prisma.prumareEnterprise.create({
      data: this.enterpriseData(data),
      include: enterpriseInclude,
    });
  }

  async updateEnterprise(id: string, data: any, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureEnterprise(id);

    return this.prisma.prumareEnterprise.update({
      where: { id },
      data: this.enterpriseData(data),
      include: enterpriseInclude,
    });
  }

  async deleteEnterprise(id: string, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureEnterprise(id);
    return this.prisma.prumareEnterprise.delete({ where: { id } });
  }

  findBrokers(role?: string | null) {
    ensureManageAccess(role);
    return this.prisma.prumareBroker.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  createBroker(data: any, role?: string | null) {
    ensureManageAccess(role);
    return this.prisma.prumareBroker.create({
      data: this.brokerData(data),
    });
  }

  async updateBroker(id: string, data: any, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureBroker(id);
    return this.prisma.prumareBroker.update({
      where: { id },
      data: this.brokerData(data),
    });
  }

  async deleteBroker(id: string, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureBroker(id);
    return this.prisma.prumareBroker.update({
      where: { id },
      data: { active: false },
    });
  }

  findIpcaIndexes(role?: string | null) {
    ensureManageAccess(role);
    return this.prisma.prumareIpcaIndex.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async upsertIpcaIndex(data: any, role?: string | null) {
    ensureManageAccess(role);

    const year = Math.trunc(numberValue(data?.year, 'Ano'));
    const month = Math.trunc(numberValue(data?.month, 'Mes'));
    const percent = normalizePositivePercent(
      numberValue(data?.percent, 'IPCA'),
    );

    if (year < 2000 || year > 2200) {
      throw new BadRequestException('Ano invalido');
    }
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mes deve ficar entre 1 e 12');
    }
    const index = await this.prisma.prumareIpcaIndex.upsert({
      where: {
        year_month: {
          year,
          month,
        },
      },
      create: {
        year,
        month,
        percent: percent as any,
        notes: optionalText(data?.notes),
      },
      update: {
        percent: percent as any,
        notes: optionalText(data?.notes),
      },
    });

    await this.rebuildReceivablesForSoldLots();
    return index;
  }

  async deleteIpcaIndex(id: string, role?: string | null) {
    ensureManageAccess(role);
    const index = await this.prisma.prumareIpcaIndex.findUnique({
      where: { id },
    });

    if (!index) {
      throw new NotFoundException('IPCA nao encontrado');
    }

    await this.prisma.prumareIpcaIndex.delete({ where: { id } });
    await this.rebuildReceivablesForSoldLots();
    return index;
  }

  async findReceivables(filters: any, role?: string | null) {
    ensureManageAccess(role);

    const enterpriseId = optionalText(filters?.enterpriseId);
    if (enterpriseId) {
      await this.ensureEnterprise(enterpriseId);
    }

    const dateFrom = optionalDate(filters?.dateFrom, 'Data inicial');
    const dateTo = optionalDate(filters?.dateTo, 'Data final');
    const endDate = dateTo ? new Date(dateTo) : null;
    endDate?.setUTCHours(23, 59, 59, 999);

    return this.prisma.prumareReceivable.findMany({
      where: {
        ...(enterpriseId ? { enterpriseId } : {}),
        ...(dateFrom || endDate
          ? {
              dueDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(endDate ? { lte: endDate } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { type: 'asc' }, { installmentNo: 'asc' }],
      select: receivableSelect,
    });
  }

  async findPriceAdjustments(filters: any, role?: string | null) {
    ensureManageAccess(role);

    const enterpriseId = optionalText(filters?.enterpriseId);
    if (enterpriseId) {
      await this.ensureEnterprise(enterpriseId);
    }

    return this.prisma.prumarePriceAdjustment.findMany({
      where: enterpriseId ? { enterpriseId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        enterprise: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async findLots(enterpriseId: string, role?: string | null) {
    ensureAccess(role);
    await this.ensureEnterprise(enterpriseId);

    const lots = await this.prisma.prumareLot.findMany({
      where: { enterpriseId },
      orderBy: [{ block: 'asc' }, { lot: 'asc' }],
      include: lotInclude,
    });

    lots.sort(compareLotIdentification);

    return isBrokerRole(role)
      ? lots.map((lot) => this.commercialLotView(lot))
      : lots;
  }

  async findAllLots(role?: string | null) {
    ensureManageAccess(role);

    const lots = await this.prisma.prumareLot.findMany({
      orderBy: [
        { enterprise: { name: 'asc' } },
        { block: 'asc' },
        { lot: 'asc' },
      ],
      include: lotWithEnterpriseInclude,
    });

    return lots.sort((left, right) => {
      const enterpriseOrder = left.enterprise.name.localeCompare(
        right.enterprise.name,
        'pt-BR',
        { numeric: true, sensitivity: 'base' },
      );
      return enterpriseOrder || compareLotIdentification(left, right);
    });
  }

  async createLot(enterpriseId: string, data: any, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureEnterprise(enterpriseId);
    const lotData = await this.lotData(data);

    let lot;
    try {
      lot = await this.prisma.prumareLot.create({
        data: {
          enterpriseId,
          ...lotData,
        },
        include: lotInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `O lote ${lotData.block}-${lotData.lot} ja esta cadastrado neste empreendimento. Para alterar os dados, edite o lote existente.`,
        );
      }
      throw error;
    }

    await this.rebuildReceivablesForLot(lot.id);
    return lot;
  }

  async updateLot(lotId: string, data: any, role?: string | null) {
    ensureManageAccess(role);
    const currentLot = await this.ensureLot(lotId);
    const lotData = await this.lotData(data);

    if (currentLot.status === 'Caucionado' && lotData.status === 'Vendido') {
      throw new BadRequestException(
        'Lote caucionado nao pode ser vendido. Altere primeiro a situacao para Disponivel.',
      );
    }

    const lot = await this.prisma.prumareLot.update({
      where: { id: lotId },
      data: lotData,
      include: lotInclude,
    });

    await this.rebuildReceivablesForLot(lot.id);
    return lot;
  }

  async applyPriceAdjustment(
    enterpriseId: string,
    data: any,
    role?: string | null,
    actorId?: string | null,
  ) {
    ensureManageAccess(role);
    await this.ensureEnterprise(enterpriseId);

    const percent = numberValue(data?.percent, 'Percentual de reajuste');
    if (percent <= 0) {
      throw new BadRequestException(
        'Percentual de reajuste deve ser maior que zero',
      );
    }
    if (percent > 100) {
      throw new BadRequestException('Percentual de reajuste muito alto');
    }

    const note = optionalText(data?.note);
    const factor = 1 + percent / 100;

    return this.prisma.$transaction(async (tx) => {
      const lots = await tx.prumareLot.findMany({
        where: {
          enterpriseId,
          status: {
            in: ['Disponivel', 'Reservado'],
          },
        },
        select: {
          id: true,
          price: true,
        },
      });

      if (!lots.length) {
        throw new BadRequestException(
          'Nao ha lotes disponiveis ou reservados para reajustar',
        );
      }

      const previousTotal = money(
        lots.reduce((sum, lot) => sum + Number(lot.price), 0),
      );
      const updates = lots.map((lot) => ({
        id: lot.id,
        newPrice: money(Number(lot.price) * factor),
      }));
      const newTotal = money(
        updates.reduce((sum, item) => sum + item.newPrice, 0),
      );

      await Promise.all(
        updates.map((item) =>
          tx.prumareLot.update({
            where: { id: item.id },
            data: {
              price: new Prisma.Decimal(item.newPrice.toFixed(2)),
            },
          }),
        ),
      );

      const adjustment = await tx.prumarePriceAdjustment.create({
        data: {
          enterpriseId,
          percent: new Prisma.Decimal(percent.toFixed(4)),
          affectedLots: lots.length,
          previousTotal: new Prisma.Decimal(previousTotal.toFixed(2)),
          newTotal: new Prisma.Decimal(newTotal.toFixed(2)),
          note,
          createdBy: actorId ?? null,
        },
        include: {
          enterprise: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        adjustment,
        affectedLots: lots.length,
        previousTotal,
        newTotal,
        gain: money(newTotal - previousTotal),
      };
    });
  }

  async deleteLot(lotId: string, role?: string | null) {
    ensureManageAccess(role);
    await this.ensureLot(lotId);
    return this.prisma.prumareLot.delete({ where: { id: lotId } });
  }

  async simulatePrice(
    data: any,
    role?: string | null,
    actorId?: string | null,
  ) {
    ensureAccess(role);

    const totalValue = numberValue(data?.totalValue, 'Valor total');
    const downPayment = numberValue(data?.downPayment ?? 0, 'Entrada');
    const installments = Math.trunc(
      numberValue(data?.installments, 'Parcelas'),
    );
    const monthlyRatePercent = numberValue(
      data?.monthlyRatePercent ?? 0,
      'Taxa de juros',
    );
    const annualReinforcement = numberValue(
      data?.annualReinforcement ?? 0,
      'Reforco anual',
    );

    const results = buildPriceSchedule(
      totalValue,
      downPayment,
      installments,
      monthlyRatePercent,
      annualReinforcement,
    );

    if (data?.save && !canManagePrumare(role)) {
      throw new ForbiddenException('Sem permissao para salvar simulacoes');
    }

    if (data?.save && data?.enterpriseId) {
      await this.prisma.prumareSimulation.create({
        data: {
          enterpriseId: data.enterpriseId,
          lotId: optionalText(data?.lotId),
          kind: 'PRICE',
          title: optionalText(data?.title),
          createdBy: actorId ?? null,
          inputs: data as Prisma.InputJsonValue,
          results: results as Prisma.InputJsonValue,
        },
      });
    }

    return results;
  }

  async simulateTable(
    enterpriseId: string,
    data: any,
    role?: string | null,
    actorId?: string | null,
  ) {
    ensureAccess(role);
    await this.ensureEnterprise(enterpriseId);

    const entryPercent = numberValue(data?.entryPercent ?? 5, 'Entrada');
    const reinforcementPercent = numberValue(
      data?.reinforcementPercent ?? 25,
      'Percentual dos reforcos',
    );
    if (reinforcementPercent < 0 || reinforcementPercent >= 100) {
      throw new BadRequestException(
        'Percentual dos reforcos deve ser maior ou igual a 0 e menor que 100',
      );
    }
    const scenarios = Array.isArray(data?.scenarios)
      ? data.scenarios
          .map((item) => ({
            installments: Math.trunc(
              numberValue(item?.installments, 'Parcelas'),
            ),
            monthlyRatePercent: numberValue(
              item?.monthlyRatePercent ?? 0,
              'Taxa de juros',
            ),
          }))
          .filter((item) => item.installments > 0)
          .slice(0, 5)
      : [];

    if (scenarios.length === 0) {
      throw new BadRequestException('Informe ao menos um cenario');
    }

    const lots = await this.prisma.prumareLot.findMany({
      where: { enterpriseId },
      orderBy: [{ block: 'asc' }, { lot: 'asc' }],
      include: lotInclude,
    });

    const rows = lots.map((lot) => {
      const price = Number(lot.price);
      const downPayment = money(price * (entryPercent / 100));
      const initialBalance = money(price - downPayment);
      const scenarioResults = scenarios.map((scenario) => {
        const reinforcementCount = Math.floor(scenario.installments / 12);
        const annualReinforcement =
          reinforcementCount > 0
            ? mRound(
                (initialBalance * (reinforcementPercent / 100)) /
                  reinforcementCount,
                500,
              )
            : 0;
        if (
          initialBalance > 0 &&
          reinforcementCount > 0 &&
          annualReinforcement * reinforcementCount >= initialBalance
        ) {
          throw new BadRequestException(
            `Percentual dos reforcos alto demais para o lote ${lot.block}/${lot.lot}; reduza o percentual`,
          );
        }
        const payment = calculatePayment(
          initialBalance,
          scenario.installments,
          scenario.monthlyRatePercent / 100,
          buildLegacyReinforcementSchedule(
            scenario.installments,
            annualReinforcement,
          ),
        );

        return {
          installments: scenario.installments,
          monthlyRatePercent: scenario.monthlyRatePercent,
          reinforcementCount,
          annualReinforcement: money(annualReinforcement),
          payment,
        };
      });

      const row = {
        id: lot.id,
        block: lot.block,
        lot: lot.lot,
        areaM2: lot.areaM2 ? Number(lot.areaM2) : null,
        price: money(price),
        downPayment,
        initialBalance,
        status: lot.status,
        broker: lot.broker,
        buyerName: lot.buyerName,
        soldAt: lot.soldAt,
        salePrice: lot.salePrice ? money(Number(lot.salePrice)) : null,
        paymentCondition: lot.paymentCondition,
        saleNotes: lot.saleNotes,
        scenarios: scenarioResults,
      };

      return isBrokerRole(role) ? this.commercialTableRowView(row) : row;
    });

    const results = {
      entryPercent,
      reinforcementPercent,
      scenarios,
      rows,
    };

    if (data?.save && !canManagePrumare(role)) {
      throw new ForbiddenException('Sem permissao para salvar simulacoes');
    }

    if (data?.save) {
      await this.prisma.prumareSimulation.create({
        data: {
          enterpriseId,
          kind: 'TABLE',
          title: optionalText(data?.title) ?? 'Tabela de vendas',
          createdBy: actorId ?? null,
          inputs: data as Prisma.InputJsonValue,
          results: results as Prisma.InputJsonValue,
        },
      });
    }

    return results;
  }

  async rebuildReceivablesForLot(lotId: string) {
    const lot = await this.prisma.prumareLot.findUnique({
      where: { id: lotId },
    });

    await this.prisma.prumareReceivable.deleteMany({ where: { lotId } });

    if (!lot || lot.status !== 'Vendido') {
      return { created: 0 };
    }

    const ipcaIndexes = await this.loadIpcaIndexesAscending();
    const receivables = this.buildReceivablesForLot(lot, ipcaIndexes);

    if (receivables.length) {
      await this.prisma.prumareReceivable.createMany({
        data: receivables,
      });
    }

    return { created: receivables.length };
  }

  private async rebuildReceivablesForSoldLots() {
    const [lots, ipcaIndexes] = await Promise.all([
      this.prisma.prumareLot.findMany({ where: { status: 'Vendido' } }),
      this.loadIpcaIndexesAscending(),
    ]);

    const receivables = lots.flatMap((lot) =>
      this.buildReceivablesForLot(lot, ipcaIndexes),
    );

    await this.prisma.prumareReceivable.deleteMany({});

    if (receivables.length) {
      await this.prisma.prumareReceivable.createMany({
        data: receivables,
      });
    }

    return { created: receivables.length };
  }

  private loadIpcaIndexesAscending() {
    return this.prisma.prumareIpcaIndex.findMany({
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
  }

  private commercialLotView(lot: any) {
    return {
      id: lot.id,
      enterpriseId: lot.enterpriseId,
      block: lot.block,
      lot: lot.lot,
      areaM2: lot.areaM2,
      price: lot.price,
      status: lot.status,
      brokerId: lot.brokerId,
      broker: lot.broker,
      mapX: lot.mapX,
      mapY: lot.mapY,
      createdAt: lot.createdAt,
      updatedAt: lot.updatedAt,
    };
  }

  private commercialTableRowView(row: any) {
    return {
      id: row.id,
      block: row.block,
      lot: row.lot,
      areaM2: row.areaM2,
      price: row.price,
      downPayment: row.downPayment,
      initialBalance: row.initialBalance,
      status: row.status,
      broker: row.broker,
      scenarios: row.scenarios,
    };
  }

  private buildReceivablesForLot(
    lot: {
      id: string;
      enterpriseId: string;
      price: Prisma.Decimal;
      status: string;
      soldAt: Date | null;
      salePrice: Prisma.Decimal | null;
      saleDownPayment: Prisma.Decimal | null;
      saleDownPayments: Prisma.JsonValue | null;
      saleInstallments: number | null;
      saleFirstInstallmentDate: Date | null;
      saleDueDay: number | null;
      saleCustomInstallments: Prisma.JsonValue | null;
      saleReinforcements: Prisma.JsonValue | null;
      saleAnnualReinforcement: Prisma.Decimal | null;
      saleFirstReinforcementInstallment: number | null;
      saleReinforcementMonths: number[];
      saleMonthlyRatePercent: Prisma.Decimal | null;
      saleBrokerCommission: Prisma.Decimal | null;
      saleBarters: Prisma.JsonValue | null;
    },
    ipcaIndexes: IpcaIndex[],
  ) {
    if (lot.status !== 'Vendido') return [];

    const now = new Date();
    const totalValue = money(Number(lot.salePrice ?? lot.price));
    const fallbackDownPayment = money(Number(lot.saleDownPayment ?? 0));
    const saleDownPayments = saleDownPaymentsFromJson(
      lot.saleDownPayments,
      fallbackDownPayment,
      lot.soldAt,
    );
    const downPayment = money(
      saleDownPayments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    const installments = lot.saleInstallments ?? 0;
    const firstInstallmentDate = lot.saleFirstInstallmentDate ?? lot.soldAt;
    const annualReinforcement = money(Number(lot.saleAnnualReinforcement ?? 0));
    const firstReinforcementInstallment =
      lot.saleFirstReinforcementInstallment &&
      lot.saleFirstReinforcementInstallment > 0
        ? Math.trunc(lot.saleFirstReinforcementInstallment)
        : null;
    const reinforcementMonths = lot.saleReinforcementMonths ?? [];
    const saleCustomInstallments = saleCustomInstallmentsFromJson(
      lot.saleCustomInstallments,
    );
    const saleReinforcements = saleReinforcementsFromJson(
      lot.saleReinforcements,
    );
    const monthlyRatePercent =
      normalizeMonthlyRatePercent(Number(lot.saleMonthlyRatePercent ?? 0)) ?? 0;
    const brokerCommission =
      normalizeBrokerCommission(
        Number(lot.saleBrokerCommission ?? 0),
        totalValue,
      ) ?? 0;
    const saleBarters = saleBartersFromJson(lot.saleBarters);
    const barterTotal = money(
      saleBarters.reduce((sum, barter) => sum + barter.amount, 0),
    );
    const effectiveDownPayment = money(downPayment + barterTotal);
    const rows: any[] = [];

    saleDownPayments.forEach((payment, index) => {
      const dueDate = optionalDate(
        payment.dueDate,
        `Data de pagamento da entrada ${index + 1}`,
      );
      if (!dueDate) return;

      rows.push({
        enterpriseId: lot.enterpriseId,
        lotId: lot.id,
        type: 'ENTRADA',
        installmentNo: index + 1,
        dueDate,
        baseValue: payment.amount as any,
        correctedValue: payment.amount as any,
        appliedIpcaRate: 0 as any,
        ipcaSnapshot: [] as Prisma.InputJsonValue,
        updatedAt: now,
      });
    });

    saleBarters.forEach((barter, index) => {
      const dueDate = optionalDate(
        barter.entryDate,
        `Data de entrada da permuta ${index + 1}`,
      );
      if (!dueDate) return;

      rows.push({
        enterpriseId: lot.enterpriseId,
        lotId: lot.id,
        type: 'PERMUTA',
        installmentNo: index + 1,
        dueDate,
        baseValue: barter.amount as any,
        correctedValue: barter.amount as any,
        appliedIpcaRate: 0 as any,
        ipcaSnapshot: [] as Prisma.InputJsonValue,
        updatedAt: now,
      });
    });

    if (brokerCommission > 0) {
      const dueDate = lot.soldAt ?? now;
      rows.push({
        enterpriseId: lot.enterpriseId,
        lotId: lot.id,
        type: 'COMISSAO',
        installmentNo: null,
        dueDate,
        baseValue: -brokerCommission as any,
        correctedValue: -brokerCommission as any,
        appliedIpcaRate: 0 as any,
        ipcaSnapshot: [] as Prisma.InputJsonValue,
        updatedAt: now,
      });
    }

    if (saleReinforcements.length > 0) {
      const ipcaStartDate = firstInstallmentDate ?? lot.soldAt ?? now;
      saleReinforcements.forEach((reinforcement, index) => {
        const dueDate = optionalDate(
          reinforcement.dueDate,
          `Data prevista do reforco ${index + 1}`,
        );
        if (!dueDate) return;

        const indexes = monthlyIpcaForPeriod(
          ipcaIndexes,
          ipcaStartDate,
          dueDate,
        );
        const reinforcementCorrection = correctedReceivableValue(
          reinforcement.amount,
          indexes,
        );

        rows.push({
          enterpriseId: lot.enterpriseId,
          lotId: lot.id,
          type: 'REFORCO',
          installmentNo: index + 1,
          dueDate,
          baseValue: reinforcement.amount as any,
          correctedValue: reinforcementCorrection.correctedValue as any,
          appliedIpcaRate: reinforcementCorrection.appliedIpcaRate as any,
          ipcaSnapshot:
            reinforcementCorrection.ipcaSnapshot as Prisma.InputJsonValue,
          updatedAt: now,
        });
      });
    }

    if (saleCustomInstallments.length > 0) {
      const ipcaStartDate = firstInstallmentDate ?? lot.soldAt ?? now;
      saleCustomInstallments.forEach((customInstallment, index) => {
        const dueDate = optionalDate(
          customInstallment.dueDate,
          `Data da parcela personalizada ${index + 1}`,
        );
        if (!dueDate) return;

        const indexes = monthlyIpcaForPeriod(
          ipcaIndexes,
          ipcaStartDate,
          dueDate,
        );
        const parcelCorrection = correctedReceivableValue(
          customInstallment.amount,
          indexes,
        );

        rows.push({
          enterpriseId: lot.enterpriseId,
          lotId: lot.id,
          type: 'PARCELA',
          installmentNo: index + 1,
          dueDate,
          baseValue: customInstallment.amount as any,
          correctedValue: parcelCorrection.correctedValue as any,
          appliedIpcaRate: parcelCorrection.appliedIpcaRate as any,
          ipcaSnapshot: parcelCorrection.ipcaSnapshot as Prisma.InputJsonValue,
          updatedAt: now,
        });
      });

      return rows;
    }

    if (
      !firstInstallmentDate ||
      installments <= 0 ||
      effectiveDownPayment >= totalValue
    ) {
      return rows;
    }

    const schedule = buildPriceSchedule(
      totalValue,
      effectiveDownPayment,
      installments,
      monthlyRatePercent,
      saleReinforcements.length > 0 ? 0 : annualReinforcement,
      saleReinforcements.length > 0 ? [] : reinforcementMonths,
      firstInstallmentDate,
      lot.saleDueDay,
      saleReinforcements.length > 0 ? null : firstReinforcementInstallment,
    );

    schedule.rows.forEach((scheduleRow, index) => {
      const dueDate = resolveInstallmentDueDate(
        firstInstallmentDate,
        index,
        lot.saleDueDay,
      );
      const indexes = monthlyIpcaForPeriod(
        ipcaIndexes,
        firstInstallmentDate,
        dueDate,
      );
      const parcelCorrection = correctedReceivableValue(
        scheduleRow.payment,
        indexes,
      );

      rows.push({
        enterpriseId: lot.enterpriseId,
        lotId: lot.id,
        type: 'PARCELA',
        installmentNo: scheduleRow.month,
        dueDate,
        baseValue: scheduleRow.payment as any,
        correctedValue: parcelCorrection.correctedValue as any,
        appliedIpcaRate: parcelCorrection.appliedIpcaRate as any,
        ipcaSnapshot: parcelCorrection.ipcaSnapshot as Prisma.InputJsonValue,
        updatedAt: now,
      });

      if (scheduleRow.reinforcement > 0) {
        const reinforcementCorrection = correctedReceivableValue(
          scheduleRow.reinforcement,
          indexes,
        );
        rows.push({
          enterpriseId: lot.enterpriseId,
          lotId: lot.id,
          type: 'REFORCO',
          installmentNo: scheduleRow.month,
          dueDate,
          baseValue: scheduleRow.reinforcement as any,
          correctedValue: reinforcementCorrection.correctedValue as any,
          appliedIpcaRate: reinforcementCorrection.appliedIpcaRate as any,
          ipcaSnapshot:
            reinforcementCorrection.ipcaSnapshot as Prisma.InputJsonValue,
          updatedAt: now,
        });
      }
    });

    return rows;
  }

  private enterpriseData(data: any): any {
    const status = optionalText(data?.status) ?? 'Lancamento';
    if (!ENTERPRISE_STAGES.includes(status)) {
      throw new BadRequestException('Etapa do empreendimento invalida');
    }

    return {
      name: requiredText(data?.name, 'Nome do empreendimento'),
      tableName: optionalText(data?.tableName),
      registry: optionalText(data?.registry),
      location: optionalText(data?.location),
      city: optionalText(data?.city),
      mapUrl: optionalText(data?.mapUrl),
      status,
      deliveryForecast: optionalText(data?.deliveryForecast),
      vgvTarget: optionalNumber(data?.vgvTarget, 'VGV meta') as any,
      photoUrl: optionalText(data?.photoUrl),
      mapImageUrl: optionalText(data?.mapImageUrl),
      mapImageWidth: optionalPositiveInteger(
        data?.mapImageWidth,
        'Largura da planta',
      ),
      mapImageHeight: optionalPositiveInteger(
        data?.mapImageHeight,
        'Altura da planta',
      ),
      notes: optionalText(data?.notes),
    };
  }

  private brokerData(data: any): any {
    return {
      name: requiredText(data?.name, 'Nome do corretor'),
      phone: optionalText(data?.phone),
      email: optionalText(data?.email),
      active: data?.active === undefined ? true : Boolean(data.active),
    };
  }

  private async lotData(data: any): Promise<any> {
    const status = optionalText(data?.status) ?? 'Disponivel';
    if (!LOT_STATUSES.includes(status)) {
      throw new BadRequestException('Situacao do lote invalida');
    }

    const brokerId = optionalText(data?.brokerId);
    if (brokerId) {
      await this.ensureBroker(brokerId);
    }

    const price = numberValue(data?.price, 'Valor');
    const salePrice =
      status === 'Vendido'
        ? (optionalNumber(data?.salePrice, 'Valor vendido') ?? price)
        : null;
    const soldAt =
      status === 'Vendido'
        ? (optionalDate(data?.soldAt, 'Data da venda') ?? new Date())
        : null;
    const saleInstallments =
      status === 'Vendido'
        ? optionalInteger(data?.saleInstallments, 'Numero de parcelas')
        : null;
    const saleDueDay =
      status === 'Vendido'
        ? optionalInteger(data?.saleDueDay, 'Dia de vencimento')
        : null;
    const saleReinforcementMonths =
      status === 'Vendido'
        ? optionalMonthList(data?.saleReinforcementMonths, 'Meses de reforco')
        : [];
    const saleFirstReinforcementInstallment =
      status === 'Vendido'
        ? optionalInteger(
            data?.saleFirstReinforcementInstallment,
            'Primeira parcela do reforco',
          )
        : null;
    const saleDownPayments =
      status === 'Vendido'
        ? optionalSaleDownPayments(data?.saleDownPayments)
        : [];
    const saleCustomInstallments =
      status === 'Vendido'
        ? optionalSaleCustomInstallments(data?.saleCustomInstallments)
        : [];
    const saleReinforcements =
      status === 'Vendido'
        ? optionalSaleReinforcements(data?.saleReinforcements)
        : [];
    const saleDownPaymentTotal = money(
      saleDownPayments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    const saleBarters =
      status === 'Vendido' ? optionalSaleBarters(data?.saleBarters) : [];

    if (saleInstallments !== null && saleInstallments < 0) {
      throw new BadRequestException('Numero de parcelas invalido');
    }
    if (
      saleFirstReinforcementInstallment !== null &&
      saleFirstReinforcementInstallment <= 0
    ) {
      throw new BadRequestException('Primeira parcela do reforco invalida');
    }

    if (saleDueDay !== null && (saleDueDay < 1 || saleDueDay > 31)) {
      throw new BadRequestException(
        'Dia de vencimento deve ficar entre 1 e 31',
      );
    }

    return {
      block: requiredText(data?.block, 'Quadra'),
      lot: requiredText(data?.lot, 'Lote'),
      areaM2: optionalNumber(data?.areaM2, 'Area') as any,
      price: price as any,
      status,
      brokerId,
      buyerName: status === 'Vendido' ? optionalText(data?.buyerName) : null,
      soldAt,
      salePrice: salePrice as any,
      saleContractNumber:
        status === 'Vendido' ? optionalText(data?.saleContractNumber) : null,
      saleDownPayment:
        status === 'Vendido'
          ? ((saleDownPaymentTotal ||
              optionalNumber(data?.saleDownPayment, 'Valor de entrada')) as any)
          : null,
      saleDownPayments:
        status === 'Vendido'
          ? (saleDownPayments as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      saleInstallments,
      saleFirstInstallmentDate:
        status === 'Vendido'
          ? optionalDate(
              data?.saleFirstInstallmentDate,
              'Data inicio das parcelas',
            )
          : null,
      saleDueDay,
      saleCustomInstallments:
        status === 'Vendido'
          ? (saleCustomInstallments as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      saleReinforcements:
        status === 'Vendido'
          ? (saleReinforcements as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      saleAnnualReinforcement:
        status === 'Vendido'
          ? (optionalNumber(
              data?.saleAnnualReinforcement,
              'Reforco anual',
            ) as any)
          : null,
      saleFirstReinforcementInstallment,
      saleReinforcementMonths,
      saleMonthlyRatePercent:
        status === 'Vendido'
          ? (normalizeMonthlyRatePercent(
              optionalNumber(data?.saleMonthlyRatePercent, 'Juros a.m.'),
            ) as any)
          : null,
      saleBrokerCommission:
        status === 'Vendido'
          ? (normalizeBrokerCommission(
              optionalNumber(
                data?.saleBrokerCommission,
                'Comissao do corretor',
              ),
              salePrice,
            ) as any)
          : null,
      saleBarters:
        status === 'Vendido'
          ? (saleBarters as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      paymentCondition:
        status === 'Vendido' ? optionalText(data?.paymentCondition) : null,
      saleNotes: status === 'Vendido' ? optionalText(data?.saleNotes) : null,
      mapX:
        data?.mapX === undefined
          ? undefined
          : optionalMapCoordinate(data?.mapX, 'Posicao X do mapa'),
      mapY:
        data?.mapY === undefined
          ? undefined
          : optionalMapCoordinate(data?.mapY, 'Posicao Y do mapa'),
    };
  }

  private async ensureEnterprise(id: string) {
    const enterprise = await this.prisma.prumareEnterprise.findUnique({
      where: { id },
    });

    if (!enterprise) {
      throw new NotFoundException('Empreendimento nao encontrado');
    }

    return enterprise;
  }

  private async ensureLot(id: string) {
    const lot = await this.prisma.prumareLot.findUnique({
      where: { id },
    });

    if (!lot) {
      throw new NotFoundException('Lote nao encontrado');
    }

    return lot;
  }

  private async ensureBroker(id: string) {
    const broker = await this.prisma.prumareBroker.findUnique({
      where: { id },
    });

    if (!broker) {
      throw new NotFoundException('Corretor nao encontrado');
    }

    return broker;
  }
}
