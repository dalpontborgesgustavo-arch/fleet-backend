import { Prisma } from '@prisma/client';
import {
  CostPurchaseCalculatedRow,
  normalizeIdentifier,
} from './cost-purchases.rules';

const ZERO = new Prisma.Decimal(0);

export type CostPurchaseCompetenceLineKind =
  | 'MONEY'
  | 'LITERS'
  | 'QUANTITY'
  | 'USAGE'
  | 'AVERAGE'
  | 'LITERS_PER_HOUR';

export type CostPurchaseCompetenceLineStatus =
  | 'CALCULATED'
  | 'DIVERGENCE_EXPLAINED'
  | 'PENDING_SOURCE'
  | 'PENDING_DEPENDENCY';

export type CostPurchaseLaborLine = {
  lineNumber: 9 | 10 | 11 | 12 | 26;
  value: Prisma.Decimal | null;
  sourceRows: number;
};

export type CostPurchaseInternalFact = {
  id: string;
  sourceRecordId: string;
  planAccountId: number;
  categoryId: number;
  aethosItemId: number;
  amount: Prisma.Decimal;
};

export type CostPurchasePreventiveFact = {
  id: string;
  sourceRecordId: string;
  orderId: string;
  amount: Prisma.Decimal;
};

export type CostPurchaseBenchmark = {
  lineNumber: number;
  value: Prisma.Decimal;
  note: string | null;
};

export type CostPurchaseCompetenceLine = {
  lineNumber: number;
  label: string;
  kind: CostPurchaseCompetenceLineKind;
  value: Prisma.Decimal | null;
  status: CostPurchaseCompetenceLineStatus;
  statusDetail: string;
  formula: string;
  source: string;
  filters: string[];
  assetIds: number[];
  factKeys: string[];
  totalAssets: number | null;
  assetsWithReading: number | null;
  aggregateAverage: Prisma.Decimal | null;
  benchmark: Prisma.Decimal | null;
  benchmarkDifference: Prisma.Decimal | null;
  benchmarkNote: string | null;
};

export type CostPurchaseCompetenceBlock = {
  code: string;
  title: string;
  description: string;
  lines: CostPurchaseCompetenceLine[];
};

type Input = {
  rows: CostPurchaseCalculatedRow[];
  laborLines: CostPurchaseLaborLine[];
  internalFacts: CostPurchaseInternalFact[];
  preventiveFacts: CostPurchasePreventiveFact[];
  benchmarks: CostPurchaseBenchmark[];
  policy: {
    maintenanceVehicleFixed: Prisma.Decimal;
    comboioPlateFixed: Prisma.Decimal;
  };
  coverage: {
    internalConsumption: boolean;
    preventiveOrders: boolean;
  };
};

type LineInput = Omit<
  CostPurchaseCompetenceLine,
  'benchmark' | 'benchmarkDifference' | 'benchmarkNote'
>;

function sum(
  rows: CostPurchaseCalculatedRow[],
  field:
    | 'expenseTotal'
    | 'fuelTotal'
    | 'maintenance'
    | 'liters'
    | 'km'
    | 'allocatedAmount',
) {
  return rows.reduce((total, row) => total.plus(row[field]), ZERO);
}

function normalizedRowText(row: CostPurchaseCalculatedRow) {
  return normalizeIdentifier(
    [
      row.type,
      row.vehicleType,
      row.group,
      row.subgroup,
      row.model,
      row.fleet,
      row.plate,
    ].join(' '),
  );
}

function isPedraforte(row: CostPurchaseCalculatedRow) {
  return (
    normalizeIdentifier(row.filial) === 'PEDRAFORTE' ||
    normalizeIdentifier(row.company).includes('PEDRAFORTE')
  );
}

function matches(row: CostPurchaseCalculatedRow, terms: string[]) {
  const text = normalizedRowText(row);
  return terms.some((term) => text.includes(normalizeIdentifier(term)));
}

function assetIds(rows: CostPurchaseCalculatedRow[]) {
  return [...new Set(rows.map((row) => row.aethosVehicleId))].sort(
    (left, right) => left - right,
  );
}

function historicalAverage(rows: CostPurchaseCalculatedRow[]) {
  if (!rows.length) return null;
  return rows
    .reduce((total, row) => total.plus(row.averageKmPerLiter), ZERO)
    .div(rows.length);
}

function aggregateAverage(rows: CostPurchaseCalculatedRow[]) {
  const liters = sum(rows, 'liters');
  if (!liters.gt(0)) return null;
  return sum(rows, 'km').div(liters);
}

function hourlyAverageLine(
  lineNumber: number,
  label: string,
  rows: CostPurchaseCalculatedRow[],
  filter: string,
): LineInput {
  const vehiclesWithReading = rows.filter(
    (row) => row.hourMeterReadingCount > 0,
  );
  const hours = rows.reduce(
    (total, row) => total.plus(row.hourMeterHours),
    ZERO,
  );
  const liters = rows.reduce(
    (total, row) => total.plus(row.hourMeterLiters),
    ZERO,
  );
  return {
    lineNumber,
    label,
    kind: 'LITERS_PER_HOUR',
    value: vehiclesWithReading.length
      ? vehiclesWithReading
          .reduce((total, row) => total.plus(row.averageLitersPerHour), ZERO)
          .div(vehiclesWithReading.length)
      : null,
    status: 'CALCULATED',
    statusDetail:
      vehiclesWithReading.length > 0
        ? 'Média das médias individuais dos veículos identificados pelo Aethos como horímetro.'
        : 'Nenhuma leitura horimétrica válida no recorte.',
    formula:
      'AVG por veículo de AVG(litros / (horímetro final - horímetro inicial))',
    source: 'COST_PURCHASE_VEHICLE_FUEL + TRANS_VEICULO.FL_TRABALHAHORIMETRO',
    filters: [
      filter,
      'FL_TRABALHAHORIMETRO = true',
      'delta de horas > 0',
      'leitura coerente com VL_MEDIA e sem outlier robusto',
    ],
    assetIds: assetIds(rows),
    factKeys: [],
    totalAssets: rows.length,
    assetsWithReading: vehiclesWithReading.length,
    aggregateAverage: hours.gt(0) ? liters.div(hours) : null,
  };
}

function averageLine(
  lineNumber: number,
  label: string,
  rows: CostPurchaseCalculatedRow[],
  filter: string,
): LineInput {
  return {
    lineNumber,
    label,
    kind: 'AVERAGE',
    value: historicalAverage(rows),
    status: 'CALCULATED',
    statusDetail: 'Média histórica calculada pela classificação vigente do JR.',
    formula:
      'SUM(media individual do ativo) / quantidade total de ativos do grupo',
    source: 'COST_PURCHASE_VEHICLE_FUEL + classificação mensal do JR',
    filters: [filter],
    assetIds: assetIds(rows),
    factKeys: [],
    totalAssets: rows.length,
    assetsWithReading: rows.filter((row) => row.liters.gt(0) && row.km.gt(0))
      .length,
    aggregateAverage: aggregateAverage(rows),
  };
}

function calculatedLine(
  lineNumber: number,
  label: string,
  kind: CostPurchaseCompetenceLineKind,
  value: Prisma.Decimal,
  formula: string,
  source: string,
  rows: CostPurchaseCalculatedRow[] = [],
  filters: string[] = [],
  status: CostPurchaseCompetenceLineStatus = 'CALCULATED',
  statusDetail = 'Calculado pela fonte oficial.',
): LineInput {
  return {
    lineNumber,
    label,
    kind,
    value,
    status,
    statusDetail,
    formula,
    source,
    filters,
    assetIds: assetIds(rows),
    factKeys: [],
    totalAssets: kind === 'QUANTITY' ? rows.length : null,
    assetsWithReading: null,
    aggregateAverage: null,
  };
}

function laborLine(
  lineNumber: 9 | 10 | 11 | 12 | 26,
  label: string,
  input: Input,
  center: string,
): LineInput {
  const source = input.laborLines.find(
    (entry) => entry.lineNumber === lineNumber,
  );
  const available = source?.value !== null && source?.value !== undefined;
  return {
    lineNumber,
    label,
    kind: 'MONEY',
    value: source?.value ?? null,
    status: available ? 'CALCULATED' : 'PENDING_SOURCE',
    statusDetail: available
      ? `${source?.sourceRows || 0} registro(s) lido(s) diretamente da TOTVS.`
      : 'A consulta online da TOTVS está indisponível; nenhum valor foi presumido.',
    formula: 'SUM(VL_RATEADO) da competência e do centro de custo informado',
    source: 'TOTVS/RM IND.BI.0035 (somente leitura)',
    filters: [`Centro: ${center}`],
    assetIds: [],
    factKeys: [],
    totalAssets: null,
    assetsWithReading: null,
    aggregateAverage: null,
  };
}

function totalOrNull(
  lines: LineInput[],
  lineNumbers: number[],
): Prisma.Decimal | null {
  const components = lineNumbers.map((number) =>
    lines.find((line) => line.lineNumber === number),
  );
  if (components.some((line) => !line || line.value === null)) return null;
  return components.reduce(
    (total, line) => total.plus(line?.value || ZERO),
    ZERO,
  );
}

function withBenchmark(
  line: LineInput,
  benchmarkMap: Map<number, CostPurchaseBenchmark>,
): CostPurchaseCompetenceLine {
  const benchmark = benchmarkMap.get(line.lineNumber);
  return {
    ...line,
    benchmark: benchmark?.value ?? null,
    benchmarkDifference:
      line.value !== null && benchmark
        ? line.value.minus(benchmark.value)
        : null,
    benchmarkNote: benchmark?.note ?? null,
  };
}

export function calculateCostPurchaseCompetence(input: Input) {
  const benchmarkMap = new Map(
    input.benchmarks.map((benchmark) => [benchmark.lineNumber, benchmark]),
  );
  const regularRows = input.rows.filter((row) => !row.isRented);
  const maintenanceGeneralRows = regularRows.filter(
    (row) => !['USI2018', 'USI2025'].includes(normalizeIdentifier(row.plate)),
  );
  const rented = input.rows.filter((row) => row.isRented);
  const pedraforte = regularRows.filter(isPedraforte);
  const jr = regularRows.filter((row) => !isPedraforte(row));
  const jrTrucks = jr.filter((row) => row.rateGroup === 'CAMINHOES');
  const jrMachines = jr.filter((row) => row.rateGroup === 'MAQUINAS');
  const jrVehicles = jr.filter((row) => row.rateGroup === 'VEICULOS');
  const maintenanceSupport = regularRows.filter(
    (row) => row.maintenanceSupport,
  );
  const comboios = regularRows.filter((row) => matches(row, ['COMBOIO']));
  const pedraCars = pedraforte.filter((row) =>
    matches(row, ['CARRO', 'CAMIONETA', 'BANDEIRANTE']),
  );
  const pedraTrucks = pedraforte.filter((row) => row.rateGroup === 'CAMINHOES');
  const pedraMachines = pedraforte.filter(
    (row) => row.rateGroup === 'MAQUINAS',
  );

  const blocks: Array<
    Omit<CostPurchaseCompetenceBlock, 'lines'> & { lines: LineInput[] }
  > = [];

  const oficina: LineInput[] = [
    laborLine(
      9,
      'Custos M.O. - equipe de manutenção',
      input,
      'Equipe de manutenção',
    ),
    laborLine(
      10,
      'Custos M.O. - almoxarifado manutenção',
      input,
      'ALMOXARIFE JR',
    ),
    laborLine(
      11,
      'Custos M.O. - apoio (comboios)',
      input,
      'COMBOIOS MOTORISTA FROTA JR',
    ),
    laborLine(
      12,
      'Custos M.O. - apoio (rampa/lavação)',
      input,
      'TANQUE ABASTECIMENTO/COMBUSTÍVEIS BASE C',
    ),
  ];
  const oficinaFacts = input.internalFacts.filter(
    (fact) => fact.planAccountId === 1223 && fact.categoryId === 959,
  );
  const oficinaMaterial = calculatedLine(
    13,
    'Materiais de expediente e limpeza',
    'MONEY',
    oficinaFacts.reduce((total, fact) => total.plus(fact.amount), ZERO),
    'SUM(valor) do plano 1223 e categoria 959',
    'COST_PURCHASE_INTERNAL_CONSUMPTION',
    [],
    ['Plano 1223', 'Categoria 959', 'Exibido fora do pool de rateio'],
    'DIVERGENCE_EXPLAINED',
    'A fonte oficial atual é usada; a diferença histórica fica somente na memória.',
  );
  oficina.push({
    ...oficinaMaterial,
    value: input.coverage.internalConsumption ? oficinaMaterial.value : null,
    status: input.coverage.internalConsumption
      ? 'DIVERGENCE_EXPLAINED'
      : 'PENDING_SOURCE',
    statusDetail: input.coverage.internalConsumption
      ? oficinaMaterial.statusDetail
      : 'A carga de consumo interno ainda não cobre esta competência.',
    factKeys: oficinaFacts.map((fact) => fact.sourceRecordId),
  });
  oficina.push(
    calculatedLine(
      14,
      'Custos dos carros + seguros',
      'MONEY',
      sum(maintenanceSupport, 'expenseTotal'),
      'SUM(despesa total) dos veículos de apoio da manutenção',
      'Relatório mensal da frota',
      maintenanceSupport,
    ),
    calculatedLine(
      15,
      'Locações dos carros',
      'MONEY',
      input.policy.maintenanceVehicleFixed.mul(maintenanceSupport.length),
      'quantidade de carros da manutenção × valor mensal vigente',
      'Política de rateio versionada do JR',
      maintenanceSupport,
    ),
    calculatedLine(
      16,
      'Locação de comboios',
      'MONEY',
      input.policy.comboioPlateFixed.mul(
        new Set(comboios.map((row) => normalizeIdentifier(row.plate))).size,
      ),
      'quantidade de placas de comboio × valor mensal vigente',
      'Política de rateio versionada do JR',
      comboios,
    ),
    calculatedLine(
      17,
      'Despesas dos comboios',
      'MONEY',
      sum(comboios, 'expenseTotal'),
      'SUM(despesa total) dos ativos COMBOIO',
      'Relatório mensal da frota',
      comboios,
    ),
  );
  const trackedPlates = [
    [18, 'EVD-6481'],
    [19, 'NSL-1A84'],
    [20, 'SXO-3J06'],
    [21, 'TQB-9G51'],
  ] as const;
  for (const [lineNumber, plate] of trackedPlates) {
    const rows = regularRows.filter(
      (row) => normalizeIdentifier(row.plate) === normalizeIdentifier(plate),
    );
    oficina.push(
      calculatedLine(
        lineNumber,
        `Quilômetros rodados ${plate}`,
        'USAGE',
        sum(rows, 'km'),
        'MAX(leitura final) - MIN(leitura inicial)',
        'COST_PURCHASE_VEHICLE_FUEL',
        rows,
        [`Placa ${plate}`],
      ),
    );
  }
  const poolLineNumbers = [9, 10, 11, 12, 14, 15, 16, 17];
  const oficinaTotal = totalOrNull(oficina, poolLineNumbers);
  oficina.push({
    ...calculatedLine(
      22,
      'Total de despesas para rateio',
      'MONEY',
      oficinaTotal || ZERO,
      'linhas 9+10+11+12+14+15+16+17; linha 13 é apenas exibida',
      'Fontes oficiais + política de rateio',
    ),
    value: oficinaTotal,
    status: oficinaTotal === null ? 'PENDING_DEPENDENCY' : 'CALCULATED',
    statusDetail:
      oficinaTotal === null
        ? 'Aguardando uma ou mais linhas de mão de obra da TOTVS.'
        : 'Pool vigente reconciliável com a memória de rateio.',
  });
  blocks.push({
    code: 'OFICINA',
    title: 'Oficina, lubrificação e lavação',
    description: 'Mão de obra, apoio, materiais, veículos e base do rateio.',
    lines: oficina,
  });

  const suprimentosFacts = input.internalFacts.filter(
    (fact) =>
      fact.planAccountId === 1214 &&
      [926, 927, 833].includes(fact.categoryId) &&
      fact.aethosItemId !== 11904,
  );
  const suprimentosMaterial = calculatedLine(
    27,
    'Materiais de expediente e limpeza',
    'MONEY',
    suprimentosFacts.reduce((total, fact) => total.plus(fact.amount), ZERO),
    'SUM(valor), plano 1214, categorias 926/927/833, exceto item 11904',
    'COST_PURCHASE_INTERNAL_CONSUMPTION',
    [],
    ['Plano 1214', 'Categorias 926, 927 e 833', 'Item 11904 excluído'],
  );
  const suprimentos: LineInput[] = [
    laborLine(26, 'Custos M.O.', input, 'COMPRAS ADM CENTRAL'),
    {
      ...suprimentosMaterial,
      value: input.coverage.internalConsumption
        ? suprimentosMaterial.value
        : null,
      status: input.coverage.internalConsumption
        ? 'CALCULATED'
        : 'PENDING_SOURCE',
      statusDetail: input.coverage.internalConsumption
        ? suprimentosMaterial.statusDetail
        : 'A carga de consumo interno ainda não cobre esta competência.',
      factKeys: suprimentosFacts.map((fact) => fact.sourceRecordId),
    },
  ];
  const suprimentosTotal = totalOrNull(suprimentos, [26, 27]);
  suprimentos.push({
    ...calculatedLine(
      28,
      'Total de despesas',
      'MONEY',
      suprimentosTotal || ZERO,
      'linha 26 + linha 27',
      'Fontes oficiais',
    ),
    value: suprimentosTotal,
    status: suprimentosTotal === null ? 'PENDING_DEPENDENCY' : 'CALCULATED',
    statusDetail:
      suprimentosTotal === null ? 'Aguardando a linha 26.' : 'Total calculado.',
  });
  blocks.push({
    code: 'SUPRIMENTOS',
    title: 'Suprimentos',
    description: 'Mão de obra e consumo interno do setor de Suprimentos.',
    lines: suprimentos,
  });

  const fleetBlock = (
    code: string,
    title: string,
    rows: CostPurchaseCalculatedRow[],
    lineNumbers: [number, number, number, number, number, number],
    averages: Array<[number, string, string[]]>,
  ) => {
    const [
      fuelLine,
      maintenanceLine,
      allocationLine,
      totalLine,
      litersLine,
      countLine,
    ] = lineNumbers;
    const lines: LineInput[] = [
      calculatedLine(
        fuelLine,
        code === 'VEICULOS' ? 'Combustível' : 'Diesel - valor total',
        'MONEY',
        sum(rows, 'fuelTotal'),
        'SUM(combustível)',
        'Relatório mensal da frota',
        rows,
      ),
      calculatedLine(
        maintenanceLine,
        code === 'MAQUINAS' ? 'Manutenção' : 'Manutenção + seguros',
        'MONEY',
        sum(rows, 'maintenance'),
        'SUM(despesa total - combustível)',
        'Relatório mensal da frota',
        rows,
      ),
      calculatedLine(
        allocationLine,
        'Mão de obra das equipes',
        'MONEY',
        sum(rows, 'allocatedAmount'),
        'SUM(rateio individual)',
        'Motor de rateio do JR',
        rows,
      ),
      calculatedLine(
        totalLine,
        'Total de despesas',
        'MONEY',
        sum(rows, 'fuelTotal')
          .plus(sum(rows, 'maintenance'))
          .plus(sum(rows, 'allocatedAmount')),
        'combustível + manutenção + rateio',
        'Motor de custos do JR',
        rows,
      ),
      calculatedLine(
        litersLine,
        code === 'VEICULOS' ? 'Gasolina + diesel - litros' : 'Diesel - litros',
        'LITERS',
        sum(rows, 'liters'),
        'SUM(litros)',
        'Relatório mensal da frota',
        rows,
      ),
      calculatedLine(
        countLine,
        `Quantidade de ${title.toLocaleLowerCase('pt-BR')}`,
        'QUANTITY',
        new Prisma.Decimal(rows.length),
        'COUNT(ativos elegíveis)',
        'Classificação mensal do JR',
        rows,
      ),
    ];
    for (const [line, label, terms] of averages) {
      const selected = rows.filter((row) => matches(row, terms));
      lines.push(
        code === 'MAQUINAS'
          ? hourlyAverageLine(line, label, selected, terms.join(' / '))
          : averageLine(line, label, selected, terms.join(' / ')),
      );
    }
    blocks.push({
      code,
      title,
      description:
        'Valores calculados pela classificação vigente do JR, sem Pedraforte.',
      lines,
    });
  };

  fleetBlock(
    'CAMINHOES',
    'Caminhões sem Pedraforte',
    jrTrucks,
    [31, 32, 33, 34, 36, 37],
    [
      [40, 'Trucks caçambas', ['TRUCKS']],
      [41, 'Carretas caçambas', ['CARRETAS']],
      [42, 'Pranchas transportes', ['PRANCHAS']],
      [43, 'Caminhões comboios', ['COMBOIO']],
    ],
  );
  fleetBlock(
    'MAQUINAS',
    'Máquinas sem Pedraforte',
    jrMachines,
    [46, 47, 48, 49, 51, 52],
    [
      [56, 'Escavadeiras hidráulicas', ['ESCAVADEIRAS']],
      [57, 'Motoniveladoras', ['MOTONIVELADORAS']],
      [58, 'Rolos compactadores', ['ROLOS COMPACTADORES']],
      [59, 'Tratores esteiras', ['TRATORES ESTEIRAS']],
      [60, 'Carregadeiras', ['CARREGADEIRAS']],
    ],
  );
  fleetBlock(
    'VEICULOS',
    'Veículos sem Pedraforte',
    jrVehicles,
    [63, 64, 65, 66, 68, 69],
    [
      [72, 'Carros', ['CARROS']],
      [73, 'Caminhonetes', ['CAMINHONETES', 'CAMIONETAS']],
      [74, 'Ônibus', ['ONIBUS']],
    ],
  );

  const pedraDiesel = pedraforte.filter((row) => !pedraCars.includes(row));
  const pedraBandeirante = pedraforte.filter((row) =>
    matches(row, ['BANDEIRANTE']),
  );
  const pedraCarrosSemBandeirante = pedraCars.filter(
    (row) => !pedraBandeirante.includes(row),
  );
  const pedraPerfuratrizCompressor = pedraforte.filter((row) =>
    matches(row, ['PERFURATRIZ', 'COMPRESSOR']),
  );
  const britador: LineInput[] = [
    calculatedLine(
      77,
      'Combustíveis - diesel',
      'MONEY',
      sum(pedraDiesel, 'fuelTotal'),
      'combustível Pedraforte exceto carros',
      'Relatório mensal da frota',
      pedraDiesel,
    ),
    calculatedLine(
      78,
      'Combustíveis - gasolina',
      'MONEY',
      sum(pedraCars, 'fuelTotal'),
      'combustível dos carros Pedraforte',
      'Relatório mensal da frota',
      pedraCars,
    ),
    calculatedLine(
      79,
      'Manutenção - carros + Bandeirante',
      'MONEY',
      sum(pedraCars, 'maintenance'),
      'manutenção dos carros e Toyota Bandeirante',
      'Relatório mensal da frota',
      pedraCars,
    ),
    calculatedLine(
      80,
      'Manutenção - caminhões',
      'MONEY',
      sum(pedraTrucks, 'maintenance'),
      'manutenção dos caminhões Pedraforte',
      'Relatório mensal da frota',
      pedraTrucks,
    ),
    calculatedLine(
      81,
      'Manutenção - máquinas',
      'MONEY',
      sum(pedraMachines, 'maintenance'),
      'manutenção das máquinas Pedraforte',
      'Relatório mensal da frota',
      pedraMachines,
    ),
    calculatedLine(
      82,
      'Mão de obra das equipes',
      'MONEY',
      sum(pedraforte, 'allocatedAmount'),
      'SUM(rateio individual dos ativos Pedraforte)',
      'Motor de rateio do JR',
      pedraforte,
    ),
  ];
  britador.push(
    calculatedLine(
      83,
      'Total de despesas',
      'MONEY',
      britador.reduce((total, line) => total.plus(line.value || ZERO), ZERO),
      'linhas 77 a 82',
      'Fontes oficiais',
      pedraforte,
    ),
  );
  britador.push(
    calculatedLine(
      85,
      'Diesel - litros',
      'LITERS',
      sum(pedraDiesel, 'liters'),
      'litros Pedraforte exceto carros',
      'Relatório mensal da frota',
      pedraDiesel,
    ),
    calculatedLine(
      86,
      'Gasolina - litros',
      'LITERS',
      sum(pedraCars, 'liters'),
      'litros dos carros Pedraforte',
      'Relatório mensal da frota',
      pedraCars,
    ),
    calculatedLine(
      87,
      'Quantidade de caminhões',
      'QUANTITY',
      new Prisma.Decimal(pedraTrucks.length),
      'COUNT(caminhões Pedraforte)',
      'Classificação mensal do JR',
      pedraTrucks,
    ),
    calculatedLine(
      88,
      'Quantidade de máquinas',
      'QUANTITY',
      new Prisma.Decimal(pedraMachines.length),
      'COUNT(máquinas Pedraforte)',
      'Classificação mensal do JR',
      pedraMachines,
    ),
    calculatedLine(
      89,
      'Quantidade de carros + Toyota',
      'QUANTITY',
      new Prisma.Decimal(pedraCars.length),
      'COUNT(carros e Bandeirante)',
      'Classificação mensal do JR',
      pedraCars,
    ),
    calculatedLine(
      90,
      'Quantidade - perfuratriz + compressor',
      'QUANTITY',
      new Prisma.Decimal(pedraPerfuratrizCompressor.length),
      'COUNT(perfuratriz e compressor)',
      'Classificação mensal do JR',
      pedraPerfuratrizCompressor,
    ),
    averageLine(
      93,
      'Trucks caçambas',
      pedraTrucks.filter(
        (row) =>
          matches(row, ['TRUCKS']) && !matches(row, ['VMX360', 'VMX 360']),
      ),
      'TRUCKS, exceto VMX 360',
    ),
    hourlyAverageLine(
      94,
      'Trucks VMX 360',
      pedraTrucks.filter((row) => matches(row, ['VMX360', 'VMX 360'])),
      'VMX 360',
    ),
    hourlyAverageLine(
      95,
      'Escavadeiras hidráulicas',
      pedraMachines.filter((row) => matches(row, ['ESCAVADEIRAS'])),
      'ESCAVADEIRAS',
    ),
    hourlyAverageLine(
      96,
      'Carregadeira 962 britador',
      pedraforte.filter(
        (row) =>
          normalizeIdentifier(row.fleet) === '151' ||
          normalizeIdentifier(row.plate) === 'CAR2023',
      ),
      'Frota 151 / CAR-2023',
    ),
    hourlyAverageLine(
      97,
      'Carregadeira 656D sem britador',
      pedraforte.filter(
        (row) =>
          normalizeIdentifier(row.fleet) === '209' ||
          normalizeIdentifier(row.plate) === 'CAR6651',
      ),
      'Frota 209 / CAR-6651',
    ),
    averageLine(98, 'Toyota Bandeirante', pedraBandeirante, 'BANDEIRANTE'),
    averageLine(
      99,
      'Carros / veículos',
      pedraCarrosSemBandeirante,
      'CARROS, exceto Bandeirante',
    ),
  );
  blocks.push({
    code: 'BRITADOR',
    title: 'Britador / Pedraforte',
    description:
      'Agrupamento por identidade empresarial Pedraforte, nunca por texto da placa.',
    lines: britador,
  });

  const rentedTrucks = rented.filter(
    (row) =>
      row.rateGroup === 'CAMINHOES' ||
      matches(row, [
        'CAMINHAO',
        'TRUCK',
        'CARRETA',
        'PRANCHA',
        'COMBOIO',
        'VAN',
      ]),
  );
  const rentedMachines = rented.filter(
    (row) =>
      row.rateGroup === 'MAQUINAS' || matches(row, ['MAQUINA', 'EQUIPAMENTO']),
  );
  const rentedCars = rented.filter(
    (row) =>
      row.rateGroup === 'VEICULOS' || matches(row, ['CARRO', 'CAMIONETA']),
  );
  const rentedGasoline = rentedCars;
  const rentedDiesel = rented.filter((row) => !rentedGasoline.includes(row));
  blocks.push({
    code: 'ALUGADOS',
    title: 'Equipamentos alugados',
    description:
      'Ativos identificados como terceiros ou alugados na competência.',
    lines: [
      calculatedLine(
        102,
        'Combustíveis - valor total',
        'MONEY',
        sum(rented, 'fuelTotal'),
        'SUM(combustível) dos alugados',
        'Relatório mensal da frota',
        rented,
      ),
      calculatedLine(
        103,
        'Manutenção',
        'MONEY',
        sum(rented, 'maintenance'),
        'SUM(despesa total - combustível)',
        'Relatório mensal da frota',
        rented,
      ),
      calculatedLine(
        104,
        'Total de despesas',
        'MONEY',
        sum(rented, 'fuelTotal').plus(sum(rented, 'maintenance')),
        'linha 102 + linha 103',
        'Relatório mensal da frota',
        rented,
      ),
      calculatedLine(
        106,
        'Diesel - litros',
        'LITERS',
        sum(rentedDiesel, 'liters'),
        'litros de alugados, exceto carros',
        'Relatório mensal da frota',
        rentedDiesel,
      ),
      calculatedLine(
        107,
        'Gasolina - litros',
        'LITERS',
        sum(rentedGasoline, 'liters'),
        'litros dos carros alugados',
        'Relatório mensal da frota',
        rentedGasoline,
      ),
      calculatedLine(
        108,
        'Quantidade de caminhões / vans',
        'QUANTITY',
        new Prisma.Decimal(rentedTrucks.length),
        'COUNT(caminhões e vans alugados)',
        'Classificação mensal do JR',
        rentedTrucks,
      ),
      calculatedLine(
        109,
        'Quantidade de máquinas',
        'QUANTITY',
        new Prisma.Decimal(rentedMachines.length),
        'COUNT(máquinas alugadas)',
        'Classificação mensal do JR',
        rentedMachines,
      ),
      calculatedLine(
        110,
        'Quantidade de carros',
        'QUANTITY',
        new Prisma.Decimal(rentedCars.length),
        'COUNT(carros alugados)',
        'Classificação mensal do JR',
        rentedCars,
      ),
    ],
  });

  const preventiveLine = calculatedLine(
    114,
    'Custos com preventivas',
    'MONEY',
    input.preventiveFacts.reduce(
      (total, fact) => total.plus(fact.amount),
      ZERO,
    ),
    'SUM(valor da ordem preventiva única)',
    'COST_PURCHASE_PREVENTIVE_ORDERS',
    [],
    ['Uma ordem = um fato'],
    'DIVERGENCE_EXPLAINED',
    'A fonte oficial atual é usada; a diferença histórica fica somente na memória.',
  );
  blocks.push({
    code: 'MANUTENCAO',
    title: 'Manutenção geral e preventiva',
    description:
      'Custos antes do rateio e ordens preventivas sem multiplicação por vínculo.',
    lines: [
      calculatedLine(
        113,
        'Custo geral de manutenção',
        'MONEY',
        sum(maintenanceGeneralRows, 'maintenance'),
        'SUM(despesa total - combustível) da frota elegível antes do rateio',
        'Relatório mensal da frota',
        maintenanceGeneralRows,
      ),
      {
        ...preventiveLine,
        value: input.coverage.preventiveOrders ? preventiveLine.value : null,
        status: input.coverage.preventiveOrders
          ? 'DIVERGENCE_EXPLAINED'
          : 'PENDING_SOURCE',
        statusDetail: input.coverage.preventiveOrders
          ? preventiveLine.statusDetail
          : 'A carga de ordens preventivas ainda não cobre esta competência.',
        factKeys: input.preventiveFacts.map((fact) => fact.sourceRecordId),
      },
    ],
  });

  const usi2018 = regularRows.filter(
    (row) => normalizeIdentifier(row.plate) === 'USI2018',
  );
  const usi2025 = regularRows.filter(
    (row) => normalizeIdentifier(row.plate) === 'USI2025',
  );
  const usina: LineInput[] = [
    calculatedLine(
      117,
      'Usina Ciber Inova 1200 - diesel',
      'MONEY',
      sum(usi2018, 'fuelTotal'),
      'combustível da USI-2018',
      'Relatório mensal da frota',
      usi2018,
    ),
    calculatedLine(
      118,
      'Usina Ciber Inova 1200 - manutenção',
      'MONEY',
      sum(usi2018, 'maintenance'),
      'manutenção da USI-2018',
      'Relatório mensal da frota',
      usi2018,
    ),
    calculatedLine(
      119,
      'Usina Lintec CSD 2500 - diesel',
      'MONEY',
      sum(usi2025, 'fuelTotal'),
      'combustível da USI-2025',
      'Relatório mensal da frota',
      usi2025,
    ),
    calculatedLine(
      120,
      'Usina Lintec CSD 2500 - manutenção',
      'MONEY',
      sum(usi2025, 'maintenance'),
      'manutenção da USI-2025',
      'Relatório mensal da frota',
      usi2025,
      [],
      'DIVERGENCE_EXPLAINED',
      'O Excel apontava outro ativo; o JR usa a USI-2025 correta.',
    ),
  ];
  usina.push(
    calculatedLine(
      121,
      'Total de despesas',
      'MONEY',
      usina.reduce((total, line) => total.plus(line.value || ZERO), ZERO),
      'linhas 117 + 118 + 119 + 120',
      'Relatório mensal da frota',
      [...usi2018, ...usi2025],
      [],
      'DIVERGENCE_EXPLAINED',
      'A fórmula oficial inclui as quatro linhas; o Excel histórico omitia a linha 120.',
    ),
  );
  blocks.push({
    code: 'USINAS',
    title: 'Usinas de asfalto',
    description: 'Custos das usinas identificadas pelos ativos oficiais.',
    lines: usina,
  });

  const pending = (
    lineNumber: number,
    label: string,
    dependency = false,
  ): LineInput => ({
    lineNumber,
    label,
    kind: 'MONEY',
    value: null,
    status: dependency ? 'PENDING_DEPENDENCY' : 'PENDING_SOURCE',
    statusDetail: dependency
      ? 'Pendente das linhas 124, 125 e 126.'
      : 'Nenhuma fonte operacional confiável foi confirmada; zero não substitui ausência.',
    formula: dependency
      ? 'linha 124 + linha 125 + linha 126'
      : 'Fonte operacional ainda não definida',
    source: 'PENDENTE DE FONTE',
    filters: [],
    assetIds: [],
    factKeys: [],
    totalAssets: null,
    assetsWithReading: null,
    aggregateAverage: null,
  });
  blocks.push({
    code: 'PNEUS',
    title: 'Pneus',
    description:
      'Linhas mantidas visíveis sem fabricar valores ou usar o Excel em produção.',
    lines: [
      pending(124, 'Despesas em recapagens'),
      pending(125, 'Compra de pneus'),
      pending(126, 'Custo de borracharia'),
      pending(127, 'Total de despesas', true),
    ],
  });

  const serializedBlocks = blocks.map((block) => ({
    ...block,
    lines: block.lines.map((line) => withBenchmark(line, benchmarkMap)),
  }));
  return {
    blocks: serializedBlocks,
    summary: {
      blocks: serializedBlocks.length,
      lines: serializedBlocks.reduce(
        (total, block) => total + block.lines.length,
        0,
      ),
      calculated: serializedBlocks
        .flatMap((block) => block.lines)
        .filter(
          (line) =>
            line.value !== null &&
            !['PENDING_SOURCE', 'PENDING_DEPENDENCY'].includes(line.status),
        ).length,
      pending: serializedBlocks
        .flatMap((block) => block.lines)
        .filter((line) =>
          ['PENDING_SOURCE', 'PENDING_DEPENDENCY'].includes(line.status),
        ).length,
      assets: assetIds(input.rows).length,
    },
  };
}

export function serializeCostPurchaseCompetenceLine(
  line: CostPurchaseCompetenceLine,
) {
  const scale = line.kind === 'LITERS' ? 3 : line.kind === 'AVERAGE' ? 3 : 2;
  const serialize = (value: Prisma.Decimal | null) =>
    value === null ? null : value.toFixed(scale);
  return {
    ...line,
    value: serialize(line.value),
    aggregateAverage:
      line.aggregateAverage === null ? null : line.aggregateAverage.toFixed(3),
    benchmark: serialize(line.benchmark),
    benchmarkDifference: serialize(line.benchmarkDifference),
  };
}
