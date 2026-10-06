import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';

type AnyRow = Record<string, unknown>;

export type SyncObra = {
  code: string;
  name: string;
  clientName: string | null;
  rawId: string | null;
  active: boolean;
};

type SyncObraCusto = {
  code: string;
  name: string | null;
  competencia: string;
  custoTotal: Prisma.Decimal;
  origem: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

type SyncSubgroupCost = {
  matchKey: string;
  idSubgrupo: string;
  descricao: string | null;
  competencia: string;
  valorRealizado: Prisma.Decimal;
  origem: string;
  obra: string | null;
  centroCusto: string | null;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

type SyncPlanAccountCost = {
  matchKey: string;
  idLancamento: string;
  codigoEmpresa: string | null;
  nomeEmpresa: string | null;
  codigoPlanoConta: string;
  nomePlanoConta: string | null;
  competencia: string;
  dataBaseLancamento: Date | null;
  dataLancamento: Date | null;
  dataVencimento: Date | null;
  temNotaFiscal: boolean;
  idNotaFiscal: string | null;
  numeroNotaFiscal: string | null;
  dataEmissaoNotaFiscal: Date | null;
  observacaoLancamento: string | null;
  observacaoNotaFiscal: string | null;
  valorCusto: Prisma.Decimal;
  valorPago: Prisma.Decimal | null;
  valorSaldo: Prisma.Decimal | null;
  status: string | null;
  statusDescricao: string | null;
  tipoDocumento: string | null;
  tipoDocumentoDescricao: string | null;
  origem: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

type SyncContractAttachment = {
  aethosId: string;
  documentAethosId: string;
  documentTypeAethos: string;
  fileName: string;
  description: string | null;
  extension: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  md5: string | null;
  includedAt: Date | null;
  storageType: string;
  sourceReference: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
};

type SyncContract = {
  aethosId: string;
  quotationAethosId: string | null;
  companyAethosId: string;
  workAethosId: string;
  workName: string;
  contractorAethosId: string;
  contractorName: string;
  registeredAt: Date;
  startDate: Date | null;
  endDate: Date | null;
  finalizedAt: Date | null;
  contractedAt: Date | null;
  lastContractedAt: Date | null;
  contractedByUser: string | null;
  originalValue: Prisma.Decimal;
  statusCode: string;
  statusDescription: string;
  notes: string | null;
  engineerAethosId: string | null;
  engineerName: string | null;
  retentionValue: Prisma.Decimal | null;
  anticipatedRetentionValue: Prisma.Decimal | null;
  retentionBalance: Prisma.Decimal | null;
  totalMeasuredValue: Prisma.Decimal | null;
  payableBalance: Prisma.Decimal | null;
  measurementBalance: Prisma.Decimal | null;
  contractBalance: Prisma.Decimal | null;
  contractQuantity: Prisma.Decimal | null;
  movesFinancial: boolean | null;
  returnsWorkBalance: boolean | null;
  accountPlanAethosId: string | null;
  accountPlanName: string | null;
  cancellationReason: string | null;
  generatedAttachments: Prisma.InputJsonValue | null;
  source: string;
  contentHash: string;
  raw: Prisma.InputJsonValue;
  active: boolean;
  attachments: SyncContractAttachment[];
};

function pick(row: AnyRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (normalizeText(value)) {
      return value;
    }
  }

  return '';
}

function normalizeCode(value: unknown) {
  return normalizeText(value).replace(/\D/g, '');
}

function normalizeSubgroupCode(value: unknown) {
  const text = normalizeText(value);
  if (!text) return '';

  const digits = text.replace(/\D/g, '');
  if (digits && digits.length >= text.replace(/\s/g, '').length - 2) {
    return digits.replace(/^0+(?=\d)/, '');
  }

  return text.toUpperCase();
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return '';
  }

  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeLongText(value: unknown) {
  if (value === undefined || value === null) return '';
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return '';
  }

  return String(value).trim();
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;

  const text = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (['true', '1', 'sim', 's', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'nao', 'n', 'no'].includes(text)) return false;
  return fallback;
}

function normalizeDecimal(value: unknown) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Prisma.Decimal(value.toFixed(2));
  }

  const text = normalizeText(value);
  if (!text) return null;

  const cleaned = text
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const numeric = Number(cleaned);

  return Number.isFinite(numeric)
    ? new Prisma.Decimal(numeric.toFixed(2))
    : null;
}

function normalizeCompetencia(value: unknown) {
  const text = normalizeText(value);
  if (!text) return 'ACUMULADO';

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (isoMatch) {
    const month = isoMatch[2].padStart(2, '0');
    return `${isoMatch[1]}-${month}`;
  }

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}`;
  }

  const monthYearMatch = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (monthYearMatch) {
    return `${monthYearMatch[2]}-${monthYearMatch[1].padStart(2, '0')}`;
  }

  return text.toUpperCase();
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return new Date(
      `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}T00:00:00.000Z`,
    );
  }

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) {
    return new Date(
      `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}T00:00:00.000Z`,
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeActive(value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;

  const text = normalizeText(value).toLowerCase();
  return ![
    'false',
    '0',
    'n',
    'nao',
    'não',
    'inativo',
    'inactive',
    'can',
    'rep',
    'cancelado',
    'cancelada',
  ].includes(text);
}

function listFromBody(body: unknown, keys: string[]) {
  if (Array.isArray(body)) return body as AnyRow[];
  if (!body || typeof body !== 'object') return [];

  const payload = body as AnyRow;
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value as AnyRow[];
  }

  return [];
}

function normalizeItems(body: unknown) {
  const rows = listFromBody(body, ['items', 'itens', 'rows', 'data']);

  return rows
    .map((row) => ({
      code: normalizeCode(
        pick(row, ['code', 'codigo', 'CODIGO', 'ID_ITEM', 'id', 'ID']),
      ),
      description: normalizeText(
        pick(row, [
          'description',
          'descricao',
          'DESCRICAO',
          'name',
          'nome',
          'NOME',
        ]),
      ),
      unit:
        normalizeText(
          pick(row, ['unit', 'unidade', 'UNIDADE', 'UNIDADE_MEDIDA']),
        ) || null,
      rawId:
        normalizeText(pick(row, ['rawId', 'raw_id', 'ID_ITEM', 'id', 'ID'])) ||
        null,
      active: normalizeActive(
        pick(row, ['active', 'ativo', 'ATIVO', 'status']),
      ),
    }))
    .filter((item) => item.code && item.description);
}

export function normalizeObras(body: unknown) {
  const rows = listFromBody(body, ['obras', 'works', 'rows', 'data']);

  return rows
    .map((row) => ({
      code: normalizeCode(
        pick(row, [
          'code',
          'codigo',
          'CODIGO',
          'codigoObra',
          'CODIGO_OBRA',
          'obra',
          'OBRA',
          'id',
          'ID',
        ]),
      ),
      name: normalizeText(
        pick(row, [
          'name',
          'nome',
          'NOME',
          'descricao',
          'DESCRICAO',
          'nomeObra',
          'NOME_OBRA',
          'apelido',
          'APELIDO',
        ]),
      ),
      clientName:
        normalizeText(
          pick(row, [
            'cliente',
            'CLIENTE',
            'client',
            'CLIENT',
            'clientName',
            'client_name',
            'nomeCliente',
            'nome_cliente',
            'NOME_CLIENTE',
            'razaoSocialCliente',
            'RAZAO_SOCIAL_CLIENTE',
          ]),
        ) || null,
      rawId:
        normalizeText(pick(row, ['rawId', 'raw_id', 'ID_OBRA', 'id', 'ID'])) ||
        null,
      active: normalizeActive(
        pick(row, ['active', 'ativo', 'ATIVO', 'status']),
      ),
    }))
    .filter((obra) => obra.code && obra.name);
}

function normalizeObrasCustos(body: unknown) {
  const rows = listFromBody(body, [
    'custos',
    'obrasCustos',
    'obraCustos',
    'costs',
    'rows',
    'data',
  ]);

  return rows
    .map((row) => {
      const custoTotal = normalizeDecimal(
        pick(row, [
          'custoTotal',
          'custo_total',
          'CUSTO_TOTAL',
          'valor',
          'VALOR',
          'vlCusto',
          'VL_CUSTO',
        ]),
      );

      return {
        code: normalizeCode(
          pick(row, [
            'code',
            'codigo',
            'CODIGO',
            'codigoObra',
            'CODIGO_OBRA',
            'obra',
            'OBRA',
            'ID_OBRA',
          ]),
        ),
        name:
          normalizeText(
            pick(row, [
              'name',
              'nome',
              'NOME',
              'nomeObra',
              'NOME_OBRA',
              'descricao',
              'DESCRICAO',
            ]),
          ) || null,
        competencia: normalizeCompetencia(
          pick(row, [
            'competencia',
            'COMPETENCIA',
            'mes',
            'MES',
            'data',
            'DATA',
          ]),
        ),
        custoTotal,
        origem:
          normalizeText(pick(row, ['origem', 'ORIGEM', 'source', 'SOURCE'])) ||
          'AETHOS',
        raw: row as Prisma.InputJsonValue,
        active: normalizeActive(
          pick(row, ['active', 'ativo', 'ATIVO', 'status']),
        ),
      };
    })
    .filter((item): item is SyncObraCusto => !!item.code && !!item.custoTotal);
}

function normalizeSubgroupCosts(body: unknown) {
  const rows = listFromBody(body, [
    'subgruposCustos',
    'subgrupoCustos',
    'subgroupsCosts',
    'custosSubgrupos',
    'custos',
    'costs',
    'rows',
    'data',
  ]);

  return rows
    .map((row) => {
      const idSubgrupo = normalizeSubgroupCode(
        pick(row, [
          'idSubgrupo',
          'id_subgrupo',
          'ID_SUBGRUPO',
          'subgrupo',
          'SUBGRUPO',
          'codigoSubgrupo',
          'CODIGO_SUBGRUPO',
          'subnivel',
          'SUBNIVEL',
          'idSubnivel',
          'ID_SUBNIVEL',
        ]),
      );
      const competencia = normalizeCompetencia(
        pick(row, ['competencia', 'COMPETENCIA', 'mes', 'MES', 'data', 'DATA']),
      );
      const valorRealizado = normalizeDecimal(
        pick(row, [
          'valorRealizado',
          'valor_realizado',
          'VALOR_REALIZADO',
          'custoRealizado',
          'custo_realizado',
          'CUSTO_REALIZADO',
          'custoTotal',
          'custo_total',
          'CUSTO_TOTAL',
          'valor',
          'VALOR',
          'vlCusto',
          'VL_CUSTO',
        ]),
      );
      const origem =
        normalizeText(pick(row, ['origem', 'ORIGEM', 'source', 'SOURCE'])) ||
        'AETHOS_SUBGRUPO';
      const obra =
        normalizeText(
          pick(row, [
            'obra',
            'OBRA',
            'codigoObra',
            'CODIGO_OBRA',
            'centroObra',
          ]),
        ) || null;
      const centroCusto =
        normalizeText(
          pick(row, [
            'centroCusto',
            'centro_custo',
            'CENTRO_CUSTO',
            'cc',
            'CC',
          ]),
        ) || null;
      const matchKey = [
        idSubgrupo,
        competencia,
        origem,
        obra || '',
        centroCusto || '',
      ].join('|');

      return {
        matchKey,
        idSubgrupo,
        descricao:
          normalizeText(
            pick(row, [
              'descricao',
              'DESCRICAO',
              'descrição',
              'DESCRIÇÃO',
              'description',
              'nome',
              'NOME',
              'name',
            ]),
          ) || null,
        competencia,
        valorRealizado,
        origem,
        obra,
        centroCusto,
        raw: row as Prisma.InputJsonValue,
        active: normalizeActive(
          pick(row, ['active', 'ativo', 'ATIVO', 'status']),
        ),
      };
    })
    .filter(
      (item): item is SyncSubgroupCost =>
        !!item.idSubgrupo && !!item.valorRealizado && !!item.competencia,
    );
}

function normalizePlanAccountCosts(body: unknown) {
  const rows = listFromBody(body, [
    'custosPlanoConta',
    'planoContaCustos',
    'custosPorPlanoConta',
    'custos',
    'costs',
    'rows',
    'data',
  ]);

  return rows
    .map((row) => {
      const idLancamento = normalizeText(
        pick(row, [
          'idLancamento',
          'id_lancamento',
          'ID_LANCAMENTO',
          'idReceberPagar',
          'ID_RECEBERPAGAR',
          'id_receberpagar',
          'idReceberPagar',
          'id',
          'ID',
        ]),
      );
      const codigoPlanoConta = normalizeSubgroupCode(
        pick(row, [
          'codigoPlanoConta',
          'codigo_plano_conta',
          'CODIGO_PLANO_CONTA',
          'ID_SUBNIVEL_PLANOCONTA',
          'idSubnivelPlanoConta',
          'id_subnivel_planoconta',
          'idSubgrupo',
          'ID_SUBGRUPO',
          'subgrupo',
          'SUBGRUPO',
        ]),
      );
      const valorCusto = normalizeDecimal(
        pick(row, [
          'valorCusto',
          'valor_custo',
          'VALOR_CUSTO',
          'VL_PARCELA',
          'vlParcela',
          'valor',
          'VALOR',
        ]),
      );
      const origem =
        normalizeText(
          pick(row, [
            'origem',
            'ORIGEM',
            'origemTabela',
            'ORIGEM_TABELA',
            'source',
            'SOURCE',
          ]),
        ) || 'VW_LST_CONTAS_PAGAR';
      const competencia = normalizeCompetencia(
        pick(row, [
          'competencia',
          'COMPETENCIA',
          'dataBaseLancamento',
          'DT_BASELANCAMENTO',
          'data',
          'DATA',
        ]),
      );

      return {
        matchKey: `${origem}|${idLancamento}`,
        idLancamento,
        codigoEmpresa:
          normalizeText(
            pick(row, [
              'codigoEmpresa',
              'codigo_empresa',
              'CODIGO_EMPRESA',
              'empresa',
              'EMPRESA',
            ]),
          ) || null,
        nomeEmpresa:
          normalizeText(
            pick(row, [
              'nomeEmpresa',
              'nome_empresa',
              'NOME_EMPRESA',
              'empresaNome',
              'EMPRESA_NOME',
            ]),
          ) || null,
        codigoPlanoConta,
        nomePlanoConta:
          normalizeText(
            pick(row, [
              'nomePlanoConta',
              'nome_plano_conta',
              'NOME_PLANO_CONTA',
              'DS_SUBNIVEL',
              'dsSubnivel',
              'descricao',
              'DESCRICAO',
              'description',
            ]),
          ) || null,
        competencia,
        dataBaseLancamento: normalizeDate(
          pick(row, [
            'dataBaseLancamento',
            'data_base_lancamento',
            'DT_BASELANCAMENTO',
          ]),
        ),
        dataLancamento: normalizeDate(
          pick(row, ['dataLancamento', 'data_lancamento', 'DT_LANCAMENTO']),
        ),
        dataVencimento: normalizeDate(
          pick(row, [
            'dataVencimento',
            'data_vencimento',
            'DT_VENCIMENTO',
            'dataPrevisaoPagamento',
            'DT_PREVISAOPAGAMENTO',
          ]),
        ),
        temNotaFiscal: normalizeBoolean(
          pick(row, ['temNotaFiscal', 'tem_nota_fiscal', 'TEM_NOTA_FISCAL']),
        ),
        idNotaFiscal:
          normalizeText(
            pick(row, ['idNotaFiscal', 'id_nota_fiscal', 'ID_NOTA_FISCAL']),
          ) || null,
        numeroNotaFiscal:
          normalizeText(
            pick(row, [
              'numeroNotaFiscal',
              'numero_nota_fiscal',
              'NUMERO_NOTA_FISCAL',
            ]),
          ) || null,
        dataEmissaoNotaFiscal: normalizeDate(
          pick(row, [
            'dataEmissaoNotaFiscal',
            'data_emissao_nota_fiscal',
            'DATA_EMISSAO_NOTA_FISCAL',
          ]),
        ),
        observacaoLancamento:
          normalizeLongText(
            pick(row, [
              'observacaoLancamento',
              'observacao_lancamento',
              'OBSERVACAO_LANCAMENTO',
            ]),
          ) || null,
        observacaoNotaFiscal:
          normalizeLongText(
            pick(row, [
              'observacaoNotaFiscal',
              'observacao_nota_fiscal',
              'OBSERVACAO_NOTA_FISCAL',
            ]),
          ) || null,
        valorCusto,
        valorPago: normalizeDecimal(
          pick(row, ['valorPago', 'valor_pago', 'VALOR_PAGO', 'VL_PAGO']),
        ),
        valorSaldo: normalizeDecimal(
          pick(row, [
            'valorSaldo',
            'valor_saldo',
            'VALOR_SALDO',
            'VL_SALDOPARCELA',
          ]),
        ),
        status:
          normalizeText(
            pick(row, ['status', 'STATUS', 'flStatus', 'FL_STATUS']),
          ) || null,
        statusDescricao:
          normalizeText(
            pick(row, [
              'statusDescricao',
              'status_descricao',
              'STATUS_DESCRICAO',
              'descricaoStatus',
            ]),
          ) || null,
        tipoDocumento:
          normalizeText(
            pick(row, [
              'tipoDocumento',
              'tipo_documento',
              'TIPO_DOCUMENTO',
              'tpDocumento',
            ]),
          ) || null,
        tipoDocumentoDescricao:
          normalizeText(
            pick(row, [
              'tipoDocumentoDescricao',
              'tipo_documento_descricao',
              'TIPO_DOCUMENTO_DESCRICAO',
              'descricaoTipoDocumento',
            ]),
          ) || null,
        origem,
        raw: row as Prisma.InputJsonValue,
        active: normalizeActive(
          pick(row, ['active', 'ativo', 'ATIVO', 'status', 'STATUS']),
        ),
      };
    })
    .filter(
      (item): item is SyncPlanAccountCost =>
        !!item.idLancamento &&
        !!item.codigoPlanoConta &&
        !!item.competencia &&
        !!item.valorCusto,
    );
}

function normalizeNullableBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeBoolean(value);
}

function normalizeSafeContractDate(value: unknown) {
  const date = normalizeDate(value);
  if (!date) return null;

  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date : null;
}

function normalizeSafeContractDateTime(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  const isoDateTime = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  let date: Date | null = null;

  if (isoDateTime) {
    const milliseconds = (isoDateTime[7] || '').padEnd(3, '0');
    const timezone = isoDateTime[8] || 'Z';
    const normalizedTimezone =
      timezone !== 'Z' && !timezone.includes(':')
        ? `${timezone.slice(0, 3)}:${timezone.slice(3)}`
        : timezone;
    date = new Date(
      `${isoDateTime[1]}-${isoDateTime[2].padStart(2, '0')}-${isoDateTime[3].padStart(2, '0')}T${isoDateTime[4].padStart(2, '0')}:${isoDateTime[5]}:${isoDateTime[6] || '00'}.${milliseconds || '000'}${normalizedTimezone}`,
    );
  } else {
    date = normalizeDate(value);
  }

  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date : null;
}

function normalizePositiveInteger(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  const parsed = Number(text.replace(/[^\d]/g, ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeMd5(value: unknown) {
  const text = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '');
  return text || null;
}

function hashCanonicalValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const PLAN_ACCOUNT_REPARCELMENT_ORIGIN = 'VW_LST_CONTAS_PAGAR';
const PLAN_ACCOUNT_REPARCELMENT_RULE = 'RECEBERPAGAR_REPAR_DOC_ORIG_TITULO_PAI';
const MAX_REPARCELMENT_RECONCILIATION_IDS = 20_000;

function normalizePlanAccountReparcelmentReconciliation(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Payload de reconciliacao invalido');
  }

  const payload = body as AnyRow;
  const reconciliationId = normalizeText(
    pick(payload, [
      'reconciliationId',
      'idReconciliacao',
      'syncRunId',
      'runId',
    ]),
  );
  const rawIds = [
    'idLancamentosAgrupadores',
    'idsLancamentosAgrupadores',
    'idLancamentos',
    'ids',
  ]
    .map((key) => payload[key])
    .find((value) => Array.isArray(value));

  if (!reconciliationId) {
    throw new BadRequestException('reconciliationId e obrigatorio');
  }
  if (reconciliationId.length > 160) {
    throw new BadRequestException('reconciliationId excede 160 caracteres');
  }
  if (!Array.isArray(rawIds)) {
    throw new BadRequestException(
      'idLancamentosAgrupadores deve ser uma lista',
    );
  }

  const idLancamentos = Array.from(
    new Set(rawIds.map((value) => normalizeText(value)).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, 'pt-BR', { numeric: true }),
  );

  if (!idLancamentos.length) {
    throw new BadRequestException(
      'Informe ao menos um id de titulo-pai agrupador',
    );
  }
  if (idLancamentos.length > MAX_REPARCELMENT_RECONCILIATION_IDS) {
    throw new BadRequestException(
      `A reconciliacao aceita no maximo ${MAX_REPARCELMENT_RECONCILIATION_IDS} ids`,
    );
  }

  const metadataValue = payload.metadata ?? payload.metadados;
  const metadata =
    metadataValue &&
    typeof metadataValue === 'object' &&
    !Array.isArray(metadataValue)
      ? (metadataValue as Prisma.InputJsonValue)
      : null;
  const execute = normalizeBoolean(
    pick(payload, ['execute', 'executar', 'confirmar']),
    false,
  );
  const payloadHash = hashCanonicalValue({
    origin: PLAN_ACCOUNT_REPARCELMENT_ORIGIN,
    rule: PLAN_ACCOUNT_REPARCELMENT_RULE,
    idLancamentos,
  });

  return {
    reconciliationId,
    idLancamentos,
    metadata,
    execute,
    payloadHash,
  };
}

function normalizeGeneratedContractAttachments(
  row: AnyRow,
): Prisma.InputJsonValue | null {
  const value = row.anexosGerados ?? row.generatedAttachments;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Prisma.InputJsonValue;
}

function normalizeContractAttachments(row: AnyRow) {
  const source = Array.isArray(row.anexos)
    ? row.anexos
    : Array.isArray(row.attachments)
      ? row.attachments
      : [];

  return source
    .filter(
      (item): item is AnyRow =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .map((attachment) => ({
      aethosId: normalizeText(
        pick(attachment, [
          'idAnexoAethos',
          'id_anexo_aethos',
          'ID_ARQUIVO_DOCUMENTO',
        ]),
      ),
      documentAethosId: normalizeText(
        pick(attachment, [
          'idDocumentoAethos',
          'id_documento_aethos',
          'ID_DOCUMENTO',
        ]),
      ),
      documentTypeAethos:
        normalizeText(
          pick(attachment, [
            'tipoDocumentoAethos',
            'tipo_documento_aethos',
            'FL_DOCUMENTO',
          ]),
        ) || 'OCT',
      fileName: normalizeLongText(
        pick(attachment, ['nomeArquivo', 'nome_arquivo', 'DS_NOME_ARQUIVO']),
      ),
      description:
        normalizeLongText(
          pick(attachment, ['descricao', 'description', 'DS_DESCRICAO']),
        ) || null,
      extension:
        normalizeText(
          pick(attachment, ['extensao', 'extension', 'FL_ARQUIVO']),
        ) || null,
      mimeType:
        normalizeText(pick(attachment, ['mimeType', 'mime_type'])) || null,
      sizeBytes: normalizePositiveInteger(
        pick(attachment, ['tamanhoBytes', 'sizeBytes', 'size_bytes']),
      ),
      md5: normalizeMd5(pick(attachment, ['md5', 'MD5', 'DS_MD5'])),
      includedAt: normalizeDate(
        pick(attachment, ['dataInclusao', 'includedAt', 'DT_CADASTRO']),
      ),
      storageType:
        normalizeText(
          pick(attachment, [
            'formaArmazenamento',
            'storageType',
            'storage_type',
          ]),
        ) || 'BLOB_FIREBIRD',
      sourceReference:
        normalizeText(
          pick(attachment, [
            'referenciaOrigem',
            'sourceReference',
            'source_reference',
          ]),
        ) || 'CONTRATO',
      raw: attachment as Prisma.InputJsonValue,
      active: normalizeActive(pick(attachment, ['active', 'ativo', 'ATIVO'])),
    }))
    .filter((attachment): attachment is SyncContractAttachment =>
      Boolean(
        attachment.aethosId &&
        attachment.documentAethosId &&
        attachment.fileName,
      ),
    );
}

export function normalizeContracts(body: unknown) {
  const rows = listFromBody(body, ['contratos', 'contracts', 'rows', 'data']);

  return rows
    .map((row) => {
      const registeredAt = normalizeDate(
        pick(row, ['dataCadastro', 'registeredAt', 'DT_CADASTRO']),
      );
      const originalValue = normalizeDecimal(
        pick(row, ['valorOriginal', 'originalValue', 'VL_CONTRATO']),
      );
      const statusCode = normalizeText(
        pick(row, ['statusCodigo', 'statusCode', 'FL_STATUS']),
      ).toUpperCase();
      const statusDescription =
        normalizeText(
          pick(row, ['statusDescricao', 'statusDescription', 'DS_STATUS']),
        ) ||
        ({
          A: 'Aberto',
          C: 'Cancelado',
          F: 'Finalizado',
          O: 'Contratado',
          P: 'Aguardando aprovacao',
        }[statusCode] ??
          'Nao informado');
      const attachments = normalizeContractAttachments(row);
      const generatedAttachments = normalizeGeneratedContractAttachments(row);

      const contract = {
        aethosId: normalizeText(
          pick(row, [
            'idContratoAethos',
            'id_contract_aethos',
            'ID_OBRA_CONTRATO',
          ]),
        ),
        quotationAethosId:
          normalizeText(
            pick(row, [
              'idCotacaoAethos',
              'quotationAethosId',
              'ID_OBRA_COTACAO',
            ]),
          ) || null,
        companyAethosId: normalizeText(
          pick(row, ['idEmpresaAethos', 'companyAethosId', 'ID_EMPRESA']),
        ),
        workAethosId: normalizeText(
          pick(row, ['idObraAethos', 'workAethosId', 'ID_OBRA']),
        ),
        workName: normalizeText(pick(row, ['nomeObra', 'workName', 'NM_OBRA'])),
        contractorAethosId: normalizeText(
          pick(row, ['idContratanteAethos', 'contractorAethosId', 'ID_PESSOA']),
        ),
        contractorName: normalizeText(
          pick(row, ['nomeContratante', 'contractorName', 'NM_PESSOA']),
        ),
        registeredAt,
        startDate: normalizeSafeContractDate(
          pick(row, ['dataInicio', 'startDate', 'DT_INICIO']),
        ),
        endDate: normalizeSafeContractDate(
          pick(row, ['dataFim', 'endDate', 'DT_CONCLUSAO']),
        ),
        finalizedAt: normalizeSafeContractDate(
          pick(row, ['dataFinalizacao', 'finalizedAt', 'DT_FINALIZACAO']),
        ),
        contractedAt: normalizeSafeContractDateTime(
          pick(row, ['dataContratado', 'contractedAt', 'DT_CONTRATADO']),
        ),
        lastContractedAt: normalizeSafeContractDateTime(
          pick(row, [
            'dataUltimaContratacao',
            'lastContractedAt',
            'DT_ULTIMA_CONTRATACAO',
          ]),
        ),
        contractedByUser:
          normalizeText(
            pick(row, [
              'usuarioContratacao',
              'contractedByUser',
              'USUARIO_CONTRATACAO',
            ]),
          ) || null,
        originalValue,
        statusCode,
        statusDescription,
        notes:
          normalizeLongText(
            pick(row, ['observacao', 'notes', 'DS_OBSERVACAO']),
          ) || null,
        engineerAethosId:
          normalizeText(
            pick(row, [
              'idEngenheiroAethos',
              'engineerAethosId',
              'ID_ENGENHEIRO',
            ]),
          ) || null,
        engineerName:
          normalizeText(
            pick(row, ['engenheiro', 'engineerName', 'NM_ENGENHEIRO']),
          ) || null,
        retentionValue: normalizeDecimal(
          pick(row, ['valorRetencao', 'retentionValue', 'VL_RETENCAO']),
        ),
        anticipatedRetentionValue: normalizeDecimal(
          pick(row, [
            'valorRetencaoAntecipada',
            'anticipatedRetentionValue',
            'VL_RETENCAO_ANTECIPADA',
          ]),
        ),
        retentionBalance: normalizeDecimal(
          pick(row, ['saldoRetencao', 'retentionBalance', 'VL_SALDO_RETENCAO']),
        ),
        totalMeasuredValue: normalizeDecimal(
          pick(row, [
            'valorTotalMedicao',
            'totalMeasuredValue',
            'VL_TOTAL_MEDICAO',
          ]),
        ),
        payableBalance: normalizeDecimal(
          pick(row, ['saldoPagar', 'payableBalance', 'VL_SALDO_PAGAR']),
        ),
        measurementBalance: normalizeDecimal(
          pick(row, ['saldoMedicao', 'measurementBalance', 'VL_SALDO_MEDICAO']),
        ),
        contractBalance: normalizeDecimal(
          pick(row, ['saldoContrato', 'contractBalance', 'VL_SALDO']),
        ),
        contractQuantity: normalizeDecimal(
          pick(row, ['quantidadeContrato', 'contractQuantity', 'QT_CONTRATO']),
        ),
        movesFinancial: normalizeNullableBoolean(
          pick(row, [
            'movimentaFinanceiro',
            'movesFinancial',
            'FL_MOV_FINANCEIRO',
          ]),
        ),
        returnsWorkBalance: normalizeNullableBoolean(
          pick(row, [
            'voltaSaldoObra',
            'returnsWorkBalance',
            'FL_VOLTA_SALDO_OBRA',
          ]),
        ),
        accountPlanAethosId:
          normalizeText(
            pick(row, [
              'idPlanoContaAethos',
              'accountPlanAethosId',
              'ID_SUBNIVEL_PLANOCONTAS',
            ]),
          ) || null,
        accountPlanName:
          normalizeText(
            pick(row, ['planoConta', 'accountPlanName', 'DS_SUBNIVEL']),
          ) || null,
        cancellationReason:
          normalizeLongText(
            pick(row, [
              'motivoCancelamento',
              'cancellationReason',
              'DS_MOTIVOCANCELAMENTO',
            ]),
          ) || null,
        generatedAttachments,
        source:
          normalizeText(pick(row, ['source', 'origem', 'ORIGEM'])) || 'AETHOS',
        raw: row as Prisma.InputJsonValue,
        active: normalizeActive(pick(row, ['active', 'ativo', 'ATIVO'])),
        attachments,
      };

      return {
        ...contract,
        contentHash: hashCanonicalValue({
          ...contract,
          raw: undefined,
          attachments: undefined,
        }),
      };
    })
    .filter((contract): contract is SyncContract =>
      Boolean(
        contract.aethosId &&
        contract.companyAethosId &&
        contract.workAethosId &&
        contract.workName &&
        contract.contractorAethosId &&
        contract.contractorName &&
        contract.registeredAt &&
        contract.originalValue !== null &&
        contract.statusCode,
      ),
    );
}

export function updateWorksWithAethosData(
  state: unknown,
  obrasByCode: Map<string, SyncObra>,
) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { data: state, updated: 0 };
  }

  const data = state as AnyRow;
  const works = Array.isArray(data.works) ? data.works : [];
  let updated = 0;

  const nextWorks = works.map((work) => {
    if (!work || typeof work !== 'object' || Array.isArray(work)) return work;
    const nextWork = work as AnyRow;
    const code = normalizeCode(
      nextWork.codigoObra ?? nextWork.code ?? nextWork.codigo ?? '',
    );
    const obra = obrasByCode.get(code);

    if (!obra) return work;

    const currentName = normalizeText(
      nextWork.nome ??
        nextWork.nomeObra ??
        nextWork.name ??
        nextWork.descricaoObra ??
        '',
    );
    const currentClient = normalizeText(
      nextWork.cliente ?? nextWork.clientName ?? '',
    );
    const nameChanged = currentName !== obra.name;
    const clientChanged = Boolean(
      obra.clientName && currentClient !== obra.clientName,
    );

    if (!nameChanged && !clientChanged) return work;

    updated += 1;
    return {
      ...nextWork,
      nome: obra.name,
      nomeObra: obra.name,
      name: nextWork.name !== undefined ? obra.name : nextWork.name,
      descricaoObra:
        nextWork.descricaoObra !== undefined
          ? obra.name
          : nextWork.descricaoObra,
      cliente: obra.clientName || nextWork.cliente,
      clientName:
        nextWork.clientName !== undefined && obra.clientName
          ? obra.clientName
          : nextWork.clientName,
    };
  });

  return {
    data: {
      ...data,
      works: nextWorks,
    },
    updated,
  };
}

@Injectable()
export class AethosIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly s3UploadService: S3UploadService,
  ) {}

  assertToken(headerToken?: string | string[], authorization?: string) {
    const expectedToken = this.config.get<string>('AETHOS_SYNC_TOKEN')?.trim();

    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'AETHOS_SYNC_TOKEN nao configurado',
      );
    }

    const tokenFromHeader = Array.isArray(headerToken)
      ? headerToken[0]
      : headerToken;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const token = (tokenFromHeader || bearerToken || '').trim();

    if (!token || token !== expectedToken) {
      throw new UnauthorizedException('Token de integracao invalido');
    }
  }

  async status() {
    const [
      items,
      obras,
      obrasCustos,
      subgruposCustos,
      custosPlanoConta,
      contratos,
      anexosContratos,
      veiculosAethos,
      veiculosAethosAtivos,
      veiculosAethosSemClassificacao,
      lastItem,
      lastObra,
      lastObraCusto,
      lastSubgroupCost,
      lastPlanAccountCost,
      lastContract,
      lastContractAttachment,
      lastVehicleSync,
    ] = await Promise.all([
      this.prisma.aethosItem.count({ where: { active: true } }),
      this.prisma.aethosObra.count({ where: { active: true } }),
      this.prisma.aethosObraCusto.count({ where: { active: true } }),
      this.prisma.aethosSubgroupActual.count({ where: { active: true } }),
      this.prisma.aethosPlanoContaCost.count({ where: { active: true } }),
      this.prisma.aethosContract.count({ where: { active: true } }),
      this.prisma.aethosContractAttachment.count({
        where: { active: true },
      }),
      this.prisma.vehicle.count({ where: { aethosManaged: true } }),
      this.prisma.vehicle.count({
        where: { aethosManaged: true, active: true },
      }),
      this.prisma.vehicle.count({
        where: {
          aethosManaged: true,
          active: true,
          OR: [
            { filial: 'NAO_CLASSIFICADA' },
            { tipoFrota: 'Não classificado' },
          ],
        },
      }),
      this.prisma.aethosItem.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosObra.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosObraCusto.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosSubgroupActual.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosPlanoContaCost.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosContract.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosContractAttachment.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.aethosVehicleSyncRun.findFirst({
        orderBy: { executedAt: 'desc' },
        select: {
          snapshotId: true,
          generatedAt: true,
          executedAt: true,
          receivedCount: true,
          createdCount: true,
          linkedCount: true,
          updatedCount: true,
          reactivatedCount: true,
          deactivatedCount: true,
        },
      }),
    ]);
    const lastPlanAccountCostBatchRows = lastPlanAccountCost?.syncedAt
      ? await this.prisma.aethosPlanoContaCost.count({
          where: { syncedAt: lastPlanAccountCost.syncedAt },
        })
      : 0;

    return {
      ok: true,
      items,
      obras,
      obrasCustos,
      subgruposCustos,
      custosPlanoConta,
      contratos,
      anexosContratos,
      veiculosAethos,
      veiculosAethosAtivos,
      veiculosAethosSemClassificacao,
      lastItemSync: lastItem?.syncedAt ?? null,
      lastObraSync: lastObra?.syncedAt ?? null,
      lastObraCustoSync: lastObraCusto?.syncedAt ?? null,
      lastSubgroupCostSync: lastSubgroupCost?.syncedAt ?? null,
      lastPlanAccountCostSync: lastPlanAccountCost?.syncedAt ?? null,
      lastContractSync: lastContract?.syncedAt ?? null,
      lastContractAttachmentSync: lastContractAttachment?.syncedAt ?? null,
      lastVehicleSync: lastVehicleSync?.executedAt ?? null,
      lastVehicleSnapshot: lastVehicleSync ?? null,
      lastPlanAccountCostBatchRows,
    };
  }

  async syncItems(body: unknown) {
    const items = normalizeItems(body);

    if (!items.length) {
      throw new BadRequestException('Nenhum item valido recebido');
    }

    const itemByCode = new Map(items.map((item) => [item.code, item]));
    const now = new Date();
    let rncItemsUpdated = 0;
    let legacyRncsUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.aethosItem.upsert({
          where: { code: item.code },
          create: {
            code: item.code,
            description: item.description,
            unit: item.unit,
            rawId: item.rawId,
            active: item.active,
            syncedAt: now,
          },
          update: {
            description: item.description,
            unit: item.unit,
            rawId: item.rawId,
            active: item.active,
            syncedAt: now,
          },
        });
      }

      const rncItems = await tx.rncItem.findMany({
        where: { code: { in: [...itemByCode.keys()] } },
        select: { id: true, code: true, description: true, unit: true },
      });

      for (const rncItem of rncItems) {
        const item = itemByCode.get(normalizeCode(rncItem.code));
        if (!item) continue;

        const shouldUpdateDescription =
          rncItem.description !== item.description;
        const shouldUpdateUnit = !!item.unit && rncItem.unit !== item.unit;
        if (!shouldUpdateDescription && !shouldUpdateUnit) continue;

        await tx.rncItem.update({
          where: { id: rncItem.id },
          data: {
            code: item.code,
            description: item.description,
            ...(item.unit ? { unit: item.unit } : {}),
          },
        });
        rncItemsUpdated += 1;
      }

      const legacyRncs = await tx.rnc.findMany({
        where: { internalCodigoItem: { in: [...itemByCode.keys()] } },
        select: { id: true, internalCodigoItem: true, internalDescricao: true },
      });

      for (const rnc of legacyRncs) {
        const item = itemByCode.get(normalizeCode(rnc.internalCodigoItem));
        if (!item || rnc.internalDescricao === item.description) continue;

        await tx.rnc.update({
          where: { id: rnc.id },
          data: {
            internalCodigoItem: item.code,
            internalDescricao: item.description,
          },
        });
        legacyRncsUpdated += 1;
      }
    });

    return {
      ok: true,
      received: listFromBody(body, ['items', 'itens', 'rows', 'data']).length,
      upserted: items.length,
      skipped: Math.max(
        0,
        listFromBody(body, ['items', 'itens', 'rows', 'data']).length -
          items.length,
      ),
      rncItemsUpdated,
      legacyRncsUpdated,
    };
  }

  async syncObras(body: unknown) {
    const obras = normalizeObras(body);

    if (!obras.length) {
      throw new BadRequestException('Nenhuma obra valida recebida');
    }

    const obrasByCode = new Map(obras.map((obra) => [obra.code, obra]));
    const now = new Date();
    let constructionWorksUpdated = 0;
    let rncsUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const obra of obras) {
        await tx.aethosObra.upsert({
          where: { code: obra.code },
          create: {
            code: obra.code,
            name: obra.name,
            clientName: obra.clientName,
            rawId: obra.rawId,
            active: obra.active,
            syncedAt: now,
          },
          update: {
            name: obra.name,
            ...(obra.clientName ? { clientName: obra.clientName } : {}),
            rawId: obra.rawId,
            active: obra.active,
            syncedAt: now,
          },
        });
      }

      const state = await tx.constructionControlState.findUnique({
        where: { id: 'default' },
        select: { data: true },
      });

      const nextState = updateWorksWithAethosData(state?.data, obrasByCode);
      if (state && nextState.updated > 0) {
        await tx.constructionControlState.update({
          where: { id: 'default' },
          data: { data: nextState.data as Prisma.InputJsonValue },
        });
        constructionWorksUpdated = nextState.updated;
      }

      const rncs = await tx.rnc.findMany({
        select: { id: true, obra: true, obraDescricao: true },
      });

      for (const rnc of rncs) {
        const obra = obrasByCode.get(normalizeCode(rnc.obra));
        if (!obra || rnc.obraDescricao === obra.name) continue;

        await tx.rnc.update({
          where: { id: rnc.id },
          data: {
            obra: obra.code,
            obraDescricao: obra.name,
          },
        });
        rncsUpdated += 1;
      }
    });

    return {
      ok: true,
      received: listFromBody(body, ['obras', 'works', 'rows', 'data']).length,
      upserted: obras.length,
      withClient: obras.filter((obra) => Boolean(obra.clientName)).length,
      withoutClient: obras.filter((obra) => !obra.clientName).length,
      skipped: Math.max(
        0,
        listFromBody(body, ['obras', 'works', 'rows', 'data']).length -
          obras.length,
      ),
      constructionWorksUpdated,
      rncsUpdated,
    };
  }

  async syncObrasCustos(body: unknown) {
    const custos = normalizeObrasCustos(body);

    if (!custos.length) {
      throw new BadRequestException('Nenhum custo de obra valido recebido');
    }

    const now = new Date();
    const rawRows = listFromBody(body, [
      'custos',
      'obrasCustos',
      'obraCustos',
      'costs',
      'rows',
      'data',
    ]);

    await this.prisma.$transaction(async (tx) => {
      for (const custo of custos) {
        await tx.aethosObraCusto.upsert({
          where: {
            code_competencia_origem: {
              code: custo.code,
              competencia: custo.competencia,
              origem: custo.origem,
            },
          },
          create: {
            code: custo.code,
            name: custo.name,
            competencia: custo.competencia,
            custoTotal: custo.custoTotal,
            origem: custo.origem,
            raw: custo.raw,
            active: custo.active,
            syncedAt: now,
          },
          update: {
            name: custo.name,
            custoTotal: custo.custoTotal,
            raw: custo.raw,
            active: custo.active,
            syncedAt: now,
          },
        });
      }
    });

    return {
      ok: true,
      received: rawRows.length,
      upserted: custos.length,
      skipped: Math.max(0, rawRows.length - custos.length),
    };
  }

  async syncSubgroupCosts(body: unknown) {
    const custos = normalizeSubgroupCosts(body);

    if (!custos.length) {
      throw new BadRequestException(
        'Nenhum custo por subgrupo valido recebido',
      );
    }

    const now = new Date();
    const rawRows = listFromBody(body, [
      'subgruposCustos',
      'subgrupoCustos',
      'subgroupsCosts',
      'custosSubgrupos',
      'custos',
      'costs',
      'rows',
      'data',
    ]);

    await this.prisma.$transaction(async (tx) => {
      for (const custo of custos) {
        await tx.aethosSubgroupActual.upsert({
          where: { matchKey: custo.matchKey },
          create: {
            matchKey: custo.matchKey,
            idSubgrupo: custo.idSubgrupo,
            descricao: custo.descricao,
            competencia: custo.competencia,
            valorRealizado: custo.valorRealizado,
            origem: custo.origem,
            obra: custo.obra,
            centroCusto: custo.centroCusto,
            raw: custo.raw,
            active: custo.active,
            syncedAt: now,
          },
          update: {
            descricao: custo.descricao,
            valorRealizado: custo.valorRealizado,
            obra: custo.obra,
            centroCusto: custo.centroCusto,
            raw: custo.raw,
            active: custo.active,
            syncedAt: now,
          },
        });
      }
    });

    return {
      ok: true,
      received: rawRows.length,
      upserted: custos.length,
      skipped: Math.max(0, rawRows.length - custos.length),
    };
  }

  async syncPlanAccountCosts(body: unknown) {
    const custos = normalizePlanAccountCosts(body);

    if (!custos.length) {
      throw new BadRequestException(
        'Nenhum custo por plano de conta valido recebido',
      );
    }

    const now = new Date();
    const rawRows = listFromBody(body, [
      'custosPlanoConta',
      'planoContaCustos',
      'custosPorPlanoConta',
      'custos',
      'costs',
      'rows',
      'data',
    ]);

    await this.prisma.$transaction(async (tx) => {
      for (const custo of custos) {
        await tx.aethosPlanoContaCost.upsert({
          where: {
            origem_idLancamento: {
              origem: custo.origem,
              idLancamento: custo.idLancamento,
            },
          },
          create: {
            matchKey: custo.matchKey,
            idLancamento: custo.idLancamento,
            codigoEmpresa: custo.codigoEmpresa,
            nomeEmpresa: custo.nomeEmpresa,
            codigoPlanoConta: custo.codigoPlanoConta,
            nomePlanoConta: custo.nomePlanoConta,
            competencia: custo.competencia,
            dataBaseLancamento: custo.dataBaseLancamento,
            dataLancamento: custo.dataLancamento,
            dataVencimento: custo.dataVencimento,
            temNotaFiscal: custo.temNotaFiscal,
            idNotaFiscal: custo.idNotaFiscal,
            numeroNotaFiscal: custo.numeroNotaFiscal,
            dataEmissaoNotaFiscal: custo.dataEmissaoNotaFiscal,
            observacaoLancamento: custo.observacaoLancamento,
            observacaoNotaFiscal: custo.observacaoNotaFiscal,
            valorCusto: custo.valorCusto,
            valorPago: custo.valorPago,
            valorSaldo: custo.valorSaldo,
            status: custo.status,
            statusDescricao: custo.statusDescricao,
            tipoDocumento: custo.tipoDocumento,
            tipoDocumentoDescricao: custo.tipoDocumentoDescricao,
            origem: custo.origem,
            raw: custo.raw,
            active: custo.active,
            deactivatedAt: null,
            deactivationReason: null,
            reconciliationId: null,
            syncedAt: now,
          },
          update: {
            matchKey: custo.matchKey,
            codigoEmpresa: custo.codigoEmpresa,
            nomeEmpresa: custo.nomeEmpresa,
            codigoPlanoConta: custo.codigoPlanoConta,
            nomePlanoConta: custo.nomePlanoConta,
            competencia: custo.competencia,
            dataBaseLancamento: custo.dataBaseLancamento,
            dataLancamento: custo.dataLancamento,
            dataVencimento: custo.dataVencimento,
            temNotaFiscal: custo.temNotaFiscal,
            idNotaFiscal: custo.idNotaFiscal,
            numeroNotaFiscal: custo.numeroNotaFiscal,
            dataEmissaoNotaFiscal: custo.dataEmissaoNotaFiscal,
            observacaoLancamento: custo.observacaoLancamento,
            observacaoNotaFiscal: custo.observacaoNotaFiscal,
            valorCusto: custo.valorCusto,
            valorPago: custo.valorPago,
            valorSaldo: custo.valorSaldo,
            status: custo.status,
            statusDescricao: custo.statusDescricao,
            tipoDocumento: custo.tipoDocumento,
            tipoDocumentoDescricao: custo.tipoDocumentoDescricao,
            raw: custo.raw,
            active: custo.active,
            deactivatedAt: custo.active ? null : undefined,
            deactivationReason: custo.active ? null : undefined,
            reconciliationId: custo.active ? null : undefined,
            syncedAt: now,
          },
        });
      }
    });

    return {
      ok: true,
      received: rawRows.length,
      upserted: custos.length,
      skipped: Math.max(0, rawRows.length - custos.length),
    };
  }

  async reconcilePlanAccountCostReparcelments(body: unknown) {
    const reconciliation = normalizePlanAccountReparcelmentReconciliation(body);
    const chunks: string[][] = [];

    for (
      let index = 0;
      index < reconciliation.idLancamentos.length;
      index += 1_000
    ) {
      chunks.push(reconciliation.idLancamentos.slice(index, index + 1_000));
    }

    const summarizeRows = (
      rows: Array<{
        id: string;
        idLancamento: string;
        active: boolean;
        valorCusto: Prisma.Decimal;
      }>,
    ) => {
      const foundIds = new Set(rows.map((row) => row.idLancamento));
      const activeRows = rows.filter((row) => row.active);
      const totalValue = activeRows.reduce(
        (sum, row) => sum.add(row.valorCusto),
        new Prisma.Decimal(0),
      );
      const notFoundIds = reconciliation.idLancamentos.filter(
        (id) => !foundIds.has(id),
      );

      return {
        rows,
        activeRows,
        requestedCount: reconciliation.idLancamentos.length,
        foundCount: rows.length,
        activeCount: activeRows.length,
        alreadyInactiveCount: rows.length - activeRows.length,
        notFoundCount: notFoundIds.length,
        notFoundIdsSample: notFoundIds.slice(0, 100),
        totalActiveValue: Number(totalValue.toFixed(2)),
      };
    };

    const loadRows = async (
      client: Pick<PrismaService, 'aethosPlanoContaCost'>,
    ) => {
      const rows: Array<{
        id: string;
        idLancamento: string;
        active: boolean;
        valorCusto: Prisma.Decimal;
      }> = [];

      for (const idChunk of chunks) {
        rows.push(
          ...(await client.aethosPlanoContaCost.findMany({
            where: {
              origem: PLAN_ACCOUNT_REPARCELMENT_ORIGIN,
              idLancamento: { in: idChunk },
            },
            select: {
              id: true,
              idLancamento: true,
              active: true,
              valorCusto: true,
            },
          })),
        );
      }

      return rows;
    };

    const responseFromAudit = (audit: {
      reconciliationId: string;
      requestedCount: number;
      foundCount: number;
      deactivatedCount: number;
      alreadyInactiveCount: number;
      notFoundCount: number;
      totalValue: Prisma.Decimal;
      executedAt: Date;
    }) => ({
      ok: true,
      executed: true,
      replayed: true,
      reconciliationId: audit.reconciliationId,
      origin: PLAN_ACCOUNT_REPARCELMENT_ORIGIN,
      rule: PLAN_ACCOUNT_REPARCELMENT_RULE,
      requestedCount: audit.requestedCount,
      foundCount: audit.foundCount,
      deactivatedCount: audit.deactivatedCount,
      alreadyInactiveCount: audit.alreadyInactiveCount,
      notFoundCount: audit.notFoundCount,
      totalDeactivatedValue: Number(audit.totalValue.toFixed(2)),
      executedAt: audit.executedAt.toISOString(),
    });

    const previous =
      await this.prisma.aethosPlanoContaCostReconciliation.findUnique({
        where: { reconciliationId: reconciliation.reconciliationId },
      });
    if (previous) {
      if (previous.payloadHash !== reconciliation.payloadHash) {
        throw new BadRequestException(
          'reconciliationId ja utilizado com outro conjunto de ids',
        );
      }
      return responseFromAudit(previous);
    }

    if (!reconciliation.execute) {
      const summary = summarizeRows(await loadRows(this.prisma));
      return {
        ok: true,
        executed: false,
        reconciliationId: reconciliation.reconciliationId,
        origin: PLAN_ACCOUNT_REPARCELMENT_ORIGIN,
        rule: PLAN_ACCOUNT_REPARCELMENT_RULE,
        requestedCount: summary.requestedCount,
        foundCount: summary.foundCount,
        wouldDeactivateCount: summary.activeCount,
        alreadyInactiveCount: summary.alreadyInactiveCount,
        notFoundCount: summary.notFoundCount,
        notFoundIdsSample: summary.notFoundIdsSample,
        totalWouldDeactivateValue: summary.totalActiveValue,
        nextStep:
          'Repita o mesmo payload com execute=true para desativar os titulos-pai.',
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const concurrentAudit =
        await tx.aethosPlanoContaCostReconciliation.findUnique({
          where: { reconciliationId: reconciliation.reconciliationId },
        });
      if (concurrentAudit) {
        if (concurrentAudit.payloadHash !== reconciliation.payloadHash) {
          throw new BadRequestException(
            'reconciliationId ja utilizado com outro conjunto de ids',
          );
        }
        return responseFromAudit(concurrentAudit);
      }

      const summary = summarizeRows(await loadRows(tx as never));
      let deactivatedCount = 0;

      for (let index = 0; index < summary.activeRows.length; index += 1_000) {
        const ids = summary.activeRows
          .slice(index, index + 1_000)
          .map((row) => row.id);
        if (!ids.length) continue;

        const updateResult = await tx.aethosPlanoContaCost.updateMany({
          where: { id: { in: ids }, active: true },
          data: {
            active: false,
            deactivatedAt: new Date(),
            deactivationReason: PLAN_ACCOUNT_REPARCELMENT_RULE,
            reconciliationId: reconciliation.reconciliationId,
          },
        });
        deactivatedCount += updateResult.count;
      }

      const audit = await tx.aethosPlanoContaCostReconciliation.create({
        data: {
          reconciliationId: reconciliation.reconciliationId,
          payloadHash: reconciliation.payloadHash,
          origin: PLAN_ACCOUNT_REPARCELMENT_ORIGIN,
          rule: PLAN_ACCOUNT_REPARCELMENT_RULE,
          requestedCount: summary.requestedCount,
          foundCount: summary.foundCount,
          deactivatedCount,
          alreadyInactiveCount: summary.alreadyInactiveCount,
          notFoundCount: summary.notFoundCount,
          totalValue: new Prisma.Decimal(summary.totalActiveValue),
          idLancamentos: reconciliation.idLancamentos as Prisma.InputJsonValue,
          ...(reconciliation.metadata
            ? { metadata: reconciliation.metadata }
            : {}),
        },
      });

      return {
        ...responseFromAudit(audit),
        replayed: false,
        notFoundIdsSample: summary.notFoundIdsSample,
      };
    });
  }

  async syncContracts(body: unknown) {
    const rawRows = listFromBody(body, [
      'contratos',
      'contracts',
      'rows',
      'data',
    ]);
    const contracts = normalizeContracts(body);

    if (!contracts.length) {
      throw new BadRequestException('Nenhum contrato valido recebido');
    }

    const payload =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as AnyRow)
        : {};
    const syncMode = normalizeText(payload.syncMode).toLowerCase() || 'batch';
    const syncRunId = normalizeText(payload.syncRunId) || null;
    const isLastBatch = normalizeBoolean(payload.isLastBatch, false);

    if (syncMode === 'full' && !syncRunId) {
      throw new BadRequestException(
        'syncRunId e obrigatorio quando syncMode for full',
      );
    }

    const uniqueContractIds = new Set(contracts.map((item) => item.aethosId));
    if (uniqueContractIds.size !== contracts.length) {
      throw new BadRequestException(
        'A carga contem contratos duplicados por idContratoAethos',
      );
    }

    const allAttachmentIds = contracts.flatMap((contract) =>
      contract.attachments.map((attachment) => attachment.aethosId),
    );
    if (new Set(allAttachmentIds).size !== allAttachmentIds.length) {
      throw new BadRequestException(
        'A carga contem anexos duplicados por idAnexoAethos',
      );
    }

    const now = new Date();
    const staleFileKeys: string[] = [];
    let attachmentsUpserted = 0;
    let attachmentsDeactivated = 0;
    let contractsDeactivated = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const contract of contracts) {
          const savedContract = await tx.aethosContract.upsert({
            where: { aethosId: contract.aethosId },
            create: {
              aethosId: contract.aethosId,
              quotationAethosId: contract.quotationAethosId,
              companyAethosId: contract.companyAethosId,
              workAethosId: contract.workAethosId,
              workName: contract.workName,
              contractorAethosId: contract.contractorAethosId,
              contractorName: contract.contractorName,
              registeredAt: contract.registeredAt,
              startDate: contract.startDate,
              endDate: contract.endDate,
              finalizedAt: contract.finalizedAt,
              contractedAt: contract.contractedAt,
              lastContractedAt: contract.lastContractedAt,
              contractedByUser: contract.contractedByUser,
              originalValue: contract.originalValue,
              statusCode: contract.statusCode,
              statusDescription: contract.statusDescription,
              notes: contract.notes,
              engineerAethosId: contract.engineerAethosId,
              engineerName: contract.engineerName,
              retentionValue: contract.retentionValue,
              anticipatedRetentionValue: contract.anticipatedRetentionValue,
              retentionBalance: contract.retentionBalance,
              totalMeasuredValue: contract.totalMeasuredValue,
              payableBalance: contract.payableBalance,
              measurementBalance: contract.measurementBalance,
              contractBalance: contract.contractBalance,
              contractQuantity: contract.contractQuantity,
              movesFinancial: contract.movesFinancial,
              returnsWorkBalance: contract.returnsWorkBalance,
              accountPlanAethosId: contract.accountPlanAethosId,
              accountPlanName: contract.accountPlanName,
              cancellationReason: contract.cancellationReason,
              generatedAttachments:
                contract.generatedAttachments ?? Prisma.JsonNull,
              source: contract.source,
              contentHash: contract.contentHash,
              lastSeenSyncId: syncRunId,
              raw: contract.raw,
              active: contract.active,
              syncedAt: now,
            },
            update: {
              quotationAethosId: contract.quotationAethosId,
              companyAethosId: contract.companyAethosId,
              workAethosId: contract.workAethosId,
              workName: contract.workName,
              contractorAethosId: contract.contractorAethosId,
              contractorName: contract.contractorName,
              registeredAt: contract.registeredAt,
              startDate: contract.startDate,
              endDate: contract.endDate,
              finalizedAt: contract.finalizedAt,
              contractedAt: contract.contractedAt,
              lastContractedAt: contract.lastContractedAt,
              contractedByUser: contract.contractedByUser,
              originalValue: contract.originalValue,
              statusCode: contract.statusCode,
              statusDescription: contract.statusDescription,
              notes: contract.notes,
              engineerAethosId: contract.engineerAethosId,
              engineerName: contract.engineerName,
              retentionValue: contract.retentionValue,
              anticipatedRetentionValue: contract.anticipatedRetentionValue,
              retentionBalance: contract.retentionBalance,
              totalMeasuredValue: contract.totalMeasuredValue,
              payableBalance: contract.payableBalance,
              measurementBalance: contract.measurementBalance,
              contractBalance: contract.contractBalance,
              contractQuantity: contract.contractQuantity,
              movesFinancial: contract.movesFinancial,
              returnsWorkBalance: contract.returnsWorkBalance,
              accountPlanAethosId: contract.accountPlanAethosId,
              accountPlanName: contract.accountPlanName,
              cancellationReason: contract.cancellationReason,
              ...(contract.generatedAttachments
                ? { generatedAttachments: contract.generatedAttachments }
                : {}),
              source: contract.source,
              contentHash: contract.contentHash,
              lastSeenSyncId: syncRunId,
              raw: contract.raw,
              active: contract.active,
              syncedAt: now,
            },
            select: { id: true },
          });

          for (const attachment of contract.attachments) {
            const previous = await tx.aethosContractAttachment.findUnique({
              where: { aethosId: attachment.aethosId },
              select: { md5: true, fileKey: true },
            });
            const contentChanged = Boolean(
              previous?.fileKey && previous.md5 !== attachment.md5,
            );

            await tx.aethosContractAttachment.upsert({
              where: { aethosId: attachment.aethosId },
              create: {
                aethosId: attachment.aethosId,
                contractId: savedContract.id,
                documentAethosId: attachment.documentAethosId,
                documentTypeAethos: attachment.documentTypeAethos,
                fileName: attachment.fileName,
                description: attachment.description,
                extension: attachment.extension,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                md5: attachment.md5,
                includedAt: attachment.includedAt,
                storageType: attachment.storageType,
                sourceReference: attachment.sourceReference,
                source: contract.source,
                raw: attachment.raw,
                active: attachment.active,
                syncedAt: now,
              },
              update: {
                contractId: savedContract.id,
                documentAethosId: attachment.documentAethosId,
                documentTypeAethos: attachment.documentTypeAethos,
                fileName: attachment.fileName,
                description: attachment.description,
                extension: attachment.extension,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                md5: attachment.md5,
                includedAt: attachment.includedAt,
                storageType: attachment.storageType,
                sourceReference: attachment.sourceReference,
                source: contract.source,
                raw: attachment.raw,
                active: attachment.active,
                syncedAt: now,
                ...(contentChanged
                  ? {
                      fileKey: null,
                      fileUrl: null,
                      fileReceivedAt: null,
                    }
                  : {}),
              },
            });

            if (contentChanged && previous?.fileKey) {
              staleFileKeys.push(previous.fileKey);
            }
            attachmentsUpserted += 1;
          }

          const currentAttachmentIds = contract.attachments.map(
            (attachment) => attachment.aethosId,
          );
          const deactivated = await tx.aethosContractAttachment.updateMany({
            where: {
              contractId: savedContract.id,
              active: true,
              ...(currentAttachmentIds.length
                ? { aethosId: { notIn: currentAttachmentIds } }
                : {}),
            },
            data: { active: false, syncedAt: now },
          });
          attachmentsDeactivated += deactivated.count;
        }

        if (syncMode === 'full' && isLastBatch && syncRunId) {
          const deactivated = await tx.aethosContract.updateMany({
            where: {
              active: true,
              OR: [
                { lastSeenSyncId: null },
                { lastSeenSyncId: { not: syncRunId } },
              ],
            },
            data: { active: false, syncedAt: now },
          });
          contractsDeactivated = deactivated.count;

          await tx.aethosContractAttachment.updateMany({
            where: { active: true, contract: { active: false } },
            data: { active: false, syncedAt: now },
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );

    for (const fileKey of staleFileKeys) {
      await this.s3UploadService.deleteFile(fileKey);
    }

    const filesNeeded = allAttachmentIds.length
      ? await this.prisma.aethosContractAttachment.findMany({
          where: {
            aethosId: { in: allAttachmentIds },
            active: true,
            fileKey: null,
          },
          select: { aethosId: true, md5: true },
          orderBy: { aethosId: 'asc' },
        })
      : [];

    return {
      ok: true,
      received: rawRows.length,
      upserted: contracts.length,
      skipped: Math.max(0, rawRows.length - contracts.length),
      attachmentsUpserted,
      attachmentsDeactivated,
      contractsDeactivated,
      syncRunId,
      finalized: syncMode === 'full' && isLastBatch,
      filesNeeded,
    };
  }

  async uploadContractAttachmentFile(
    idAnexoAethos: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    const aethosId = normalizeText(idAnexoAethos);
    if (!aethosId) {
      throw new BadRequestException('idAnexoAethos invalido');
    }

    const attachment = await this.prisma.aethosContractAttachment.findUnique({
      where: { aethosId },
    });
    if (!attachment || !attachment.active) {
      throw new NotFoundException('Anexo de contrato nao encontrado');
    }

    const allowedExtensions = new Set([
      'pdf',
      'jpeg',
      'jpg',
      'png',
      'xlsx',
      'docx',
    ]);
    const extension = (
      attachment.extension ||
      attachment.fileName.split('.').pop() ||
      ''
    )
      .trim()
      .replace(/^\./, '')
      .toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException('Tipo de anexo de contrato nao permitido');
    }

    const actualMd5 = createHash('md5').update(file.buffer).digest('hex');
    const expectedMd5 = normalizeMd5(attachment.md5);
    if (expectedMd5 && expectedMd5.length === 32 && expectedMd5 !== actualMd5) {
      throw new BadRequestException(
        'O arquivo recebido nao corresponde ao MD5 informado pelo Aethos',
      );
    }

    if (attachment.fileKey && expectedMd5 === actualMd5) {
      return {
        ok: true,
        idAnexoAethos: aethosId,
        md5: actualMd5,
        alreadyStored: true,
      };
    }

    const upload = await this.s3UploadService.uploadFile(
      {
        buffer: file.buffer,
        mimetype:
          attachment.mimeType || file.mimetype || 'application/octet-stream',
        originalname: attachment.fileName,
      },
      'aethos-contract',
    );
    const previousFileKey = attachment.fileKey;

    await this.prisma.aethosContractAttachment.update({
      where: { aethosId },
      data: {
        fileKey: upload.key,
        fileUrl: upload.url,
        fileReceivedAt: new Date(),
        md5: actualMd5,
        sizeBytes: file.buffer.length,
      },
    });

    if (previousFileKey && previousFileKey !== upload.key) {
      await this.s3UploadService.deleteFile(previousFileKey);
    }

    return {
      ok: true,
      idAnexoAethos: aethosId,
      md5: actualMd5,
      sizeBytes: file.buffer.length,
      alreadyStored: false,
    };
  }
}
