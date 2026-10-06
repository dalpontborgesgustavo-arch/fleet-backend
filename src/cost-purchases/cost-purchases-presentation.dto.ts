export const COST_PURCHASES_PRESENTATION_CONTRACT_VERSION =
  'cost-purchases-managerial-presentation.v1' as const;

export type CostPurchasesPresentationQuery = {
  startCompetence?: string;
  endCompetence?: string;
};

export type CostPurchasesPresentationActor = {
  id?: string | null;
  name?: string | null;
};

export type CostPurchasesPresentationStatus =
  | 'CALCULATED'
  | 'SEM_MOVIMENTO'
  | 'PENDENTE_MAPEAMENTO'
  | 'FONTE_INDISPONIVEL';

export type CostPurchasesPresentationKind =
  | 'MONEY'
  | 'LITERS'
  | 'PRICE_PER_LITER'
  | 'QUANTITY'
  | 'USAGE'
  | 'AVERAGE'
  | 'LITERS_PER_HOUR';

export type CostPurchasesPresentationMonth = {
  competence: string;
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  partial: boolean;
};

export type CostPurchasesPresentationCell = {
  competence: string;
  value: string | null;
  status: CostPurchasesPresentationStatus;
  statusDetail: string;
  source: string;
  formula: string | null;
  benchmark: string | null;
  benchmarkDifference: string | null;
  detail: CostPurchasesPresentationDetail | null;
};

export type CostPurchasesPresentationDetailColumn = {
  key: string;
  label: string;
  kind:
    | 'TEXT'
    | 'DATE'
    | 'MONEY'
    | 'DECIMAL'
    | 'INTEGER'
    | 'LITERS'
    | 'USAGE'
    | 'AVERAGE';
};

export type CostPurchasesPresentationDetailRow = {
  id: string;
  values: Record<string, string | null>;
};

export type CostPurchasesPresentationDetail = {
  title: string;
  description: string;
  columns: CostPurchasesPresentationDetailColumn[];
  rows: CostPurchasesPresentationDetailRow[];
  emptyMessage: string;
};

export type CostPurchasesPresentationRow = {
  key: string;
  label: string;
  section: string | null;
  kind: CostPurchasesPresentationKind;
  contributesToTotal: boolean;
  lineNumber: number | null;
  sourceCode: string | null;
  cells: CostPurchasesPresentationCell[];
};

export type CostPurchasesPresentationNote = {
  code: 'SOURCE_UNAVAILABLE' | 'DEPENDENT_TOTAL' | 'ANTIADERENTE_MAPPING';
  text: string;
};

export type CostPurchasesPresentationSlideGroup = {
  code: string;
  baseSlide: number;
  title: string;
  description: string;
  generatedPageIds: string[];
};

export type CostPurchasesPresentationSlide = {
  id: string;
  layout:
    | 'COVER'
    | 'TABLE'
    | 'TABLE_CHART'
    | 'TABLE_SELECTABLE_CHART'
    | 'CHART'
    | 'CLOSING';
  baseSlide: number;
  continuation: number;
  totalContinuations: number;
  title: string;
  description: string;
  months: string[];
  rows: CostPurchasesPresentationRow[];
  notes: CostPurchasesPresentationNote[];
  pagination: {
    horizontalPage: number;
    horizontalPages: number;
    verticalPage: number;
    verticalPages: number;
    rowStart: number | null;
    rowEnd: number | null;
    totalRows: number;
  };
};

export type CostPurchasesManagerialPresentationDto = {
  contractVersion: typeof COST_PURCHASES_PRESENTATION_CONTRACT_VERSION;
  generatedAt: string;
  responsible: {
    name: string;
  };
  period: {
    startCompetence: string;
    endCompetence: string;
    totalMonths: number;
    includesPartialMonth: boolean;
  };
  months: CostPurchasesPresentationMonth[];
  slideGroups: CostPurchasesPresentationSlideGroup[];
  slides: CostPurchasesPresentationSlide[];
  summary: {
    baseSlides: number;
    generatedPages: number;
    calculatedCells: number;
    noMovementCells: number;
    pendingMappingCells: number;
    unavailableSourceCells: number;
  };
  metadata: {
    source: 'JR_POSTGRES_READ_MODELS';
    excelRuntimeDependency: false;
    nullPolicy: 'NULL_IS_NOT_ZERO';
    maxMonthsPerPage: 12;
    maxRowsPerPage: 7;
    noDoubleCounting: true;
    cache: {
      scope: 'PROCESS_MEMORY_FINAL_DTO';
      ttlSeconds: 120;
      maxEntries: 8;
      storesDegradedResults: false;
    };
    sourceIssues: Array<{
      scope: 'MANAGERIAL_YEAR' | 'COMPETENCE' | 'COMPETENCE_LIST';
      reference: string;
      code: string;
    }>;
  };
};
