import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const READ_ROLES = new Set(['admin', 'gestor', 'ceo']);
const WRITE_ROLES = new Set(['admin', 'gestor', 'ceo']);
const SSMA_ROLES = new Set(['admin', 'ssma']);
const DEFAULT_YEAR = 2026;
const DEFAULT_BASE_REVENUE = 21_000_000;
const DEFAULT_RESPONSIBLE = 'Sem Responsável';
type ActualDateBasis = 'lancamento' | 'vencimento' | 'emissao_nf';
type ForecastFilter = 'without_forecast' | 'only_forecast' | 'all';
type FinancingFilter = 'include' | 'exclude';
type DepreciationFilter = 'include' | 'exclude';
type BudgetCompany = 'PRUMARE' | 'PEDRAFORTE' | 'JR_CONSTRUCOES';
type SsmaCompany = 'PEDRAFORTE' | 'JR_CONSTRUCOES';
type SsmaCategory = 'SAFETY' | 'GUARDING' | 'ENVIRONMENT';

// Explicit account allowlist prevents a similarly named financial plan from
// leaking into SSMA. Shared plans have a budget owner but company-scoped actuals.
const SSMA_ACCOUNTS: Record<
  SsmaCompany,
  ReadonlyArray<{
    code: string;
    label: string;
    category: SsmaCategory;
    budgeted: boolean;
  }>
> = {
  JR_CONSTRUCOES: [
    {
      code: '1221',
      label: 'Almoxarifado SMS',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1445',
      label: 'SMS - EPI e uniformes',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1492',
      label: 'SMS - materiais diversos',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '393',
      label: 'Exames e laudos de funcionários',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '622',
      label: 'Laudos técnicos de segurança do trabalho',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1456',
      label: 'Acidente de trabalho',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1545',
      label: 'Usina 2 - exames e laudos médicos',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1578',
      label: 'Usina - bombeiro',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1549',
      label: 'Projeto de bombeiros',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '181',
      label: 'Taxa de bombeiros',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1113',
      label: 'Usina - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '1624',
      label: 'Usina 2 - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '825',
      label: 'Areal Esplanada - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '826',
      label: 'Obras - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '851',
      label: 'Vigilância geral',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '1166',
      label: 'Obras - manifesto de transporte de resíduos',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '1206',
      label: 'Jazida RS - renovação de licenciamento',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '1303',
      label: 'Frota - licença ambiental',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '1387',
      label: 'Licença ambiental de tanque de combustível',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '1539',
      label: 'Usina 2 - licenciamento',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '1596',
      label: 'Usina 2 - coleta de resíduos',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '186',
      label: 'Anuidade IBAMA',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '221',
      label: 'Urussanga Velha - licenciamento e taxas ambientais',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '398',
      label: 'Renovação ambiental FATMA/DNPM',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '448',
      label: 'Usina - licenciamento',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '662',
      label: 'Pedreira Forquilhinha - taxas DNPM/FATMA',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '802',
      label: 'Areal Esplanada - licenciamento',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '866',
      label: 'Usina - coleta de resíduos',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '898',
      label: 'Requerimentos de áreas DNPM/FATMA',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '994',
      label: 'Frota - coleta de resíduos',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
  ],
  PEDRAFORTE: [
    {
      code: '1116',
      label: 'Exames e laudos de funcionários',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1467',
      label: 'Acidente de trabalho',
      category: 'SAFETY',
      budgeted: true,
    },
    {
      code: '1445',
      label: 'SMS - EPI e uniformes',
      category: 'SAFETY',
      budgeted: false,
    },
    {
      code: '1126',
      label: 'Pedraforte - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '639',
      label: 'Pedraforte - vigilância',
      category: 'GUARDING',
      budgeted: true,
    },
    {
      code: '851',
      label: 'Vigilância geral',
      category: 'GUARDING',
      budgeted: false,
    },
    {
      code: '822',
      label: 'Pedraforte - licenciamento',
      category: 'ENVIRONMENT',
      budgeted: true,
    },
    {
      code: '186',
      label: 'Anuidade IBAMA',
      category: 'ENVIRONMENT',
      budgeted: false,
    },
  ],
};
const SSMA_COMPANY_CODES: Record<SsmaCompany, string> = {
  JR_CONSTRUCOES: '1',
  PEDRAFORTE: '4',
};
const SSMA_ACTUALS_PAGE_SIZE = 50;

function ssmaActualScopeWhere(
  company: SsmaCompany,
): Prisma.AethosPlanoContaCostWhereInput {
  const accounts = SSMA_ACCOUNTS[company];
  const budgetCodes = accounts
    .filter((account) => account.budgeted)
    .map((account) => account.code);
  const sharedCodes = accounts
    .filter((account) => !account.budgeted)
    .map((account) => account.code);

  return company === 'PEDRAFORTE'
    ? {
        OR: [
          {
            codigoPlanoConta: { in: budgetCodes },
            // Contas próprias da Pedraforte também aparecem no razão da JR.
            codigoEmpresa: { in: ['1', '4'] },
          },
          {
            codigoPlanoConta: { in: sharedCodes },
            codigoEmpresa: '4',
          },
        ],
      }
    : {
        codigoEmpresa: SSMA_COMPANY_CODES[company],
        codigoPlanoConta: { in: accounts.map((account) => account.code) },
      };
}

const COMPANY_LABELS: Record<BudgetCompany, string> = {
  PRUMARE: 'Prumare',
  PEDRAFORTE: 'Pedraforte',
  JR_CONSTRUCOES: 'JR Construções',
};

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function ensureReadAccess(role?: string | null) {
  if (!READ_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para acessar Orcamento x Realizado',
    );
  }
}

function ensureWriteAccess(role?: string | null) {
  if (!WRITE_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para alterar Orcamento x Realizado',
    );
  }
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).trim();
  return '';
}

function normalizeComparable(value: unknown) {
  return coerceText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function classifyCompany(description: unknown): BudgetCompany {
  const normalized = normalizeComparable(description);
  if (normalized.includes('prumare')) return 'PRUMARE';
  if (normalized.includes('pedraforte')) return 'PEDRAFORTE';
  return 'JR_CONSTRUCOES';
}

function normalizeCompanyFilter(value: unknown): BudgetCompany | '' {
  const normalized = normalizeComparable(value).replace(/[\s-]+/g, '_');
  if (normalized === 'prumare') return 'PRUMARE';
  if (normalized === 'pedraforte') return 'PEDRAFORTE';
  if (['jr_construcoes', 'jr_construcao', 'jr'].includes(normalized)) {
    return 'JR_CONSTRUCOES';
  }
  return '';
}

function normalizeCompanyFilters(value: unknown): BudgetCompany[] {
  const entries = Array.isArray(value)
    ? value
    : coerceText(value)
        .split(',')
        .map((item) => item.trim());

  return Array.from(
    new Set(
      entries
        .map((item) => normalizeCompanyFilter(item))
        .filter((item): item is BudgetCompany => !!item),
    ),
  );
}

function normalizeResponsibleFilters(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : coerceText(value)
        .split(',')
        .map((item) => item.trim());
  const unique = new Map<string, string>();

  entries.forEach((item) => {
    const responsible = coerceText(item);
    if (!responsible) return;
    const key = normalizeComparable(responsible);
    if (!unique.has(key)) unique.set(key, responsible);
  });

  return Array.from(unique.values());
}

function parseNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = coerceText(value).replace(/[^\d,.-]/g, '');
  if (!text) return fallback;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const normalized =
    decimalIndex === -1
      ? text.replace(/\D/g, '')
      : `${text.slice(0, decimalIndex).replace(/\D/g, '')}.${text
          .slice(decimalIndex + 1)
          .replace(/\D/g, '')}`;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(coerceText(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeMonth(value: unknown) {
  const parsed = parseInteger(value, new Date().getMonth() + 1);
  if (parsed < 1 || parsed > 12) {
    throw new BadRequestException('Mes invalido');
  }
  return parsed;
}

function normalizeYear(value: unknown) {
  const parsed = parseInteger(value, DEFAULT_YEAR);
  if (parsed < 2000 || parsed > 2100) {
    throw new BadRequestException('Ano invalido');
  }
  return parsed;
}

function roundMoney(value: number) {
  return Math.round((value || 0) * 100) / 100;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value?.toString?.() ?? value) || 0;
}

function normalizeCompetencia(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeActualDateBasis(value: unknown): ActualDateBasis {
  const text = coerceText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (text === 'vencimento') return 'vencimento';
  if (['emissao_nf', 'emissao-nf', 'emissaonf'].includes(text)) {
    return 'emissao_nf';
  }
  return 'lancamento';
}

function normalizeForecastFilter(value: unknown): ForecastFilter {
  const text = coerceText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    [
      'only_forecast',
      'with_forecast',
      'com_previsao',
      'somente_previsao',
    ].includes(text)
  ) {
    return 'only_forecast';
  }
  if (
    [
      'all',
      'todos',
      'com_e_sem_previsao',
      'with_and_without_forecast',
    ].includes(text)
  ) {
    return 'all';
  }
  return 'without_forecast';
}

function normalizeFinancingFilter(value: unknown): FinancingFilter {
  const text = normalizeComparable(value).replace(/[\s-]+/g, '_');
  if (
    [
      'exclude',
      'excluded',
      'without_financing',
      'sem_financiamento',
      'sem_financiamentos',
    ].includes(text)
  ) {
    return 'exclude';
  }
  return 'include';
}

function isFinancingDescription(value: unknown) {
  return normalizeComparable(value).includes('financ');
}

function normalizeDepreciationFilter(value: unknown): DepreciationFilter {
  return normalizeComparable(value).replace(/[\s-]+/g, '_') === 'exclude'
    ? 'exclude'
    : 'include';
}

function isDepreciationDescription(value: unknown) {
  return normalizeComparable(value).includes('depreci');
}

function withoutDepreciationDescription(field: 'nomePlanoConta' | 'descricao') {
  return {
    OR: [
      { [field]: null },
      {
        NOT: { [field]: { contains: 'depreci', mode: 'insensitive' as const } },
      },
    ],
  };
}

function applyDepreciationFilter(
  where: Prisma.AethosPlanoContaCostWhereInput,
  depreciationFilter: DepreciationFilter,
): Prisma.AethosPlanoContaCostWhereInput {
  if (depreciationFilter === 'include') return where;
  const existingAnd = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];
  return {
    ...where,
    AND: [...existingAnd, withoutDepreciationDescription('nomePlanoConta')],
  };
}

function applyLegacyDepreciationFilter(
  where: Prisma.AethosSubgroupActualWhereInput,
  depreciationFilter: DepreciationFilter,
): Prisma.AethosSubgroupActualWhereInput {
  if (depreciationFilter === 'include') return where;
  return {
    ...where,
    AND: [withoutDepreciationDescription('descricao')],
  };
}

function applyFinancingFilter(
  where: Prisma.AethosPlanoContaCostWhereInput,
  financingFilter: FinancingFilter,
): Prisma.AethosPlanoContaCostWhereInput {
  if (financingFilter === 'include') return where;

  const existingAnd = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];

  return {
    ...where,
    AND: [
      ...existingAnd,
      {
        NOT: {
          OR: [
            { tipoDocumento: { equals: 'FIN', mode: 'insensitive' } },
            {
              tipoDocumentoDescricao: {
                contains: 'financ',
                mode: 'insensitive',
              },
            },
            {
              nomePlanoConta: {
                contains: 'financ',
                mode: 'insensitive',
              },
            },
          ],
        },
      },
    ],
  };
}

function monthUtcRange(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
  };
}

function planAccountWhereByDateBasis(
  year: number,
  month: number,
  competencia: string,
  dateBasis: ActualDateBasis,
  forecastFilter: ForecastFilter,
): Prisma.AethosPlanoContaCostWhereInput {
  let dateWhere: Prisma.AethosPlanoContaCostWhereInput;

  if (dateBasis === 'vencimento') {
    const range = monthUtcRange(year, month);
    dateWhere = {
      active: true,
      dataVencimento: {
        gte: range.start,
        lt: range.end,
      },
    };
  } else if (dateBasis === 'emissao_nf') {
    const range = monthUtcRange(year, month);
    dateWhere = {
      active: true,
      OR: [
        {
          temNotaFiscal: true,
          dataEmissaoNotaFiscal: {
            gte: range.start,
            lt: range.end,
          },
        },
        {
          temNotaFiscal: false,
          dataLancamento: {
            gte: range.start,
            lt: range.end,
          },
        },
      ],
    };
  } else {
    dateWhere = {
      active: true,
      competencia,
    };
  }

  if (forecastFilter === 'all') return dateWhere;
  if (forecastFilter === 'only_forecast') {
    return {
      ...dateWhere,
      status: 'APR',
    };
  }

  return {
    ...dateWhere,
    AND: [
      {
        OR: [{ status: null }, { status: { not: 'APR' } }],
      },
    ],
  };
}

@Injectable()
export class BudgetAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  async getSsmaOverview(
    query: Record<string, unknown>,
    actorRole?: string | null,
  ) {
    if (!SSMA_ROLES.has(normalizeRole(actorRole))) {
      throw new ForbiddenException(
        'Sem permissao para o orcamento de seguranca',
      );
    }

    const company = coerceText(query.company || 'JR_CONSTRUCOES').toUpperCase();
    if (company !== 'JR_CONSTRUCOES' && company !== 'PEDRAFORTE') {
      throw new BadRequestException('Empresa invalida');
    }
    const selectedCompany = company as SsmaCompany;
    const year = normalizeYear(query.year);
    const month = normalizeMonth(query.month);
    const competencia = normalizeCompetencia(year, month);
    const accounts = SSMA_ACCOUNTS[selectedCompany];
    const budgetCodes = accounts
      .filter((account) => account.budgeted)
      .map((account) => account.code);
    const actualScopeWhere = ssmaActualScopeWhere(selectedCompany);
    const version = await this.findVersion(year);
    const [lines, actuals, lastSync] = await Promise.all([
      this.prisma.budgetLine.findMany({
        where: {
          versionId: version.id,
          active: true,
          idSubgrupo: { in: budgetCodes },
        },
        select: {
          idSubgrupo: true,
          monthlyCost: true,
          monthlyBudgets: {
            where: { year, month },
            select: { amount: true },
            take: 1,
          },
        },
      }),
      this.prisma.aethosPlanoContaCost.groupBy({
        by: ['codigoPlanoConta'],
        where: {
          AND: [
            planAccountWhereByDateBasis(
              year,
              month,
              competencia,
              'lancamento',
              'without_forecast',
            ),
            actualScopeWhere,
          ],
        },
        _sum: { valorCusto: true },
      }),
      this.prisma.aethosPlanoContaCost.findFirst({
        where: {
          active: true,
          AND: [actualScopeWhere],
        },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
    ]);

    const budgetByCode = new Map(
      lines.map((line) => [
        line.idSubgrupo,
        decimalToNumber(line.monthlyBudgets[0]?.amount ?? line.monthlyCost),
      ]),
    );
    const actualByCode = new Map(
      actuals.map((actual) => [
        actual.codigoPlanoConta,
        decimalToNumber(actual._sum.valorCusto),
      ]),
    );
    const rows = accounts
      .filter(
        (account) =>
          budgetByCode.has(account.code) || actualByCode.has(account.code),
      )
      .map((account) => {
        const budget = roundMoney(budgetByCode.get(account.code) || 0);
        const realized = roundMoney(actualByCode.get(account.code) || 0);
        return {
          code: account.code,
          description: account.label,
          category: account.category,
          hasBudget: budgetByCode.has(account.code),
          budget,
          realized,
          variance: roundMoney(budget - realized),
          percentUsed:
            budget > 0
              ? Math.round((realized / budget) * 1000) / 10
              : realized > 0
                ? 100
                : 0,
        };
      });
    const budget = roundMoney(rows.reduce((sum, row) => sum + row.budget, 0));
    const realized = roundMoney(
      rows.reduce((sum, row) => sum + row.realized, 0),
    );

    return {
      year,
      month,
      company: selectedCompany,
      companyLabel: COMPANY_LABELS[selectedCompany],
      dateBasis: 'lancamento' as const,
      forecastFilter: 'without_forecast' as const,
      lastSync: lastSync?.syncedAt.toISOString() || null,
      summary: {
        budget,
        realized,
        variance: roundMoney(budget - realized),
        percentUsed:
          budget > 0
            ? Math.round((realized / budget) * 1000) / 10
            : realized > 0
              ? 100
              : 0,
      },
      rows,
    };
  }

  async getSsmaActuals(
    query: Record<string, unknown>,
    actorRole?: string | null,
  ) {
    if (!SSMA_ROLES.has(normalizeRole(actorRole))) {
      throw new ForbiddenException(
        'Sem permissao para os lancamentos de seguranca',
      );
    }

    const company = coerceText(query.company || 'JR_CONSTRUCOES').toUpperCase();
    if (company !== 'JR_CONSTRUCOES' && company !== 'PEDRAFORTE') {
      throw new BadRequestException('Empresa invalida');
    }
    const selectedCompany = company as SsmaCompany;
    const code = coerceText(query.code);
    const account = SSMA_ACCOUNTS[selectedCompany].find(
      (candidate) => candidate.code === code,
    );
    if (!account) {
      throw new BadRequestException('Plano de conta fora do escopo SSMA');
    }

    const year = normalizeYear(query.year);
    const month = normalizeMonth(query.month);
    const competencia = normalizeCompetencia(year, month);
    const page = Number(query.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
      throw new BadRequestException('Pagina invalida');
    }

    const where: Prisma.AethosPlanoContaCostWhereInput = {
      AND: [
        planAccountWhereByDateBasis(
          year,
          month,
          competencia,
          'lancamento',
          'without_forecast',
        ),
        ssmaActualScopeWhere(selectedCompany),
        { codigoPlanoConta: code },
      ],
    };
    const [totals, rows] = await Promise.all([
      this.prisma.aethosPlanoContaCost.aggregate({
        where,
        _count: { _all: true },
        _sum: { valorCusto: true },
      }),
      this.prisma.aethosPlanoContaCost.findMany({
        where,
        orderBy: [{ dataBaseLancamento: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * SSMA_ACTUALS_PAGE_SIZE,
        take: SSMA_ACTUALS_PAGE_SIZE,
        select: {
          id: true,
          idLancamento: true,
          nomeEmpresa: true,
          dataBaseLancamento: true,
          dataLancamento: true,
          numeroNotaFiscal: true,
          dataEmissaoNotaFiscal: true,
          observacaoLancamento: true,
          observacaoNotaFiscal: true,
          valorCusto: true,
          raw: true,
        },
      }),
    ]);

    return {
      company: selectedCompany,
      companyLabel: COMPANY_LABELS[selectedCompany],
      year,
      month,
      code,
      description: account.label,
      category: account.category,
      dateBasis: 'lancamento' as const,
      forecastFilter: 'without_forecast' as const,
      page,
      pageSize: SSMA_ACTUALS_PAGE_SIZE,
      count: totals._count._all,
      total: roundMoney(decimalToNumber(totals._sum.valorCusto)),
      rows: rows.map((row) => {
        const raw =
          row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
            ? (row.raw as Record<string, unknown>)
            : {};
        return {
          id: row.id,
          idLancamento: row.idLancamento,
          nomeEmpresa: row.nomeEmpresa,
          dataReferencia: row.dataBaseLancamento?.toISOString() || null,
          dataLancamento: row.dataLancamento?.toISOString() || null,
          numeroNotaFiscal: row.numeroNotaFiscal,
          dataEmissaoNotaFiscal:
            row.dataEmissaoNotaFiscal?.toISOString() || null,
          observacaoLancamento: row.observacaoLancamento,
          observacaoNotaFiscal: row.observacaoNotaFiscal,
          obra: coerceText(raw.nomeObra) || coerceText(raw.codigoObra) || null,
          centroCusto:
            coerceText(raw.nomeCentroCusto) ||
            coerceText(raw.codigoCentroCusto) ||
            null,
          valor: roundMoney(decimalToNumber(row.valorCusto)),
        };
      }),
    };
  }

  async getOverview(query: Record<string, unknown>, actorRole?: string | null) {
    ensureReadAccess(actorRole);

    const year = normalizeYear(query.year);
    const month = normalizeMonth(query.month);
    const competencia = normalizeCompetencia(year, month);
    const dateBasis = normalizeActualDateBasis(query.dateBasis);
    const forecastFilter = normalizeForecastFilter(query.forecastFilter);
    const financingFilter = normalizeFinancingFilter(query.financingFilter);
    const depreciationFilter = normalizeDepreciationFilter(
      query.depreciationFilter,
    );
    const planAccountWhere = applyDepreciationFilter(
      applyFinancingFilter(
        planAccountWhereByDateBasis(
          year,
          month,
          competencia,
          dateBasis,
          forecastFilter,
        ),
        financingFilter,
      ),
      depreciationFilter,
    );
    const legacyWhere = applyLegacyDepreciationFilter(
      { competencia, active: true },
      depreciationFilter,
    );
    const responsibleFilters = normalizeResponsibleFilters(
      query.responsibles ?? query.responsible,
    );
    const companies = normalizeCompanyFilters(query.companies ?? query.company);
    const search = coerceText(query.search).toLowerCase();

    const version = await this.findVersion(year);
    const scenario = await this.findScenario(
      coerceText(query.scenarioId),
      version.id,
    );
    const scenarioRevenue = Math.max(
      0,
      scenario
        ? decimalToNumber(scenario.revenue)
        : parseNumber(query.revenue, decimalToNumber(version.baseRevenue)),
    );
    const baseRevenue =
      decimalToNumber(version.baseRevenue) || DEFAULT_BASE_REVENUE;
    const factor = baseRevenue > 0 ? scenarioRevenue / baseRevenue : 1;

    const lineWhere: Prisma.BudgetLineWhereInput = {
      versionId: version.id,
      active: true,
    };

    const [
      lines,
      planAccountActuals,
      legacyActuals,
      lastPlanAccountSync,
      lastLegacyActualSync,
      totalPlanAccountRows,
      totalLegacyRows,
      responsibles,
    ] = await Promise.all([
      this.prisma.budgetLine.findMany({
        where: lineWhere,
        orderBy: [{ monthlyCost: 'desc' }, { descricao: 'asc' }],
        include: {
          monthlyBudgets: {
            where: { year, month },
            select: { amount: true, updatedAt: true },
            take: 1,
          },
        },
      }),
      this.prisma.aethosPlanoContaCost.groupBy({
        by: ['codigoPlanoConta', 'nomePlanoConta'],
        where: planAccountWhere,
        _sum: {
          valorCusto: true,
        },
      }),
      this.prisma.aethosSubgroupActual.groupBy({
        by: ['idSubgrupo', 'descricao'],
        where: legacyWhere,
        _sum: {
          valorRealizado: true,
        },
      }),
      this.prisma.aethosPlanoContaCost.findFirst({
        where: { active: true },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosSubgroupActual.findFirst({
        where: { active: true },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosPlanoContaCost.count({
        where: planAccountWhere,
      }),
      this.prisma.aethosSubgroupActual.count({
        where: legacyWhere,
      }),
      this.prisma.budgetLine.findMany({
        where: {
          versionId: version.id,
          active: true,
          responsible: { not: null },
        },
        distinct: ['responsible'],
        orderBy: { responsible: 'asc' },
        select: { responsible: true },
      }),
    ]);
    const usePlanAccountCosts =
      totalPlanAccountRows > 0 ||
      dateBasis !== 'lancamento' ||
      forecastFilter !== 'all';

    const actualBySubgroup = new Map<
      string,
      { realized: number; description: string }
    >();

    const actualEntries = (
      usePlanAccountCosts
        ? planAccountActuals.map((row) => ({
            idSubgrupo: row.codigoPlanoConta,
            description: coerceText(row.nomePlanoConta),
            realized: decimalToNumber(row._sum.valorCusto),
          }))
        : legacyActuals.map((row) => ({
            idSubgrupo: row.idSubgrupo,
            description: coerceText(row.descricao),
            realized: decimalToNumber(row._sum.valorRealizado),
          }))
    ).filter(
      (entry) =>
        (financingFilter === 'include' ||
          !isFinancingDescription(entry.description)) &&
        (depreciationFilter === 'include' ||
          !isDepreciationDescription(entry.description)),
    );

    actualEntries.forEach((entry) => {
      const current = actualBySubgroup.get(entry.idSubgrupo);
      actualBySubgroup.set(entry.idSubgrupo, {
        realized: (current?.realized || 0) + entry.realized,
        description: current?.description || entry.description,
      });
    });

    const analysisLines = lines.filter(
      (line) =>
        (financingFilter === 'include' ||
          !isFinancingDescription(line.descricao)) &&
        (depreciationFilter === 'include' ||
          !isDepreciationDescription(line.descricao)),
    );

    const budgetRows = analysisLines.map((line) => {
      const monthlyBudget = line.monthlyBudgets[0];
      const originalMonthlyCost = decimalToNumber(line.monthlyCost);
      const monthlyCost = decimalToNumber(
        monthlyBudget?.amount ?? line.monthlyCost,
      );
      const proportionalBaseBudget = originalMonthlyCost * factor;
      const realized = actualBySubgroup.get(line.idSubgrupo)?.realized || 0;
      const variance = monthlyCost - realized;
      const percentUsed =
        monthlyCost > 0
          ? (realized / monthlyCost) * 100
          : realized > 0
            ? 100
            : 0;

      return {
        id: line.id,
        isBudgeted: true,
        idSubgrupo: line.idSubgrupo,
        descricao: line.descricao,
        company: classifyCompany(line.descricao),
        companyLabel: COMPANY_LABELS[classifyCompany(line.descricao)],
        responsible: coerceText(line.responsible) || DEFAULT_RESPONSIBLE,
        annualCost: roundMoney(decimalToNumber(line.annualCost)),
        originalMonthlyCost: roundMoney(originalMonthlyCost),
        monthlyCost: roundMoney(monthlyCost),
        monthlyBudgetUpdatedAt: monthlyBudget?.updatedAt.toISOString() || null,
        proportionalBaseBudget: roundMoney(proportionalBaseBudget),
        // Mantido como alias para clientes antigos da API.
        adjustedBudget: roundMoney(proportionalBaseBudget),
        realized: roundMoney(realized),
        variance: roundMoney(variance),
        percentUsed: Math.round(percentUsed * 10) / 10,
        status:
          monthlyCost <= 0 && realized > 0
            ? 'OVER'
            : percentUsed >= 100
              ? 'OVER'
              : percentUsed >= 85
                ? 'ATTENTION'
                : 'OK',
      };
    });

    const budgetedCodes = new Set(analysisLines.map((line) => line.idSubgrupo));
    const aethosOnlyRows = Array.from(actualBySubgroup.entries())
      .filter(([idSubgrupo]) => !budgetedCodes.has(idSubgrupo))
      .map(([idSubgrupo, actual]) => ({
        id: `aethos:${idSubgrupo}`,
        isBudgeted: false,
        idSubgrupo,
        descricao: actual.description || 'Plano de conta sem descricao',
        company: classifyCompany(actual.description),
        companyLabel: COMPANY_LABELS[classifyCompany(actual.description)],
        responsible: DEFAULT_RESPONSIBLE,
        annualCost: 0,
        originalMonthlyCost: 0,
        monthlyCost: 0,
        monthlyBudgetUpdatedAt: null,
        proportionalBaseBudget: 0,
        adjustedBudget: 0,
        realized: roundMoney(actual.realized),
        variance: roundMoney(-actual.realized),
        percentUsed: actual.realized > 0 ? 100 : 0,
        status: actual.realized > 0 ? ('OVER' as const) : ('OK' as const),
      }));

    const responsibleFilterSet = new Set(
      responsibleFilters.map((item) => normalizeComparable(item)),
    );
    const rows = [...budgetRows, ...aethosOnlyRows].filter((row) => {
      if (companies.length > 0 && !companies.includes(row.company)) {
        return false;
      }

      if (
        responsibleFilterSet.size > 0 &&
        !responsibleFilterSet.has(normalizeComparable(row.responsible))
      ) {
        return false;
      }

      if (!search) return true;

      return [row.idSubgrupo, row.descricao, row.responsible, row.companyLabel]
        .map((value) => coerceText(value).toLowerCase())
        .some((value) => value.includes(search));
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.originalBaseBudget += row.originalMonthlyCost;
        acc.monthlyBudget += row.monthlyCost;
        acc.proportionalBaseBudget += row.proportionalBaseBudget;
        acc.realized += row.realized;
        return acc;
      },
      {
        originalBaseBudget: 0,
        monthlyBudget: 0,
        proportionalBaseBudget: 0,
        realized: 0,
      },
    );

    return {
      version: {
        id: version.id,
        year: version.year,
        name: version.name,
        baseRevenue: roundMoney(baseRevenue),
        importedAt: version.importedAt.toISOString(),
      },
      scenario: scenario
        ? {
            id: scenario.id,
            name: scenario.name,
            revenue: roundMoney(decimalToNumber(scenario.revenue)),
            month: scenario.month,
            year: scenario.year,
          }
        : null,
      filters: {
        year,
        month,
        competencia,
        dateBasis,
        forecastFilter,
        financingFilter,
        depreciationFilter,
        companies,
        responsibles: responsibleFilters,
        // Campo singular preservado para clientes antigos da API.
        responsible:
          responsibleFilters.length === 1 ? responsibleFilters[0] : null,
        search: search || null,
      },
      revenue: roundMoney(scenarioRevenue),
      factor: Math.round(factor * 10000) / 10000,
      summary: {
        // Campos antigos preservados para compatibilidade com clientes existentes.
        baseBudget: roundMoney(summary.monthlyBudget),
        adjustedBudget: roundMoney(summary.proportionalBaseBudget),
        originalBaseBudget: roundMoney(summary.originalBaseBudget),
        monthlyBudget: roundMoney(summary.monthlyBudget),
        proportionalBaseBudget: roundMoney(summary.proportionalBaseBudget),
        realized: roundMoney(summary.realized),
        variance: roundMoney(summary.monthlyBudget - summary.realized),
        percentUsed:
          summary.monthlyBudget > 0
            ? Math.round((summary.realized / summary.monthlyBudget) * 1000) / 10
            : 0,
        lines: rows.length,
        budgetedLines: rows.filter((row) => row.isBudgeted).length,
        unbudgetedLines: rows.filter((row) => !row.isBudgeted).length,
        actualRows: usePlanAccountCosts
          ? totalPlanAccountRows
          : totalLegacyRows,
        lastActualSync:
          (usePlanAccountCosts
            ? lastPlanAccountSync?.syncedAt
            : lastLegacyActualSync?.syncedAt
          )?.toISOString() || null,
        actualSource: usePlanAccountCosts
          ? 'AETHOS_PLANO_CONTA'
          : 'AETHOS_SUBGRUPO',
      },
      responsibles: Array.from(
        new Set([
          DEFAULT_RESPONSIBLE,
          ...responsibles
            .map((item) => coerceText(item.responsible))
            .filter(Boolean),
        ]),
      ),
      rows,
    };
  }

  async getScenarios(
    query: Record<string, unknown>,
    actorRole?: string | null,
  ) {
    ensureReadAccess(actorRole);

    const year = normalizeYear(query.year);
    const version = await this.findVersion(year);
    const scenarios = await this.prisma.budgetScenario.findMany({
      where: { versionId: version.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      revenue: roundMoney(decimalToNumber(scenario.revenue)),
      year: scenario.year,
      month: scenario.month,
      createdAt: scenario.createdAt.toISOString(),
      updatedAt: scenario.updatedAt.toISOString(),
    }));
  }

  async getActuals(query: Record<string, unknown>, actorRole?: string | null) {
    ensureReadAccess(actorRole);

    const year = normalizeYear(query.year);
    const month = normalizeMonth(query.month);
    const competencia = normalizeCompetencia(year, month);
    const dateBasis = normalizeActualDateBasis(query.dateBasis);
    const forecastFilter = normalizeForecastFilter(query.forecastFilter);
    const financingFilter = normalizeFinancingFilter(query.financingFilter);
    const depreciationFilter = normalizeDepreciationFilter(
      query.depreciationFilter,
    );
    const idSubgrupo = coerceText(query.idSubgrupo);

    if (!idSubgrupo) {
      throw new BadRequestException(
        'Informe o subgrupo para consultar os lancamentos',
      );
    }

    const planAccountRows = await this.prisma.aethosPlanoContaCost.findMany({
      where: {
        ...applyDepreciationFilter(
          applyFinancingFilter(
            planAccountWhereByDateBasis(
              year,
              month,
              competencia,
              dateBasis,
              forecastFilter,
            ),
            financingFilter,
          ),
          depreciationFilter,
        ),
        codigoPlanoConta: idSubgrupo,
      },
      orderBy:
        dateBasis === 'vencimento'
          ? [
              { dataVencimento: 'desc' },
              { valorCusto: 'desc' },
              { idLancamento: 'asc' },
            ]
          : dateBasis === 'emissao_nf'
            ? [
                { dataEmissaoNotaFiscal: 'desc' },
                { dataLancamento: 'desc' },
                { valorCusto: 'desc' },
                { idLancamento: 'asc' },
              ]
            : [
                { dataBaseLancamento: 'desc' },
                { valorCusto: 'desc' },
                { idLancamento: 'asc' },
              ],
    });

    if (
      planAccountRows.length > 0 ||
      dateBasis !== 'lancamento' ||
      forecastFilter !== 'all'
    ) {
      const total = planAccountRows.reduce(
        (sum, row) => sum + decimalToNumber(row.valorCusto),
        0,
      );

      return {
        idSubgrupo,
        competencia,
        dateBasis,
        forecastFilter,
        financingFilter,
        depreciationFilter,
        source: 'AETHOS_PLANO_CONTA',
        count: planAccountRows.length,
        total: roundMoney(total),
        rows: planAccountRows.map((row) => {
          const raw =
            row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
              ? (row.raw as Record<string, unknown>)
              : {};

          return {
            id: row.id,
            matchKey: row.matchKey,
            idSubgrupo: row.codigoPlanoConta,
            descricao: row.nomePlanoConta,
            competencia: row.competencia,
            valorRealizado: roundMoney(decimalToNumber(row.valorCusto)),
            valorPago: roundMoney(decimalToNumber(row.valorPago)),
            valorSaldo: roundMoney(decimalToNumber(row.valorSaldo)),
            origem: row.origem,
            obra:
              coerceText(raw.nomeObra) || coerceText(raw.codigoObra) || null,
            centroCusto:
              coerceText(raw.nomeCentroCusto) ||
              coerceText(raw.codigoCentroCusto) ||
              null,
            idLancamento: row.idLancamento,
            codigoEmpresa: row.codigoEmpresa,
            nomeEmpresa: row.nomeEmpresa,
            dataBaseLancamento: row.dataBaseLancamento?.toISOString() || null,
            dataLancamento: row.dataLancamento?.toISOString() || null,
            dataVencimento: row.dataVencimento?.toISOString() || null,
            temNotaFiscal: row.temNotaFiscal,
            idNotaFiscal: row.idNotaFiscal,
            numeroNotaFiscal: row.numeroNotaFiscal,
            dataEmissaoNotaFiscal:
              row.dataEmissaoNotaFiscal?.toISOString() || null,
            observacaoLancamento: row.observacaoLancamento,
            observacaoNotaFiscal: row.observacaoNotaFiscal,
            dataReferencia:
              (dateBasis === 'vencimento'
                ? row.dataVencimento
                : dateBasis === 'emissao_nf'
                  ? row.temNotaFiscal
                    ? row.dataEmissaoNotaFiscal
                    : row.dataLancamento
                  : row.dataBaseLancamento
              )?.toISOString() || null,
            status: row.status,
            statusDescricao: row.statusDescricao,
            tipoDocumento: row.tipoDocumento,
            tipoDocumentoDescricao: row.tipoDocumentoDescricao,
            raw: row.raw,
            syncedAt: row.syncedAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        }),
      };
    }

    const rows = await this.prisma.aethosSubgroupActual.findMany({
      where: applyLegacyDepreciationFilter(
        { idSubgrupo, competencia, active: true },
        depreciationFilter,
      ),
      orderBy: [
        { valorRealizado: 'desc' },
        { obra: 'asc' },
        { centroCusto: 'asc' },
      ],
    });

    const total = rows.reduce(
      (sum, row) => sum + decimalToNumber(row.valorRealizado),
      0,
    );

    return {
      idSubgrupo,
      competencia,
      dateBasis,
      forecastFilter,
      financingFilter,
      depreciationFilter,
      source: 'AETHOS_SUBGRUPO',
      count: rows.length,
      total: roundMoney(total),
      rows: rows.map((row) => ({
        id: row.id,
        matchKey: row.matchKey,
        idSubgrupo: row.idSubgrupo,
        descricao: row.descricao,
        competencia: row.competencia,
        valorRealizado: roundMoney(decimalToNumber(row.valorRealizado)),
        origem: row.origem,
        obra: row.obra,
        centroCusto: row.centroCusto,
        raw: row.raw,
        syncedAt: row.syncedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async createScenario(
    body: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    ensureWriteAccess(actorRole);

    const year = normalizeYear(body?.year);
    const month =
      body?.month === undefined || body?.month === null || body?.month === ''
        ? null
        : normalizeMonth(body.month);
    const revenue = parseNumber(body?.revenue, 0);
    const name = coerceText(body?.name) || 'Cenario';

    if (revenue <= 0) {
      throw new BadRequestException('Faturamento invalido');
    }

    const version = await this.findVersion(year);
    const created = await this.prisma.budgetScenario.create({
      data: {
        versionId: version.id,
        name,
        revenue: new Prisma.Decimal(revenue.toFixed(2)),
        year,
        month,
        createdById: actorId || null,
      },
    });

    return {
      id: created.id,
      name: created.name,
      revenue: roundMoney(decimalToNumber(created.revenue)),
      year: created.year,
      month: created.month,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async updateMonthlyBudget(
    lineIdInput: unknown,
    body: any,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    ensureWriteAccess(actorRole);

    const lineId = coerceText(lineIdInput);
    const year = normalizeYear(body?.year);
    const month = normalizeMonth(body?.month);
    const amount = parseNumber(body?.amount, Number.NaN);

    if (!lineId) {
      throw new BadRequestException('Linha do orcamento invalida');
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Valor orcado invalido');
    }

    const version = await this.findVersion(year);
    const line = await this.prisma.budgetLine.findFirst({
      where: {
        id: lineId,
        versionId: version.id,
        active: true,
      },
      select: { id: true, idSubgrupo: true, descricao: true },
    });

    if (!line) {
      throw new NotFoundException('Linha do orcamento nao encontrada');
    }

    const saved = await this.prisma.budgetMonthlyLine.upsert({
      where: {
        lineId_year_month: { lineId: line.id, year, month },
      },
      create: {
        lineId: line.id,
        year,
        month,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        updatedById: actorId || null,
      },
      update: {
        amount: new Prisma.Decimal(amount.toFixed(2)),
        updatedById: actorId || null,
      },
    });

    return {
      id: saved.id,
      lineId: line.id,
      idSubgrupo: line.idSubgrupo,
      descricao: line.descricao,
      year: saved.year,
      month: saved.month,
      amount: roundMoney(decimalToNumber(saved.amount)),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async updateResponsible(body: any, actorRole?: string | null) {
    ensureWriteAccess(actorRole);

    const year = normalizeYear(body?.year);
    const lineId = coerceText(body?.lineId);
    const idSubgrupo = coerceText(body?.idSubgrupo);
    const descricao = coerceText(body?.descricao);
    const responsible = coerceText(body?.responsible) || DEFAULT_RESPONSIBLE;

    if (!idSubgrupo || !descricao) {
      throw new BadRequestException('Plano de conta invalido');
    }

    const version = await this.findVersion(year);
    let line;

    if (lineId && !lineId.startsWith('aethos:')) {
      const existing = await this.prisma.budgetLine.findFirst({
        where: { id: lineId, versionId: version.id, active: true },
        select: { id: true },
      });

      if (!existing) {
        throw new NotFoundException('Linha do orcamento nao encontrada');
      }

      line = await this.prisma.budgetLine.update({
        where: { id: existing.id },
        data: { responsible },
      });
    } else {
      line = await this.prisma.budgetLine.upsert({
        where: {
          versionId_idSubgrupo_descricao: {
            versionId: version.id,
            idSubgrupo,
            descricao,
          },
        },
        create: {
          versionId: version.id,
          idSubgrupo,
          descricao,
          annualCost: new Prisma.Decimal(0),
          monthlyCost: new Prisma.Decimal(0),
          referenceYear: year,
          responsible,
          active: true,
        },
        update: { responsible, active: true },
      });
    }

    return {
      id: line.id,
      idSubgrupo: line.idSubgrupo,
      descricao: line.descricao,
      responsible: line.responsible || DEFAULT_RESPONSIBLE,
    };
  }

  private async findVersion(year: number) {
    const version = await this.prisma.budgetVersion.findFirst({
      where: { year, active: true },
      orderBy: { importedAt: 'desc' },
    });

    if (!version) {
      throw new NotFoundException(
        `Orcamento base de ${year} ainda nao importado`,
      );
    }

    return version;
  }

  private async findScenario(id: string, versionId: string) {
    if (!id) return null;

    const scenario = await this.prisma.budgetScenario.findUnique({
      where: { id },
    });

    if (!scenario || scenario.versionId !== versionId) {
      throw new NotFoundException('Cenario nao encontrado');
    }

    return scenario;
  }
}
