import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  COST_PURCHASES_PRESENTATION_CONTRACT_VERSION,
  CostPurchasesManagerialPresentationDto,
  CostPurchasesPresentationActor,
  CostPurchasesPresentationCell,
  CostPurchasesPresentationKind,
  CostPurchasesPresentationMonth,
  CostPurchasesPresentationNote,
  CostPurchasesPresentationQuery,
  CostPurchasesPresentationRow,
  CostPurchasesPresentationSlide,
  CostPurchasesPresentationSlideGroup,
  CostPurchasesPresentationStatus,
} from './cost-purchases-presentation.dto';
import { CostPurchasesService } from './cost-purchases.service';

const MIN_COMPETENCE = '2025-01';
const MAX_MONTHS_PER_PAGE = 12;
const MAX_ROWS_PER_PAGE = 7;
const ROWS_PER_PAGE_BY_SLIDE: Record<string, number> = {
  CONTAS_PRINCIPAIS: 12,
  OFICINA: 13,
  CAMINHOES: 10,
  MAQUINAS: 11,
  VEICULOS: 9,
};
const SOURCE_READ_CONCURRENCY = 2;
const PRESENTATION_CACHE_TTL_SECONDS = 120 as const;
const PRESENTATION_CACHE_TTL_MS = PRESENTATION_CACHE_TTL_SECONDS * 1000;
const PRESENTATION_CACHE_MAX_ENTRIES = 8;

const BLOCK_TITLES: Record<string, string> = {
  OFICINA: 'Oficina',
  SUPRIMENTOS: 'Suprimentos',
  CAMINHOES: 'Caminhões JR Construções',
  MAQUINAS: 'Máquinas JR Construções',
  VEICULOS: 'Veículos JR Construções',
  BRITADOR: 'Britador / Pedraforte',
  USINAS: 'Usinas',
};

const PRESENTATION_UNIT_BY_KIND: Record<CostPurchasesPresentationKind, string> = {
  MONEY: 'R$',
  LITERS: 'L',
  PRICE_PER_LITER: 'R$/L',
  QUANTITY: 'un.',
  USAGE: 'km',
  AVERAGE: 'km/L',
  LITERS_PER_HOUR: 'L/h',
};

const PRESENTATION_LINE_LABELS: Record<string, Record<number, string>> = {
  OFICINA: {
    9: 'Mão de obra — equipe de manutenção',
    10: 'Mão de obra — almoxarifado da manutenção',
    11: 'Mão de obra de apoio — comboios',
    12: 'Mão de obra de apoio — rampa e lavação',
    14: 'Carros da manutenção e seguros',
    15: 'Locação dos carros da manutenção',
    16: 'Locação dos comboios',
    17: 'Outras despesas dos comboios',
    22: 'Total das despesas para rateio',
  },
  SUPRIMENTOS: {
    26: 'Mão de obra do setor de Suprimentos',
    28: 'Total das despesas de Suprimentos',
  },
  CAMINHOES: {
    31: 'Diesel — valor total',
    32: 'Manutenção e seguros dos caminhões',
    33: 'Mão de obra rateada das equipes',
    34: 'Total das despesas dos caminhões',
    36: 'Diesel — volume',
    37: 'Quantidade de caminhões JR Construções',
    40: 'Caminhões-caçamba (truck)',
    41: 'Carretas caçamba',
    42: 'Pranchas de transporte',
    43: 'Caminhões-comboio',
  },
  MAQUINAS: {
    46: 'Diesel — valor total',
    47: 'Manutenção das máquinas',
    48: 'Mão de obra rateada das equipes',
    49: 'Total das despesas das máquinas',
    51: 'Diesel — volume',
    52: 'Quantidade de máquinas JR Construções',
    56: 'Escavadeiras hidráulicas',
    57: 'Motoniveladoras',
    58: 'Rolos compactadores',
    59: 'Tratores de esteira',
    60: 'Carregadeiras',
  },
  VEICULOS: {
    63: 'Combustíveis — valor total',
    64: 'Manutenção e seguros dos veículos',
    65: 'Mão de obra rateada das equipes',
    66: 'Total das despesas dos veículos',
    68: 'Gasolina e diesel — volume',
    69: 'Quantidade de veículos JR Construções',
    72: 'Carros',
    73: 'Caminhonetes',
    74: 'Ônibus',
  },
  BRITADOR: {
    77: 'Diesel da Pedraforte — valor total',
    78: 'Gasolina da Pedraforte — valor total',
    79: 'Manutenção — carros e Toyota Bandeirante',
    80: 'Manutenção — caminhões',
    81: 'Manutenção — máquinas',
    82: 'Mão de obra rateada das equipes',
    83: 'Total das despesas do Britador / Pedraforte',
    85: 'Diesel da Pedraforte — volume',
    86: 'Gasolina da Pedraforte — volume',
    87: 'Quantidade de caminhões',
    88: 'Quantidade de máquinas',
    89: 'Quantidade de carros e Toyota Bandeirante',
    90: 'Quantidade de perfuratrizes e compressores',
    93: 'Caminhões-caçamba (truck)',
    94: 'Caminhões VMX 360',
    95: 'Escavadeiras hidráulicas',
    96: 'Carregadeira 962 do britador — frota 151',
    97: 'Carregadeira 656D fora do britador — frota 209',
    98: 'Toyota Bandeirante',
    99: 'Carros e demais veículos',
  },
  USINAS: {
    117: 'Diesel da Usina Ciber Inova 1200',
    118: 'Manutenção da Usina Ciber Inova 1200',
    119: 'Diesel da Usina Lintec CSD 2500',
    120: 'Manutenção da Usina Lintec CSD 2500',
    121: 'Total das despesas das usinas',
  },
};

type ManagerialRowDefinition = {
  key: string;
  label: string;
  section: string | null;
  kind: CostPurchasesPresentationKind;
  contributesToTotal: boolean;
  sourceCode: string | null;
  source: string;
  formula: string | null;
  pendingMapping?: boolean;
};

type SlideDefinition = {
  code: string;
  baseSlide: number;
  title: string;
  description: string;
  blocks?: string[];
  layout?: 'TABLE' | 'TABLE_CHART' | 'TABLE_SELECTABLE_CHART' | 'CHART';
  managerialSourceSlide?: number;
};

const MANAGERIAL_ROWS: Record<number, ManagerialRowDefinition[]> = {
  2: [
    managerialRow(
      'USINA',
      'Compras e despesas da Usina (R$)',
      'MONEY',
      true,
      'Entradas finalizadas (CAL) + contas a pagar DOP sem documento duplicado',
      'CAL + DOP sem documentos duplicados',
    ),
    managerialRow(
      'OLEO_RESIVALE',
      'Óleo para queima — Resivale/JR (R$)',
      'MONEY',
      true,
      'Entradas finalizadas classificadas no item gerencial vigente',
    ),
    managerialRow(
      'ANTIADERENTE_REMOTIN',
      'Antiaderente (R$)',
      'MONEY',
      true,
      'Entradas finalizadas classificadas no item gerencial vigente',
    ),
    managerialRow(
      'PRODUTOS_ASFALTICOS',
      'Produtos asfálticos — CAP, RR e semi-imprima (R$)',
      'MONEY',
      true,
      'Entradas finalizadas classificadas como CAP, RR e semi-imprima',
      'CAP + RR + SEMI_IMPRIMA',
    ),
    managerialRow(
      'DIESEL',
      'Diesel — valor total (R$)',
      'MONEY',
      true,
      'Entradas finalizadas classificadas como diesel',
    ),
    managerialRow(
      'DIESEL_LITROS',
      'Diesel — volume (L)',
      'LITERS',
      false,
      'Entradas finalizadas classificadas como diesel',
    ),
    managerialRow(
      'DIESEL_PRECO_MEDIO',
      'Diesel — preço médio (R$/L)',
      'PRICE_PER_LITER',
      false,
      'Entradas finalizadas classificadas como diesel',
      'valor de diesel / litros de diesel',
    ),
    managerialRow(
      'GASOLINA',
      'Gasolina — valor total (R$)',
      'MONEY',
      true,
      'Abastecimentos finalizados do plano 131',
    ),
    managerialRow(
      'GASOLINA_LITROS',
      'Gasolina — volume (L)',
      'LITERS',
      false,
      'Abastecimentos finalizados do plano 131',
    ),
    managerialRow(
      'GASOLINA_PRECO_MEDIO',
      'Gasolina — preço médio (R$/L)',
      'PRICE_PER_LITER',
      false,
      'Abastecimentos finalizados do plano 131',
      'valor de gasolina / litros de gasolina',
    ),
    managerialRow(
      'MANUTENCAO',
      'Manutenção da frota elegível (R$)',
      'MONEY',
      true,
      'Relatório mensal da frota elegível',
      'despesa total elegível - abastecimento total elegível',
    ),
    managerialRow(
      'TOTAL',
      'Total geral das contas (R$)',
      'MONEY',
      false,
      'Contas oficiais atualmente mapeadas no JR',
      'soma das sete linhas monetárias mapeadas, uma vez cada',
    ),
  ],
};

const SLIDES: SlideDefinition[] = [
  {
    code: 'CONTAS_PRINCIPAIS',
    baseSlide: 2,
    title: 'Contas principais',
    description:
      'Visão mensal consolidada das principais despesas, manutenção e total geral.',
  },
  {
    code: 'EVOLUCAO_CONTAS_PRINCIPAIS',
    baseSlide: 3,
    title: 'Evolução das contas principais',
    description:
      'Selecione uma ou mais contas do slide anterior para comparar os valores mensais.',
    layout: 'CHART',
    managerialSourceSlide: 2,
  },
  {
    code: 'OFICINA',
    baseSlide: 4,
    title: 'Oficina, lubrificação e lavação',
    description: 'Custos mensais de oficina, lubrificação e lavação.',
    blocks: ['OFICINA'],
  },
  {
    code: 'SUPRIMENTOS',
    baseSlide: 5,
    title: 'Suprimentos',
    description:
      'Evolução mensal da mão de obra e despesas do setor de Suprimentos.',
    blocks: ['SUPRIMENTOS'],
    layout: 'TABLE_CHART',
  },
  {
    code: 'CAMINHOES',
    baseSlide: 6,
    title: 'Caminhões JR Construções',
    description: 'Custos, volumes, quantidades e médias dos caminhões.',
    blocks: ['CAMINHOES'],
  },
  {
    code: 'MAQUINAS',
    baseSlide: 7,
    title: 'Máquinas JR Construções',
    description: 'Custos, volumes, quantidades e médias das máquinas.',
    blocks: ['MAQUINAS'],
  },
  {
    code: 'VEICULOS',
    baseSlide: 8,
    title: 'Veículos JR Construções',
    description: 'Custos, volumes, quantidades e médias dos veículos.',
    blocks: ['VEICULOS'],
  },
  {
    code: 'BRITADOR',
    baseSlide: 9,
    title: 'Britador / Pedraforte',
    description: 'Custos e indicadores mensais da frota Pedraforte.',
    blocks: ['BRITADOR'],
    layout: 'TABLE_SELECTABLE_CHART',
  },
  {
    code: 'FECHAMENTO_OPERACIONAL',
    baseSlide: 11,
    title: 'Contas usina',
    description: 'Custos mensais das usinas de asfalto.',
    blocks: ['USINAS'],
  },
];

function presentationLabel(value: string) {
  return value.replace(/sem pedraforte/gi, 'JR Construções');
}

function presentationLineLabel(
  blockCode: string,
  lineNumber: number,
  value: string,
  kind: CostPurchasesPresentationKind,
) {
  let label =
    PRESENTATION_LINE_LABELS[blockCode]?.[lineNumber] ||
    presentationLabel(value);
  if (kind === 'AVERAGE' || kind === 'LITERS_PER_HOUR') {
    label = `Consumo médio — ${label}`;
  }
  return `${label} (${PRESENTATION_UNIT_BY_KIND[kind]})`;
}

function isPresentationTotalRow(row: CostPurchasesPresentationRow) {
  return (
    row.sourceCode === 'TOTAL' ||
    row.label.trim().toLocaleLowerCase('pt-BR').startsWith('total ')
  );
}

function includePresentationLine(blockCode: string, lineNumber: number) {
  return !(
    (blockCode === 'OFICINA' && lineNumber === 13) ||
    (blockCode === 'SUPRIMENTOS' && lineNumber === 27)
  );
}

function presentationRowChunks(
  definition: SlideDefinition,
  rows: CostPurchasesPresentationRow[],
) {
  if (definition.layout === 'CHART') return [rows];
  if (definition.code === 'BRITADOR' && rows.length > MAX_ROWS_PER_PAGE) {
    return [rows.slice(0, MAX_ROWS_PER_PAGE), rows.slice(MAX_ROWS_PER_PAGE)];
  }
  return chunks(
    rows,
    ROWS_PER_PAGE_BY_SLIDE[definition.code] || MAX_ROWS_PER_PAGE,
  );
}

function managerialRow(
  sourceCode: string,
  label: string,
  kind: CostPurchasesPresentationKind,
  contributesToTotal: boolean,
  source: string,
  formula: string | null = null,
): ManagerialRowDefinition {
  return {
    key: `MANAGERIAL:${sourceCode}`,
    label,
    section: null,
    kind,
    contributesToTotal,
    sourceCode,
    source,
    formula,
  };
}

function pendingManagerialRow(
  key: string,
  label: string,
  contributesToTotal = true,
  detail = 'Fonte e regra de cálculo ainda precisam de mapeamento oficial.',
): ManagerialRowDefinition {
  return {
    key: `PENDING:${key}`,
    label,
    section: null,
    kind: 'MONEY',
    contributesToTotal,
    sourceCode: null,
    source: 'PENDENTE DE MAPEAMENTO',
    formula: detail,
    pendingMapping: true,
  };
}

function saoPauloCompetence(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function validateCompetence(
  value: string | undefined,
  field: 'startCompetence' | 'endCompetence',
  currentCompetence: string,
) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
    throw new BadRequestException(`${field} deve usar o formato AAAA-MM`);
  }
  if (normalized < MIN_COMPETENCE) {
    throw new BadRequestException(
      `${field} deve ser igual ou posterior a 2025-01`,
    );
  }
  if (normalized > currentCompetence) {
    throw new BadRequestException(
      `${field} nao pode ser posterior ao mes atual`,
    );
  }
  return normalized;
}

function monthsBetween(
  startCompetence: string,
  endCompetence: string,
  currentCompetence: string,
): CostPurchasesPresentationMonth[] {
  const [startYear, startMonth] = startCompetence.split('-').map(Number);
  const [endYear, endMonth] = endCompetence.split('-').map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));
  const result: CostPurchasesPresentationMonth[] = [];
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const competence = `${year}-${String(month).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 15)));
    const shortLabel = new Intl.DateTimeFormat('pt-BR', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
      .format(new Date(Date.UTC(year, month - 1, 15)))
      .replace('.', '');
    result.push({
      competence,
      year,
      month,
      label,
      shortLabel,
      partial: competence === currentCompetence,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<TResult>,
) {
  const result = new Array<TResult>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        result[index] = await worker(values[index], index);
      }
    },
  );
  await Promise.all(runners);
  return result;
}

function isZero(value: string | null) {
  return value !== null && /^[+-]?0+(?:\.0+)?$/.test(value.trim());
}

function statusForValue(
  value: string | null,
  pendingMapping = false,
): CostPurchasesPresentationStatus {
  if (pendingMapping) return 'PENDENTE_MAPEAMENTO';
  if (value === null) return 'FONTE_INDISPONIVEL';
  return isZero(value) ? 'SEM_MOVIMENTO' : 'CALCULATED';
}

function managerialLineValue(
  report: any,
  code: string,
  month: number,
): string | null {
  const rawValue = report?.lines?.find((entry: any) => entry.code === code)
    ?.values?.[month];
  return rawValue === null || rawValue === undefined ? null : String(rawValue);
}

function statusForManagerialValue(
  report: any,
  code: string,
  month: number,
  value: string | null,
): CostPurchasesPresentationStatus {
  if (value !== null) return statusForValue(value);

  const ratioParts =
    code === 'DIESEL_PRECO_MEDIO'
      ? (['DIESEL', 'DIESEL_LITROS'] as const)
      : code === 'GASOLINA_PRECO_MEDIO'
        ? (['GASOLINA', 'GASOLINA_LITROS'] as const)
        : null;
  if (ratioParts) {
    const [amountCode, quantityCode] = ratioParts;
    const amount = managerialLineValue(report, amountCode, month);
    const quantity = managerialLineValue(report, quantityCode, month);
    const coverage = report?.months?.find(
      (entry: any) => Number(entry.month) === month,
    )?.coverage;
    const sourceCovered =
      code === 'DIESEL_PRECO_MEDIO'
        ? coverage?.managerialEntries === true
        : coverage?.gasolinePlan131 === true;
    if (sourceCovered && isZero(amount) && isZero(quantity)) {
      return 'SEM_MOVIMENTO';
    }
  }

  return 'FONTE_INDISPONIVEL';
}

function statusForCompetenceLine(line: any): CostPurchasesPresentationStatus {
  if (line.value !== null && line.value !== undefined) {
    return statusForValue(String(line.value));
  }
  if (
    String(line.status || '').toUpperCase() === 'CALCULATED' &&
    line.totalAssets === 0
  ) {
    return 'SEM_MOVIMENTO';
  }
  const source = String(line.source || '').toUpperCase();
  if (
    source.includes('PENDENTE DE FONTE') ||
    [124, 125, 126, 127].includes(Number(line.lineNumber))
  ) {
    return 'PENDENTE_MAPEAMENTO';
  }
  return 'FONTE_INDISPONIVEL';
}

function dependsOnVehicleFacts(blockCode: string, lineNumber: number | null) {
  if (
    ['CAMINHOES', 'MAQUINAS', 'VEICULOS', 'BRITADOR', 'ALUGADOS'].includes(
      blockCode,
    )
  ) {
    return true;
  }
  if (blockCode === 'OFICINA') {
    return lineNumber !== null && lineNumber >= 14 && lineNumber <= 22;
  }
  if (blockCode === 'MANUTENCAO') return lineNumber === 113;
  if (blockCode === 'USINAS') return true;
  return false;
}

type PresentationSourceIssue =
  CostPurchasesManagerialPresentationDto['metadata']['sourceIssues'][number];

function sourceIssueAffectsSlide(
  issue: PresentationSourceIssue,
  definition: SlideDefinition,
  months: CostPurchasesPresentationMonth[],
) {
  if (issue.scope === 'COMPETENCE_LIST') return true;
  if (issue.scope === 'COMPETENCE') {
    return months.some((month) => month.competence === issue.reference);
  }
  return (
    !definition.blocks &&
    months.some((month) => String(month.year) === issue.reference)
  );
}

function notesForTableSlide(
  definition: SlideDefinition,
  months: CostPurchasesPresentationMonth[],
  rows: CostPurchasesPresentationRow[],
  sourceIssues: PresentationSourceIssue[],
): CostPurchasesPresentationNote[] {
  const notes: CostPurchasesPresentationNote[] = [];
  const relevantIssues = sourceIssues.filter((issue) =>
    sourceIssueAffectsSlide(issue, definition, months),
  );
  const hasUnavailableCell = rows.some((row) =>
    row.cells.some((cell) => cell.status === 'FONTE_INDISPONIVEL'),
  );
  if (relevantIssues.length || hasUnavailableCell) {
    const issueLabel = relevantIssues.length
      ? ` (${relevantIssues
          .map((issue) => `${issue.scope} ${issue.reference}: ${issue.code}`)
          .join(' · ')})`
      : '';
    notes.push({
      code: 'SOURCE_UNAVAILABLE',
      text: `Há fontes ausentes neste recorte${issueLabel}. As células afetadas permanecem nulas; nenhum zero foi presumido.`,
    });
  }

  const hasDependentTotal = rows.some(
    (row) =>
      row.label.toLocaleUpperCase('pt-BR').includes('TOTAL') &&
      row.cells.some((cell) =>
        ['PENDENTE_MAPEAMENTO', 'FONTE_INDISPONIVEL'].includes(cell.status),
      ),
  );
  if (hasDependentTotal) {
    notes.push({
      code: 'DEPENDENT_TOTAL',
      text: 'Totais dependentes permanecem nulos enquanto houver componente sem fonte ou mapeamento; NULL não é convertido em zero.',
    });
  }

  if (rows.some((row) => row.sourceCode === 'ANTIADERENTE_REMOTIN')) {
    notes.push({
      code: 'ANTIADERENTE_MAPPING',
      text: 'Não há inferência de equivalência entre Remotin e REMOCIL: a linha Antiaderente soma somente itens oficialmente mapeados.',
    });
  }
  return notes;
}

function countStatuses(slides: CostPurchasesPresentationSlide[]) {
  const counts: Record<CostPurchasesPresentationStatus, number> = {
    CALCULATED: 0,
    SEM_MOVIMENTO: 0,
    PENDENTE_MAPEAMENTO: 0,
    FONTE_INDISPONIVEL: 0,
  };
  for (const cell of slides.flatMap((slide) =>
    slide.rows.flatMap((row) => row.cells),
  )) {
    counts[cell.status] += 1;
  }
  return counts;
}

function escapeHtml(value: string | number | boolean | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeInlineJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function displayValue(
  value: string | null,
  kind: CostPurchasesPresentationKind,
) {
  if (value === null) return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  if (kind === 'MONEY') {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(parsed);
  }
  if (kind === 'PRICE_PER_LITER') {
    return `${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(parsed)}/L`;
  }
  if (kind === 'LITERS') {
    return `${new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(parsed)} L`;
  }
  if (kind === 'USAGE') {
    return `${new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(parsed)} km`;
  }
  if (kind === 'AVERAGE') {
    return `${new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(parsed)} km/L`;
  }
  if (kind === 'LITERS_PER_HOUR') {
    return `${new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(parsed)} L/h`;
  }
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(parsed);
}

function safeSourceErrorCode(error: unknown) {
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const candidate =
    typeof rawCode === 'string' || typeof rawCode === 'number'
      ? String(rawCode)
      : '';
  return /^[A-Z][A-Z0-9_]{1,31}$/.test(candidate)
    ? candidate
    : 'SOURCE_READ_FAILED';
}

function normalizePresentationActor(actor?: CostPurchasesPresentationActor) {
  const id =
    String(actor?.id || '')
      .trim()
      .slice(0, 200) || 'system';
  const name =
    String(actor?.name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 120) || 'Usuário do sistema';
  return { id, name };
}

@Injectable()
export class CostPurchasesPresentationService {
  private readonly logger = new Logger(CostPurchasesPresentationService.name);
  private readonly presentationCache = new Map<
    string,
    { expiresAt: number; value: CostPurchasesManagerialPresentationDto }
  >();
  private readonly presentationBuilds = new Map<
    string,
    Promise<CostPurchasesManagerialPresentationDto>
  >();

  constructor(private readonly costPurchases: CostPurchasesService) {}

  async managerialPresentation(
    query: CostPurchasesPresentationQuery,
    actor?: CostPurchasesPresentationActor,
  ): Promise<CostPurchasesManagerialPresentationDto> {
    const responsible = normalizePresentationActor(actor);
    const generatedAt = new Date();
    const currentCompetence = saoPauloCompetence(generatedAt);
    const startCompetence = validateCompetence(
      query.startCompetence,
      'startCompetence',
      currentCompetence,
    );
    const endCompetence = validateCompetence(
      query.endCompetence,
      'endCompetence',
      currentCompetence,
    );
    if (startCompetence > endCompetence) {
      throw new BadRequestException(
        'startCompetence deve ser anterior ou igual a endCompetence',
      );
    }

    const cacheKey = `${currentCompetence}:${startCompetence}:${endCompetence}:${responsible.id}:${responsible.name}`;
    this.removeExpiredCacheEntries(generatedAt.getTime());
    const cached = this.presentationCache.get(cacheKey);
    if (cached && cached.expiresAt > generatedAt.getTime()) {
      this.presentationCache.delete(cacheKey);
      this.presentationCache.set(cacheKey, cached);
      return cached.value;
    }

    const activeBuild = this.presentationBuilds.get(cacheKey);
    if (activeBuild) return activeBuild;

    const buildPromise = (async () => {
      const months = monthsBetween(
        startCompetence,
        endCompetence,
        currentCompetence,
      );
      const sourceIssues: CostPurchasesManagerialPresentationDto['metadata']['sourceIssues'] =
        [];
      let availableCompetences: string[] = [];
      try {
        availableCompetences = await this.costPurchases.competences();
      } catch (error) {
        const code = safeSourceErrorCode(error);
        sourceIssues.push({
          scope: 'COMPETENCE_LIST',
          reference: `${startCompetence}:${endCompetence}`,
          code,
        });
        this.logger.warn({
          event: 'cost_purchases_presentation_source_read_failed',
          scope: 'COMPETENCE_LIST',
          reference: `${startCompetence}:${endCompetence}`,
          code,
        });
      }

      const years = [...new Set(months.map((month) => month.year))];
      const managerialReports: any[] = [];
      for (const year of years) {
        try {
          managerialReports.push(
            await this.costPurchases.managerialAccounts(
              { year: String(year) },
              {
                months: months
                  .filter((month) => month.year === year)
                  .map((month) => month.month),
                availableCompetences,
              },
            ),
          );
        } catch (error) {
          const code = safeSourceErrorCode(error);
          sourceIssues.push({
            scope: 'MANAGERIAL_YEAR',
            reference: String(year),
            code,
          });
          this.logger.warn({
            event: 'cost_purchases_presentation_source_read_failed',
            scope: 'MANAGERIAL_YEAR',
            reference: String(year),
            code,
          });
          managerialReports.push(null);
        }
      }
      const competenceReports = await mapWithConcurrency(
        months,
        SOURCE_READ_CONCURRENCY,
        async (month) => {
          try {
            return await this.costPurchases.competenceExpenses(
              { competence: month.competence },
              { availableCompetences },
            );
          } catch (error) {
            const code = safeSourceErrorCode(error);
            sourceIssues.push({
              scope: 'COMPETENCE',
              reference: month.competence,
              code,
            });
            this.logger.warn({
              event: 'cost_purchases_presentation_source_read_failed',
              scope: 'COMPETENCE',
              reference: month.competence,
              code,
            });
            return null;
          }
        },
      );
      const sourceIssueOrder = {
        COMPETENCE_LIST: 0,
        MANAGERIAL_YEAR: 1,
        COMPETENCE: 2,
      } as const;
      sourceIssues.sort(
        (left, right) =>
          sourceIssueOrder[left.scope] - sourceIssueOrder[right.scope] ||
          left.reference.localeCompare(right.reference) ||
          left.code.localeCompare(right.code),
      );
      const managerialByYear = new Map(
        years.map((year, index) => [year, managerialReports[index]]),
      );
      const competenceByMonth = new Map(
        months.map((month, index) => [
          month.competence,
          competenceReports[index] as any,
        ]),
      );

      const monthChunks = chunks(months, MAX_MONTHS_PER_PAGE);
      const slides: CostPurchasesPresentationSlide[] = [];
      const slideGroups: CostPurchasesPresentationSlideGroup[] = [];

      slides.push({
        id: 'slide-1-1',
        layout: 'COVER',
        baseSlide: 1,
        continuation: 1,
        totalContinuations: 1,
        title: 'Relatório Gerencial',
        description: 'Gestão das Frotas e Logística / Suprimentos',
        months: [],
        rows: [],
        notes: [],
        pagination: {
          horizontalPage: 1,
          horizontalPages: 1,
          verticalPage: 1,
          verticalPages: 1,
          rowStart: null,
          rowEnd: null,
          totalRows: 0,
        },
      });
      slideGroups.push({
        code: 'CAPA',
        baseSlide: 1,
        title: 'Relatório Gerencial',
        description: 'Gestão das Frotas e Logística / Suprimentos',
        generatedPageIds: ['slide-1-1'],
      });

      for (const definition of SLIDES) {
        const rowDefinitions = definition.blocks
          ? this.competenceRowDefinitions(
              definition.blocks,
              months,
              competenceByMonth,
            )
          : MANAGERIAL_ROWS[
              definition.managerialSourceSlide || definition.baseSlide
            ].filter(
              (row) => definition.layout !== 'CHART' || row.kind === 'MONEY',
            );
        const generatedPageIds: string[] = [];
        const pageDrafts = monthChunks.flatMap(
          (pageMonths, horizontalIndex) => {
            const pageRows = definition.blocks
              ? this.competenceRows(
                  rowDefinitions,
                  pageMonths,
                  competenceByMonth,
                )
              : this.managerialRows(
                  rowDefinitions as ManagerialRowDefinition[],
                  pageMonths,
                  managerialByYear,
                );
            const rowChunks = presentationRowChunks(definition, pageRows);
            const verticalPages = Math.max(rowChunks.length, 1);
            let rowOffset = 0;
            return (rowChunks.length ? rowChunks : [[]]).map(
              (pageRowsChunk, verticalIndex) => {
                const rowStart = pageRows.length === 0 ? null : rowOffset + 1;
                rowOffset += pageRowsChunk.length;
                return {
                  pageMonths,
                  pageRows: pageRowsChunk,
                  horizontalPage: horizontalIndex + 1,
                  horizontalPages: monthChunks.length,
                  verticalPage: verticalIndex + 1,
                  verticalPages,
                  rowStart,
                  rowEnd: pageRows.length === 0 ? null : rowOffset,
                  totalRows: pageRows.length,
                };
              },
            );
          },
        );
        pageDrafts.forEach((draft, pageIndex) => {
          const id = `slide-${definition.baseSlide}-${pageIndex + 1}`;
          generatedPageIds.push(id);
          slides.push({
            id,
            layout: definition.layout || 'TABLE',
            baseSlide: definition.baseSlide,
            continuation: pageIndex + 1,
            totalContinuations: pageDrafts.length,
            title: definition.title,
            description: definition.description,
            months: draft.pageMonths.map((month) => month.competence),
            rows: draft.pageRows,
            notes: notesForTableSlide(
              definition,
              draft.pageMonths,
              draft.pageRows,
              sourceIssues,
            ),
            pagination: {
              horizontalPage: draft.horizontalPage,
              horizontalPages: draft.horizontalPages,
              verticalPage: draft.verticalPage,
              verticalPages: draft.verticalPages,
              rowStart: draft.rowStart,
              rowEnd: draft.rowEnd,
              totalRows: draft.totalRows,
            },
          });
        });
        slideGroups.push({
          code: definition.code,
          baseSlide: definition.baseSlide,
          title: definition.title,
          description: definition.description,
          generatedPageIds,
        });
      }

      slides.push({
        id: 'slide-12-1',
        layout: 'CLOSING',
        baseSlide: 12,
        continuation: 1,
        totalContinuations: 1,
        title: 'Encerramento',
        description: 'Síntese concluída para o período selecionado.',
        months: [],
        rows: [],
        notes: [],
        pagination: {
          horizontalPage: 1,
          horizontalPages: 1,
          verticalPage: 1,
          verticalPages: 1,
          rowStart: null,
          rowEnd: null,
          totalRows: 0,
        },
      });
      slideGroups.push({
        code: 'ENCERRAMENTO',
        baseSlide: 12,
        title: 'Encerramento',
        description: 'Síntese concluída para o período selecionado.',
        generatedPageIds: ['slide-12-1'],
      });

      const counts = countStatuses(slides);
      const presentation: CostPurchasesManagerialPresentationDto = {
        contractVersion: COST_PURCHASES_PRESENTATION_CONTRACT_VERSION,
        generatedAt: generatedAt.toISOString(),
        responsible: {
          name: responsible.name,
        },
        period: {
          startCompetence,
          endCompetence,
          totalMonths: months.length,
          includesPartialMonth: months.some((month) => month.partial),
        },
        months,
        slideGroups,
        slides,
        summary: {
          baseSlides: SLIDES.length + 2,
          generatedPages: slides.length,
          calculatedCells: counts.CALCULATED,
          noMovementCells: counts.SEM_MOVIMENTO,
          pendingMappingCells: counts.PENDENTE_MAPEAMENTO,
          unavailableSourceCells: counts.FONTE_INDISPONIVEL,
        },
        metadata: {
          source: 'JR_POSTGRES_READ_MODELS',
          excelRuntimeDependency: false,
          nullPolicy: 'NULL_IS_NOT_ZERO',
          maxMonthsPerPage: MAX_MONTHS_PER_PAGE,
          maxRowsPerPage: MAX_ROWS_PER_PAGE,
          noDoubleCounting: true,
          cache: {
            scope: 'PROCESS_MEMORY_FINAL_DTO',
            ttlSeconds: PRESENTATION_CACHE_TTL_SECONDS,
            maxEntries: PRESENTATION_CACHE_MAX_ENTRIES,
            storesDegradedResults: false,
          },
          sourceIssues,
        },
      };
      if (sourceIssues.length === 0) {
        this.cachePresentation(cacheKey, presentation, generatedAt.getTime());
      }
      return presentation;
    })();
    this.presentationBuilds.set(cacheKey, buildPromise);
    try {
      return await buildPromise;
    } finally {
      if (this.presentationBuilds.get(cacheKey) === buildPromise) {
        this.presentationBuilds.delete(cacheKey);
      }
    }
  }

  async exportManagerialPresentation(
    query: CostPurchasesPresentationQuery,
    actor?: CostPurchasesPresentationActor,
  ) {
    const presentation = await this.managerialPresentation(query, actor);
    return {
      fileName: `custos-compras-apresentacao-${presentation.period.startCompetence}-a-${presentation.period.endCompetence}.html`,
      buffer: Buffer.from(this.renderHtml(presentation), 'utf8'),
    };
  }

  private removeExpiredCacheEntries(now: number) {
    for (const [key, entry] of this.presentationCache) {
      if (entry.expiresAt <= now) this.presentationCache.delete(key);
    }
  }

  private cachePresentation(
    key: string,
    value: CostPurchasesManagerialPresentationDto,
    now: number,
  ) {
    this.presentationCache.delete(key);
    while (this.presentationCache.size >= PRESENTATION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.presentationCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.presentationCache.delete(oldestKey);
    }
    this.presentationCache.set(key, {
      expiresAt: now + PRESENTATION_CACHE_TTL_MS,
      value,
    });
  }

  private managerialRows(
    definitions: ManagerialRowDefinition[],
    months: CostPurchasesPresentationMonth[],
    managerialByYear: Map<number, any>,
  ): CostPurchasesPresentationRow[] {
    return definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      section: definition.section,
      kind: definition.kind,
      contributesToTotal: definition.contributesToTotal,
      lineNumber: null,
      sourceCode: definition.sourceCode,
      cells: months.map((month) => {
        if (definition.pendingMapping || !definition.sourceCode) {
          return {
            competence: month.competence,
            value: null,
            status: 'PENDENTE_MAPEAMENTO',
            statusDetail:
              definition.formula ||
              'Fonte e regra de cálculo ainda precisam de mapeamento oficial.',
            source: definition.source,
            formula: definition.formula,
            benchmark: null,
            benchmarkDifference: null,
            detail: null,
          } satisfies CostPurchasesPresentationCell;
        }
        const report = managerialByYear.get(month.year);
        const value = managerialLineValue(
          report,
          definition.sourceCode,
          month.month,
        );
        const status = statusForManagerialValue(
          report,
          definition.sourceCode,
          month.month,
          value,
        );
        return {
          competence: month.competence,
          value,
          status,
          statusDetail:
            status === 'FONTE_INDISPONIVEL'
              ? 'Uma ou mais fontes oficiais não cobrem esta competência; nenhum zero foi presumido.'
              : status === 'SEM_MOVIMENTO'
                ? value === null
                  ? 'A fonte cobre a competência sem movimento; o preço médio permanece nulo para não dividir por zero.'
                  : 'A fonte cobre a competência e o resultado factual é zero.'
                : 'Calculado pelo serviço oficial de contas gerenciais do JR.',
          source: definition.source,
          formula: definition.formula,
          benchmark: null,
          benchmarkDifference: null,
          detail:
            report?.months?.[month.month - 1]?.details?.[
              definition.sourceCode
            ] || null,
        } satisfies CostPurchasesPresentationCell;
      }),
    }));
  }

  private competenceRowDefinitions(
    blockCodes: string[],
    months: CostPurchasesPresentationMonth[],
    reports: Map<string, any>,
  ) {
    const definitions = new Map<string, any>();
    for (const month of months) {
      const report = reports.get(month.competence);
      for (const blockCode of blockCodes) {
        const block = report?.blocks?.find(
          (entry: any) => entry.code === blockCode,
        );
        for (const line of block?.lines || []) {
          const lineNumber = Number(line.lineNumber);
          if (!includePresentationLine(blockCode, lineNumber)) continue;
          const key = `${blockCode}:${line.lineNumber}:${line.label}`;
          if (!definitions.has(key)) {
            definitions.set(key, {
              key,
              blockCode,
              section:
                blockCodes.length > 1 ? presentationLabel(block.title) : null,
              label: presentationLineLabel(
                blockCode,
                lineNumber,
                line.label,
                line.kind as CostPurchasesPresentationKind,
              ),
              sourceLabel: line.label,
              kind: line.kind as CostPurchasesPresentationKind,
              lineNumber,
              unavailablePlaceholder: false,
            });
          }
        }
      }
    }
    for (const blockCode of blockCodes) {
      const hasBlockDefinition = [...definitions.values()].some(
        (definition) => definition.blockCode === blockCode,
      );
      if (hasBlockDefinition) continue;
      const key = `${blockCode}:SOURCE_UNAVAILABLE`;
      definitions.set(key, {
        key,
        blockCode,
        section: blockCodes.length > 1 ? BLOCK_TITLES[blockCode] : null,
        label: 'Dados do bloco indisponíveis',
        kind: 'MONEY' satisfies CostPurchasesPresentationKind,
        lineNumber: null,
        unavailablePlaceholder: true,
      });
    }
    return [...definitions.values()].sort((left, right) => {
      if (left.blockCode !== right.blockCode) return 0;
      if (left.blockCode !== 'OFICINA') return 0;
      const oficinaOrder = (lineNumber: number | null) =>
        lineNumber === 22 ? 17.5 : lineNumber ?? Number.MAX_SAFE_INTEGER;
      return oficinaOrder(left.lineNumber) - oficinaOrder(right.lineNumber);
    });
  }

  private competenceRows(
    definitions: any[],
    months: CostPurchasesPresentationMonth[],
    reports: Map<string, any>,
  ): CostPurchasesPresentationRow[] {
    return definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      section: definition.section,
      kind: definition.kind,
      contributesToTotal: false,
      lineNumber: definition.lineNumber,
      sourceCode: definition.blockCode,
      cells: months.map((month) => {
        if (definition.unavailablePlaceholder) {
          return {
            competence: month.competence,
            value: null,
            status: 'FONTE_INDISPONIVEL',
            statusDetail:
              'O bloco oficial não pôde ser lido em nenhuma competência do período; a linha foi preservada sem presumir zero.',
            source: 'JR_POSTGRES_READ_MODELS',
            formula: null,
            benchmark: null,
            benchmarkDifference: null,
            detail: null,
          } satisfies CostPurchasesPresentationCell;
        }
        const report = reports.get(month.competence);
        const block = report?.blocks?.find(
          (entry: any) => entry.code === definition.blockCode,
        );
        const line = block?.lines?.find(
          (entry: any) =>
            Number(entry.lineNumber) === definition.lineNumber &&
            entry.label === (definition.sourceLabel || definition.label),
        );
        if (!line) {
          return {
            competence: month.competence,
            value: null,
            status: 'FONTE_INDISPONIVEL',
            statusDetail:
              'A linha oficial não foi devolvida para esta competência; nenhum zero foi presumido.',
            source: 'JR_POSTGRES_READ_MODELS',
            formula: null,
            benchmark: null,
            benchmarkDifference: null,
            detail: null,
          } satisfies CostPurchasesPresentationCell;
        }
        if (
          report?.sources?.vehicleFacts === false &&
          dependsOnVehicleFacts(definition.blockCode, definition.lineNumber)
        ) {
          return {
            competence: month.competence,
            value: null,
            status: 'FONTE_INDISPONIVEL',
            statusDetail:
              'A fonte mensal de veículos não cobre esta competência; nenhum zero foi presumido.',
            source: String(line.source || 'JR_POSTGRES_READ_MODELS'),
            formula:
              line.formula === null || line.formula === undefined
                ? null
                : String(line.formula),
            benchmark: null,
            benchmarkDifference: null,
            detail: line.detail || null,
          } satisfies CostPurchasesPresentationCell;
        }
        const value =
          line.value === null || line.value === undefined
            ? null
            : String(line.value);
        const status = statusForCompetenceLine(line);
        return {
          competence: month.competence,
          value,
          status,
          statusDetail:
            status === 'SEM_MOVIMENTO' && value === null
              ? 'A fonte cobre a competência, mas não há ativos no grupo; o valor permanece nulo sem presumir zero.'
              : String(line.statusDetail || ''),
          source: String(line.source || 'JR_POSTGRES_READ_MODELS'),
          formula:
            line.formula === null || line.formula === undefined
              ? null
              : String(line.formula),
          benchmark:
            line.benchmark === null || line.benchmark === undefined
              ? null
              : String(line.benchmark),
          benchmarkDifference:
            line.benchmarkDifference === null ||
            line.benchmarkDifference === undefined
              ? null
              : String(line.benchmarkDifference),
          detail: line.detail || null,
        } satisfies CostPurchasesPresentationCell;
      }),
    }));
  }

  private renderHtml(presentation: CostPurchasesManagerialPresentationDto) {
    const monthByCompetence = new Map(
      presentation.months.map((month) => [month.competence, month]),
    );
    const periodLabel = `${presentation.months[0]?.label || ''} a ${presentation.months.at(-1)?.label || ''}`;
    const detailPayloads: Record<
      string,
      {
        indicator: string;
        competence: string;
        monthLabel: string;
        detail: NonNullable<CostPurchasesPresentationCell['detail']>;
      }
    > = {};
    presentation.slides.forEach((slide) => {
      slide.rows.forEach((row, rowIndex) => {
        row.cells.forEach((cell, cellIndex) => {
          if (!cell.detail) return;
          const id = `detail-${slide.id}-${rowIndex}-${cellIndex}`;
          detailPayloads[id] = {
            indicator: row.label,
            competence: cell.competence,
            monthLabel:
              monthByCompetence.get(cell.competence)?.label || cell.competence,
            detail: cell.detail,
          };
        });
      });
    });
    const renderedSlides = presentation.slides
      .map((slide) => {
        if (slide.layout === 'COVER') {
          return `<section class="presentation-page cover" id="${escapeHtml(slide.id)}" data-page>
            <header><div>${this.inlineLogo()}<span>JR Construções</span></div><span>Custos Compras</span></header>
            <main>
              <p class="eyebrow">APRESENTAÇÃO GERENCIAL</p>
              <h1>${escapeHtml(slide.title)}</h1>
               <p class="description">${escapeHtml(slide.description)}</p>
               <p class="period">${escapeHtml(periodLabel)}${presentation.period.includesPartialMonth ? ' · inclui mês atual parcial' : ''}</p>
               <p class="responsible"><span>Responsável</span>${escapeHtml(presentation.responsible.name)}</p>
            </main>
            <footer><span>Gerado em ${escapeHtml(presentation.generatedAt)}</span><span data-counter></span></footer>
          </section>`;
        }
        if (slide.layout === 'CLOSING') {
          return `<section class="presentation-page closing" id="${escapeHtml(slide.id)}" data-page>
            <header><div>${this.inlineLogo()}<span>JR Construções</span></div><span>Custos Compras</span></header>
            <main>
              <p class="eyebrow">ENCERRAMENTO</p>
              <h1>${escapeHtml(slide.title)}</h1>
              <p class="description">${escapeHtml(slide.description)}</p>
              <p class="period">${escapeHtml(periodLabel)}</p>
            </main>
            <footer><span>Custos Compras · Apresentação Gerencial</span><span data-counter></span></footer>
          </section>`;
        }
        const slideMonths = slide.months.map((competence) =>
          monthByCompetence.get(competence),
        );
        const monthDensityClass =
          slideMonths.length > 8
            ? ' months-year'
            : slideMonths.length > 4
              ? ' months-compact'
              : '';
        const useShortMonthLabel = slideMonths.length > 4;
        const renderChartPanel = (
          chartRows: CostPurchasesPresentationRow[],
          embedded = false,
          compact = false,
        ) => {
          const series = chartRows.map((row, index) => ({
            key: row.key,
            label: row.label,
            color: [
              '#b91c1c',
              '#2563eb',
              '#059669',
              '#d97706',
              '#7c3aed',
              '#db2777',
              '#0891b2',
              '#475569',
            ][index % 8],
            total: isPresentationTotalRow(row),
            values: slide.months.map((competence) => {
              const raw = row.cells.find(
                (cell) => cell.competence === competence,
              )?.value;
              if (raw === null || raw === undefined) return null;
              const parsed = Number(raw);
              return Number.isFinite(parsed) ? parsed : null;
            }),
          }));
          const chartPayload = safeInlineJson({
            months: slideMonths.map(
              (month) =>
                (useShortMonthLabel ? month?.shortLabel : month?.label) || '',
            ),
            series,
          });
          const filters = embedded
            ? `<div class="chart-inline-title"><i style="background:${series[0]?.color || '#b91c1c'}"></i>Evolução mensal · ${escapeHtml(series[0]?.label || 'Mão de obra do setor de Suprimentos (R$)')}</div>`
            : `<div class="chart-filters"><b>Exibir:</b>${series
                .map(
                  (entry) =>
                    `<button type="button" class="chart-toggle${entry.total ? ' selected' : ''}" data-chart-toggle data-series-key="${escapeHtml(entry.key)}" aria-pressed="${entry.total ? 'true' : 'false'}"><i style="background:${entry.color}"></i>${escapeHtml(entry.label)}</button>`,
                )
                .join('')}</div>`;
          return `<div class="chart-panel${embedded || compact ? ' chart-panel-inline' : ''}${compact && !embedded ? ' chart-panel-after-table' : ''}" data-chart-container>
                ${filters}
                <div class="chart-wrap"><svg class="chart-svg" role="img" aria-label="${embedded ? 'Evolução mensal da mão de obra do setor de Suprimentos' : 'Evolução mensal das contas selecionadas'}"></svg></div>
                <script type="application/json" data-chart-payload>${chartPayload}</script>
              </div>`;
        };
        if (slide.layout === 'CHART') {
          return `<section class="presentation-page chart-page${monthDensityClass}" id="${escapeHtml(slide.id)}" data-page data-month-count="${slideMonths.length}">
            <header>
              <div>${this.inlineLogo()}<span>Custos Compras</span></div>
              <span>${slide.totalContinuations > 1 ? `Parte ${slide.continuation} de ${slide.totalContinuations}` : ''}</span>
            </header>
            <main>
              <p class="eyebrow">APRESENTAÇÃO GERENCIAL</p>
              <h1>${escapeHtml(slide.title)}</h1>
              <p class="description">${escapeHtml(slide.description)}</p>
              ${renderChartPanel(slide.rows)}
            </main>
            <footer><span>Período: ${escapeHtml(periodLabel)}</span><span data-counter></span></footer>
          </section>`;
        }
        const monthHeaders = slideMonths
          .map(
            (month) =>
              `<th>${escapeHtml((useShortMonthLabel ? month?.shortLabel : month?.label) || '')}${month?.partial ? '<small class="partial">Parcial</small>' : ''}</th>`,
          )
          .join('');
        const rows = slide.rows
          .map((row, rowIndex) => {
            const latestDetailIndex = [...row.cells]
              .map((cell, cellIndex) => ({ cell, cellIndex }))
              .reverse()
              .find(({ cell }) => cell.detail)?.cellIndex;
            const latestDetailId =
              latestDetailIndex === undefined
                ? null
                : `detail-${slide.id}-${rowIndex}-${latestDetailIndex}`;
            const cells = row.cells
              .map((cell, cellIndex) => {
                const detailId = cell.detail
                  ? `detail-${slide.id}-${rowIndex}-${cellIndex}`
                  : null;
                if (detailId && cell.detail) {
                  detailPayloads[detailId] = {
                    indicator: row.label,
                    competence: cell.competence,
                    monthLabel:
                      monthByCompetence.get(cell.competence)?.label ||
                      cell.competence,
                    detail: cell.detail,
                  };
                }
                return `<td>${detailId ? `<button type="button" class="detail-value-trigger" data-detail-id="${escapeHtml(detailId)}" aria-label="Ver composição de ${escapeHtml(row.label)} em ${escapeHtml(monthByCompetence.get(cell.competence)?.label || cell.competence)}">` : ''}<strong>${escapeHtml(displayValue(cell.value, row.kind))}</strong>${detailId ? '</button>' : ''}</td>`;
              })
              .join('');
            return `<tr${isPresentationTotalRow(row) ? ' class="total-row"' : ''}>
              <th scope="row">
                ${latestDetailId ? `<button type="button" class="detail-row-trigger" data-detail-id="${escapeHtml(latestDetailId)}"><span>${escapeHtml(row.label)}</span><small>Ver composição</small></button>` : `<span>${escapeHtml(row.label)}</span>`}
              </th>
              ${cells}
            </tr>`;
          })
          .join('');
        const embeddedChartRow =
          slide.layout === 'TABLE_CHART'
            ? slide.rows.find((row) => row.lineNumber === 26) ||
              slide.rows.find(
                (row) => row.kind === 'MONEY' && !isPresentationTotalRow(row),
              )
            : undefined;
        const selectableChartRows =
          slide.layout === 'TABLE_SELECTABLE_CHART' &&
          slide.pagination.verticalPage === 1
            ? slide.rows.filter((row) => row.kind === 'MONEY')
            : [];
        const hideFooterForChartPage =
          slide.layout === 'TABLE_SELECTABLE_CHART' &&
          slide.pagination.verticalPage === 1;
        return `<section class="presentation-page${slide.layout === 'TABLE_CHART' ? ' table-chart-page' : ''}${slide.layout === 'TABLE_SELECTABLE_CHART' ? ' table-selectable-chart-page' : ''}${monthDensityClass}" id="${escapeHtml(slide.id)}" data-page data-month-count="${slideMonths.length}">
          <header>
            <div>${this.inlineLogo()}<span>Custos Compras</span></div>
            <span>${slide.totalContinuations > 1 ? `Parte ${slide.continuation} de ${slide.totalContinuations}` : ''}</span>
          </header>
          <main>
            <p class="eyebrow">APRESENTAÇÃO GERENCIAL</p>
            <h1>${escapeHtml(slide.title)}</h1>
            <p class="description">${escapeHtml(slide.description)}</p>
            ${embeddedChartRow ? renderChartPanel([embeddedChartRow], true) : ''}
            <div class="table-wrap"><table>
              <thead><tr><th>Indicador</th>${monthHeaders}</tr></thead>
              <tbody>${rows}</tbody>
            </table></div>
            ${selectableChartRows.length ? renderChartPanel(selectableChartRows, false, true) : ''}
          </main>
          ${hideFooterForChartPage ? '' : `<footer><span>Período: ${escapeHtml(periodLabel)}</span><span data-counter></span></footer>`}
        </section>`;
      })
      .join('');
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Apresentação Gerencial · Custos Compras</title>
  <style>
    :root{font-family:Arial,Helvetica,sans-serif;color:#101828;background:#f3f4f6}
    *{box-sizing:border-box}html,body{width:100%;height:100%}body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#e9edf2}.toolbar{position:static;z-index:50;display:flex;flex:0 0 auto;align-items:center;justify-content:flex-end;gap:8px;min-height:60px;padding:10px 18px;border-bottom:1px solid #d0d5dd;background:#fff;box-shadow:0 4px 16px #10182818}.toolbar button{border:1px solid #d0d5dd;border-radius:9px;background:#fff;color:#8f171b;padding:9px 13px;font-weight:700;cursor:pointer}.toolbar button:hover{background:#fff2f2}.presentation-shell{flex:1 1 auto;min-width:0;min-height:0;overflow:auto}.presentation-page{display:none;width:100%;min-height:100%;background:#fff;overflow:auto}.presentation-page.active{display:flex;flex-direction:column}.presentation-page>header{height:64px;flex:none;background:#b91c1c;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 38px;font-size:13px;font-weight:700}.presentation-page>header div{display:flex;align-items:center;gap:12px}.logo{width:34px;height:34px}.presentation-page main{flex:1;padding:24px 42px 16px}.eyebrow{margin:0 0 7px;color:#b91c1c;font-size:11px;font-weight:800;letter-spacing:.18em}.presentation-page h1{margin:0;font-size:28px;color:#172033}.description{margin:7px 0 14px;color:#667085}.table-wrap{width:100%;overflow:auto;border:1px solid #d0d5dd;border-radius:16px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{background:#101828;color:#fff}th,td{padding:9px 11px;border-bottom:1px solid #e4e7ec;text-align:right;vertical-align:middle;font-size:12px}thead th:first-child,tbody th{text-align:left;width:30%}tbody th span{display:block;margin:2px 0;font-size:12px}tbody tr:nth-child(even){background:#f9fafb}tbody tr.total-row{background:#fff1f2!important;color:#7f1d1d;border-top:2px solid #fca5a5;border-bottom:2px solid #fca5a5;box-shadow:inset 4px 0 0 #b91c1c}tbody tr.total-row th,tbody tr.total-row td{font-weight:800}td strong{display:block;font-size:13px}.months-compact thead th:first-child,.months-compact tbody th{width:26%}.months-compact th,.months-compact td{padding-left:6px;padding-right:6px;font-size:10px}.months-compact td strong{font-size:10px}.months-year thead th:first-child,.months-year tbody th{width:22%}.months-year th,.months-year td{padding-left:3px;padding-right:3px;font-size:8px}.months-year tbody th span,.months-year td strong{font-size:9px;line-height:1.15}.chart-panel{display:flex;min-height:390px;flex:1;flex-direction:column;padding:12px;border:1px solid #e4e7ec;border-radius:16px;background:#fff;box-shadow:0 5px 20px #10182812}.chart-filters{display:flex;flex-wrap:wrap;align-items:center;gap:7px}.chart-filters>b{margin-right:4px;color:#667085;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.chart-toggle{display:inline-flex;align-items:center;gap:7px;min-height:30px;padding:5px 10px;border:1px solid #e4e7ec;border-radius:999px;background:#fff;color:#667085;font-size:10px;font-weight:800;cursor:pointer}.chart-toggle i{width:9px;height:9px;border-radius:50%}.chart-toggle.selected{border-color:#fecaca;background:#fff1f2;color:#7f1d1d;box-shadow:0 2px 8px #b91c1c16}.chart-wrap{min-height:300px;flex:1;margin-top:10px}.chart-svg{display:block;width:100%;height:100%;min-height:300px}.chart-panel-inline{min-height:250px;margin-bottom:12px;padding:10px}.chart-panel-inline .chart-wrap{min-height:205px;margin-top:4px}.chart-panel-inline .chart-svg{min-height:205px}.chart-inline-title{display:flex;align-items:center;gap:8px;color:#344054;font-size:11px;font-weight:800}.chart-inline-title i{width:10px;height:10px;border-radius:50%}.partial{display:block;margin-top:4px;color:#fdb022;font-size:8px;text-transform:uppercase}.presentation-page footer{height:38px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 38px;border-top:1px solid #e4e7ec;color:#667085;font-size:10px}.cover main,.closing main{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;background:linear-gradient(135deg,#fff 0%,#fff 64%,#fef2f2 64%,#fef2f2 100%)}.cover h1,.closing h1{max-width:900px;font-size:52px;line-height:1.02}.cover .period,.closing .period{margin-top:26px;padding:10px 14px;border-left:4px solid #b91c1c;background:#fff1f1;color:#7f1d1d;font-weight:700}.cover .responsible{display:flex;flex-direction:column;gap:3px;margin:14px 0 0;color:#344054;font-size:15px;font-weight:700}.cover .responsible span{color:#7f1d1d;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}@media(max-width:800px){.toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 10px}.toolbar button{width:100%;min-width:0;padding:8px 6px}.presentation-page main{padding:22px 18px 16px}.presentation-page>header,.presentation-page footer{padding-left:18px;padding-right:18px}.cover h1,.closing h1{font-size:38px}.table-wrap{overflow:auto}table{min-width:760px}.months-compact table{min-width:980px}.months-year table{min-width:1180px}}
    .chart-panel-after-table{margin-top:12px;margin-bottom:0}.detail-row-trigger,.detail-value-trigger{font:inherit;color:inherit}.detail-row-trigger{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;padding:2px 0;border:0;background:transparent;text-align:left;cursor:pointer}.detail-row-trigger small{flex:none;color:#b91c1c;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.detail-value-trigger{width:100%;padding:3px 5px;border:0;border-radius:7px;background:transparent;text-align:right;cursor:pointer}.detail-row-trigger:hover,.detail-value-trigger:hover{color:#991b1b;background:#fff1f2}.detail-modal[hidden]{display:none}.detail-modal{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:24px;background:#101828a8}.detail-dialog{display:flex;width:min(1120px,96vw);max-height:90vh;flex-direction:column;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 28px 90px #10182866}.detail-dialog>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px;background:linear-gradient(90deg,#991b1b,#b91c1c);color:#fff}.detail-dialog h2{margin:0;font-size:21px}.detail-dialog header p{margin:5px 0 0;color:#fee2e2;font-size:12px;font-weight:700}.detail-close{width:36px;height:36px;flex:none;border:1px solid #ffffff5e;border-radius:10px;background:#ffffff1f;color:#fff;font-size:22px;cursor:pointer}.detail-content{min-height:0;overflow:auto;padding:20px 24px}.detail-summary{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}.detail-summary h3{margin:0;color:#172033;font-size:16px}.detail-summary p{margin:5px 0 0;color:#667085;font-size:12px}.detail-count{flex:none;padding:6px 10px;border:1px solid #d0d5dd;border-radius:999px;background:#f9fafb;color:#344054;font-size:11px;font-weight:800}.detail-table-wrap{overflow:auto;border:1px solid #d0d5dd;border-radius:14px}.detail-table{min-width:760px;table-layout:auto}.detail-table th,.detail-table td{white-space:nowrap}.detail-empty{display:flex;min-height:180px;align-items:center;justify-content:center;border:1px dashed #d0d5dd;border-radius:14px;background:#f9fafb;color:#475467;font-weight:800;text-align:center}.detail-modal-open{overflow:hidden}
    @media print{@page{size:13.333in 7.5in;margin:0}.toolbar,.detail-modal{display:none!important}html,body{height:auto;overflow:visible}body{display:block;background:#fff}.presentation-shell{display:block;overflow:visible}.presentation-page,.presentation-page.active{display:flex!important;flex-direction:column;width:13.333in;height:auto;min-height:7.5in;overflow:visible;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}.presentation-page main{padding:15px 30px 10px}.presentation-page h1{font-size:23px}.description{margin:4px 0 8px}.table-wrap{overflow:visible}tr{break-inside:avoid;page-break-inside:avoid}th,td{padding:5px 7px;font-size:10px}tbody th span{font-size:11px}td strong{font-size:11px}.detail-row-trigger small{display:none}.months-compact th,.months-compact td{padding-left:4px;padding-right:4px;font-size:9px}.months-compact td strong{font-size:9px}.months-year th,.months-year td{padding-left:2px;padding-right:2px;font-size:7px}.months-year tbody th span,.months-year td strong{font-size:8px}.presentation-page:last-of-type{break-after:auto;page-break-after:auto}}
  </style>
</head>
<body>
  <nav class="toolbar" aria-label="Controles da apresentação">
    <button type="button" id="previous">Anterior</button>
    <button type="button" id="next">Próximo</button>
    <button type="button" id="fullscreen">Tela cheia</button>
    <button type="button" id="print">Imprimir</button>
  </nav>
  <div class="presentation-shell">
    ${renderedSlides}
  </div>
  <div class="detail-modal" data-detail-modal hidden>
    <section class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <header>
        <div><h2 id="detail-title">Composição do indicador</h2><p data-detail-month></p></div>
        <button type="button" class="detail-close" data-detail-close aria-label="Fechar">×</button>
      </header>
      <div class="detail-content" data-detail-content></div>
    </section>
  </div>
  <script type="application/json" id="presentation-detail-payload">${safeInlineJson(detailPayloads)}</script>
  <script>
    (() => {
      const pages = Array.from(document.querySelectorAll('[data-page]'));
      let current = 0;
      const show = (index) => {
        current = Math.max(0, Math.min(index, pages.length - 1));
        pages.forEach((page, pageIndex) => page.classList.toggle('active', pageIndex === current));
      };
      document.querySelectorAll('[data-counter]').forEach((counter, index) => { counter.textContent = (index + 1) + ' / ' + pages.length; });
      document.getElementById('previous').addEventListener('click', () => show(current - 1));
      document.getElementById('next').addEventListener('click', () => show(current + 1));
      document.getElementById('fullscreen').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      });
      document.getElementById('print').addEventListener('click', () => window.print());
      const svgNamespace = 'http://www.w3.org/2000/svg';
      const compactCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
      const preciseCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
      const svgElement = (name, attributes, text) => {
        const element = document.createElementNS(svgNamespace, name);
        Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) element.textContent = text;
        return element;
      };
      document.querySelectorAll('[data-chart-container]').forEach((container) => {
        const payload = JSON.parse(container.querySelector('[data-chart-payload]').textContent);
        const svg = container.querySelector('[data-chart-svg], .chart-svg');
        const selected = new Set(payload.series.filter((entry) => entry.total).map((entry) => entry.key));
        if (!selected.size && payload.series[0]) selected.add(payload.series[0].key);
        const renderChart = () => {
          svg.replaceChildren();
          svg.setAttribute('viewBox', '0 0 1000 360');
          const active = payload.series.filter((entry) => selected.has(entry.key));
          if (!active.length) {
            svg.appendChild(svgElement('text', { x: 500, y: 180, 'text-anchor': 'middle', fill: '#7f1d1d', 'font-size': 15, 'font-weight': 700 }, 'Selecione pelo menos uma conta para visualizar o gráfico.'));
            return;
          }
          const left = 92;
          const right = 28;
          const top = 22;
          const bottom = 54;
          const width = 1000 - left - right;
          const height = 360 - top - bottom;
          const numericValues = active.flatMap((entry) => entry.values.filter((value) => typeof value === 'number'));
          const maxValue = Math.max(1, ...numericValues) * 1.08;
          const xAt = (index) => left + (payload.months.length <= 1 ? width / 2 : (index * width) / (payload.months.length - 1));
          const yAt = (value) => top + height - (value / maxValue) * height;
          for (let index = 0; index <= 4; index += 1) {
            const value = (maxValue * index) / 4;
            const y = yAt(value);
            svg.appendChild(svgElement('line', { x1: left, y1: y, x2: left + width, y2: y, stroke: '#e2e8f0', 'stroke-dasharray': '4 4' }));
            svg.appendChild(svgElement('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10, 'font-weight': 700 }, compactCurrency.format(value)));
          }
          payload.months.forEach((month, index) => {
            svg.appendChild(svgElement('text', { x: xAt(index), y: top + height + 28, 'text-anchor': 'middle', fill: '#475569', 'font-size': 11, 'font-weight': 700 }, month));
          });
          active.forEach((entry) => {
            let pathData = '';
            let segmentOpen = false;
            entry.values.forEach((value, index) => {
              if (typeof value !== 'number') {
                segmentOpen = false;
                return;
              }
              pathData += (segmentOpen ? ' L ' : ' M ') + xAt(index) + ' ' + yAt(value);
              segmentOpen = true;
            });
            if (pathData) svg.appendChild(svgElement('path', { d: pathData, fill: 'none', stroke: entry.color, 'stroke-width': entry.total ? 4 : 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
            entry.values.forEach((value, index) => {
              if (typeof value !== 'number') return;
              const circle = svgElement('circle', { cx: xAt(index), cy: yAt(value), r: 4, fill: entry.color, stroke: '#fff', 'stroke-width': 2 });
              circle.appendChild(svgElement('title', {}, entry.label + ' · ' + payload.months[index] + ': ' + preciseCurrency.format(value)));
              svg.appendChild(circle);
            });
          });
        };
        container.querySelectorAll('[data-chart-toggle]').forEach((button) => {
          button.addEventListener('click', () => {
            const key = button.getAttribute('data-series-key');
            if (selected.has(key)) selected.delete(key); else selected.add(key);
            button.classList.toggle('selected', selected.has(key));
            button.setAttribute('aria-pressed', selected.has(key) ? 'true' : 'false');
            renderChart();
          });
        });
        renderChart();
      });
      const detailPayload = JSON.parse(document.getElementById('presentation-detail-payload').textContent || '{}');
      const detailModal = document.querySelector('[data-detail-modal]');
      const detailContent = document.querySelector('[data-detail-content]');
      const detailTitle = document.getElementById('detail-title');
      const detailMonth = document.querySelector('[data-detail-month]');
      const detailClose = document.querySelector('[data-detail-close]');
      let detailReturnFocus = null;
      const detailCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
      const detailDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
      const detailInteger = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
      const formatDetailValue = (value, kind) => {
        if (value === null || value === undefined || value === '') return '—';
        if (kind === 'DATE') {
          const parts = String(value).split('-');
          return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value);
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || kind === 'TEXT') return String(value);
        if (kind === 'MONEY') return detailCurrency.format(parsed);
        if (kind === 'INTEGER') return detailInteger.format(parsed);
        if (kind === 'LITERS') return detailDecimal.format(parsed) + ' L';
        if (kind === 'USAGE') return detailDecimal.format(parsed) + ' km';
        return detailDecimal.format(parsed);
      };
      const closeDetail = () => {
        detailModal.hidden = true;
        document.body.classList.remove('detail-modal-open');
        if (detailReturnFocus) detailReturnFocus.focus();
        detailReturnFocus = null;
      };
      const openDetail = (id, trigger) => {
        const payload = detailPayload[id];
        if (!payload) return;
        detailReturnFocus = trigger || null;
        detailTitle.textContent = payload.indicator;
        detailMonth.textContent = payload.monthLabel;
        detailContent.replaceChildren();

        const summary = document.createElement('div');
        summary.className = 'detail-summary';
        const summaryText = document.createElement('div');
        const heading = document.createElement('h3');
        heading.textContent = payload.detail.title;
        const description = document.createElement('p');
        description.textContent = payload.detail.description;
        summaryText.append(heading, description);
        const count = document.createElement('span');
        count.className = 'detail-count';
        count.textContent = payload.detail.rows.length + ' registro(s)';
        summary.append(summaryText, count);
        detailContent.appendChild(summary);

        if (!payload.detail.rows.length) {
          const empty = document.createElement('div');
          empty.className = 'detail-empty';
          empty.textContent = payload.detail.emptyMessage;
          detailContent.appendChild(empty);
        } else {
          const tableWrap = document.createElement('div');
          tableWrap.className = 'detail-table-wrap';
          const table = document.createElement('table');
          table.className = 'detail-table';
          const thead = document.createElement('thead');
          const headerRow = document.createElement('tr');
          payload.detail.columns.forEach((column) => {
            const th = document.createElement('th');
            th.textContent = column.label;
            headerRow.appendChild(th);
          });
          thead.appendChild(headerRow);
          const tbody = document.createElement('tbody');
          payload.detail.rows.forEach((row) => {
            const tr = document.createElement('tr');
            payload.detail.columns.forEach((column) => {
              const td = document.createElement('td');
              td.textContent = formatDetailValue(row.values[column.key], column.kind);
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.append(thead, tbody);
          tableWrap.appendChild(table);
          detailContent.appendChild(tableWrap);
        }
        detailModal.hidden = false;
        document.body.classList.add('detail-modal-open');
        detailClose.focus();
      };
      document.querySelectorAll('[data-detail-id]').forEach((button) => {
        button.addEventListener('click', () => openDetail(button.getAttribute('data-detail-id'), button));
      });
      detailClose.addEventListener('click', closeDetail);
      detailModal.addEventListener('click', (event) => {
        if (event.target === detailModal) closeDetail();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !detailModal.hidden) {
          closeDetail();
          return;
        }
        if (!detailModal.hidden) return;
        if (event.key === 'ArrowLeft') show(current - 1);
        if (event.key === 'ArrowRight' || event.key === ' ') show(current + 1);
      });
      show(0);
    })();
  </script>
</body>
</html>`;
  }

  private inlineLogo() {
    return '<svg class="logo" viewBox="0 0 48 48" role="img" aria-label="JR"><rect width="48" height="48" rx="9" fill="#fff"/><path d="M11 12h12v17c0 7-4 10-11 8l2-7c2 1 3 0 3-3V18h-6zm15 0h11c7 0 9 9 4 13l5 12h-8l-4-10h-2v10h-6zm6 6v4h4c2 0 2-4 0-4z" fill="#b91c1c"/></svg>';
  }
}
