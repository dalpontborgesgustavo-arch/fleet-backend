import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const STATE_ID = 'default';
const READ_ROLES = new Set([
  'engenharia',
  'gestor',
  'ceo',
  'admin',
  'consultor',
  'administrativo',
  'juridico',
]);
const WRITE_ROLES = new Set(['engenharia', 'gestor', 'ceo', 'admin']);
const LIMITED_CADASTRAL_WRITE_ROLES = new Set(['administrativo', 'juridico']);
const SCHEDULE_REOPEN_ROLES = new Set(['engenharia', 'admin']);
const ADDITIVE_AUTHORIZATION_REQUEST_ROLES = new Set([
  'engenharia',
  'gestor',
  'ceo',
]);
const ADDITIVE_AUTHORIZATION_ACTIONS = new Set(['EDIT', 'DELETE']);
const CONSTRUCTION_WORK_STATUS = new Set([
  'Em andamento',
  'Entregue',
  'Paralisada',
]);
const CONSTRUCTION_YES_NO = new Set(['Sim', 'Nao']);

const AUDIT_COLLECTIONS = [
  { key: 'works', origin: 'Dados Cadastrais', entity: 'Obra' },
  { key: 'stages', origin: 'Cronograma da Obra', entity: 'Etapa' },
  { key: 'measurements', origin: 'Medicoes', entity: 'Medicao' },
  { key: 'additives', origin: 'Aditivos', entity: 'Aditivo' },
  { key: 'arts', origin: 'ART', entity: 'ART' },
  { key: 'engineers', origin: 'Engenheiros', entity: 'Engenheiro' },
  { key: 'quality', origin: 'Qualidade', entity: 'Requisito de qualidade' },
  { key: 'requirements', origin: 'Requisitos', entity: 'Requisitos da obra' },
  { key: 'production', origin: 'Producao', entity: 'Producao mensal' },
  {
    key: 'scheduleControls',
    origin: 'Cronograma da Obra',
    entity: 'Controle do cronograma',
  },
  {
    key: 'scheduleVersions',
    origin: 'Cronograma da Obra',
    entity: 'Versao do cronograma',
  },
  {
    key: 'additiveAuthorizations',
    origin: 'Aditivos',
    entity: 'Autorizacao de aditivo',
  },
] as const;

const AUDIT_FIELD_LABELS: Record<string, string> = {
  apelido: 'Apelido',
  nome: 'Descricao',
  codigoObra: 'Codigo da obra',
  cliente: 'Cliente',
  contrato: 'Contrato',
  statusObra: 'Status da obra',
  engenheiro: 'Engenheiro',
  gerente: 'Gerente',
  valorInicialContrato: 'Valor inicial do contrato',
  bdiPrevisto: 'BDI previsto',
  dataEntrega: 'Data de entrega',
  dataEntregaFixa: 'Data de entrega fixa',
  cno: 'CNO',
  cnoBaixada: 'Baixa da CNO',
  termoDefinitivoFinalizado: 'Termo definitivo',
  observacao: 'Observacao',
  descricao: 'Descricao',
  valorTotal: 'Valor total',
  valorContratadoTotal: 'Valor contratado total',
  dataInicio: 'Data inicial',
  dataFim: 'Data final',
  mesesMedicao: 'Planejamento mensal',
  metasMedicao: 'Metas de medicao',
  status: 'Status',
  possui: 'Possui',
  numero: 'Numero',
  valor: 'Valor',
  percentual: 'Percentual',
  producaoMes: 'Producao do mes',
  reason: 'Motivo',
  action: 'Acao',
};

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function normalizePersonName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isMariaEduarda(value?: string | null) {
  const normalized = normalizePersonName(value);
  return (
    normalized === 'maria eduarda' || normalized.startsWith('maria eduarda ')
  );
}

function ensureScheduleReleaseAccess(
  role?: string | null,
  actorName?: string | null,
) {
  if (normalizeRole(role) !== 'admin' && !isMariaEduarda(actorName)) {
    throw new ForbiddenException(
      'Somente Maria Eduarda pode liberar o cronograma para ajuste',
    );
  }
}

function ensureScheduleReopenAccess(role?: string | null) {
  if (!SCHEDULE_REOPEN_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Somente Engenharia pode reabrir o cronograma',
    );
  }
}

function ensureReadAccess(role?: string | null) {
  if (!READ_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para acessar Controle de Obras',
    );
  }
}

function ensureWriteAccess(role?: string | null) {
  if (!WRITE_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para alterar Controle de Obras',
    );
  }
}

function ensureAuditAccess(role?: string | null) {
  if (normalizeRole(role) !== 'admin') {
    throw new ForbiddenException(
      'Somente o administrador pode consultar o historico de alteracoes',
    );
  }
}

function stableAuditValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableAuditValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((result, key) => {
        result[key] = stableAuditValue(value[key]);
        return result;
      }, {});
  }
  return value ?? null;
}

function auditValuesEqual(left: any, right: any) {
  return (
    JSON.stringify(stableAuditValue(left)) ===
    JSON.stringify(stableAuditValue(right))
  );
}

function auditValueText(value: any) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const serialized = JSON.stringify(stableAuditValue(value));
  return serialized.length > 2000
    ? `${serialized.slice(0, 1997)}...`
    : serialized;
}

function auditItemKey(item: any, index: number) {
  return String(item?.id || item?.workId || `indice-${index}`);
}

function auditItemLabel(item: any, entity: string) {
  const label =
    item?.codigoObra ||
    item?.apelido ||
    item?.nome ||
    item?.descricao ||
    item?.numero ||
    item?.competencia ||
    item?.id ||
    item?.workId;
  return label ? `${entity} ${String(label)}` : entity;
}

function workSnapshot(state: any, workId: string) {
  const work = (Array.isArray(state?.works) ? state.works : []).find(
    (item: any) => String(item?.id || '') === workId,
  );
  return {
    obraCodigo: String(work?.codigoObra || ''),
    obraNome: String(work?.apelido || work?.nome || ''),
  };
}

function buildAutomaticAuditEvents(
  currentState: any,
  nextState: any,
  actor: {
    name: string;
    id: string;
    email: string;
    role: string;
  },
) {
  const now = new Date().toISOString();
  const events: any[] = [];

  for (const definition of AUDIT_COLLECTIONS) {
    const currentItems = Array.isArray(currentState?.[definition.key])
      ? currentState[definition.key]
      : [];
    const nextItems = Array.isArray(nextState?.[definition.key])
      ? nextState[definition.key]
      : [];
    const currentMap = new Map(
      currentItems.map((item: any, index: number) => [
        auditItemKey(item, index),
        item,
      ]),
    );
    const nextMap = new Map(
      nextItems.map((item: any, index: number) => [
        auditItemKey(item, index),
        item,
      ]),
    );
    const keys = new Set([...currentMap.keys(), ...nextMap.keys()]);

    for (const key of keys) {
      const previous = currentMap.get(key) as any;
      const next = nextMap.get(key) as any;
      const workId = String(
        next?.workId ||
          previous?.workId ||
          (definition.key === 'works' ? key : ''),
      );
      const snapshot = workSnapshot(nextState, workId);
      const preservedSnapshot =
        snapshot.obraCodigo || snapshot.obraNome
          ? snapshot
          : workSnapshot(currentState, workId);
      const base = {
        workId,
        usuario: actor.name,
        usuarioId: actor.id || undefined,
        usuarioEmail: actor.email || undefined,
        perfil: actor.role || undefined,
        dataHora: now,
        origem: definition.origin,
        ...preservedSnapshot,
      };

      if (!previous && next) {
        const label = auditItemLabel(next, definition.entity);
        events.push({
          id: randomUUID(),
          ...base,
          referencia: definition.entity,
          valorAntigo: '',
          valorNovo: label,
          detalhe: `${label} incluido`,
        });
        continue;
      }

      if (previous && !next) {
        const label = auditItemLabel(previous, definition.entity);
        events.push({
          id: randomUUID(),
          ...base,
          referencia: definition.entity,
          valorAntigo: label,
          valorNovo: '',
          detalhe: `${label} excluido`,
        });
        continue;
      }

      if (!previous || !next) continue;
      const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);
      fields.delete('id');
      fields.delete('workId');

      for (const field of fields) {
        if (auditValuesEqual(previous[field], next[field])) continue;
        const fieldLabel = AUDIT_FIELD_LABELS[field] || field;
        events.push({
          id: randomUUID(),
          ...base,
          referencia: fieldLabel,
          valorAntigo: auditValueText(previous[field]),
          valorNovo: auditValueText(next[field]),
          detalhe: `${fieldLabel} alterado em ${auditItemLabel(next, definition.entity)}`,
        });
      }
    }
  }

  return events;
}

function saoPauloDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ensureLimitedCadastralWriteAccess(role?: string | null) {
  if (!LIMITED_CADASTRAL_WRITE_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para alterar os dados administrativos da obra',
    );
  }
}

function validateLimitedCadastralFields(data: any) {
  const statusObra = String(data?.statusObra || '').trim();
  const termoDefinitivoFinalizado = String(
    data?.termoDefinitivoFinalizado || '',
  ).trim();
  const cnoBaixada = String(data?.cnoBaixada || '').trim();

  if (!CONSTRUCTION_WORK_STATUS.has(statusObra)) {
    throw new BadRequestException('Status da obra invalido');
  }
  if (!CONSTRUCTION_YES_NO.has(termoDefinitivoFinalizado)) {
    throw new BadRequestException('Recebimento do termo definitivo invalido');
  }
  if (!CONSTRUCTION_YES_NO.has(cnoBaixada)) {
    throw new BadRequestException('Baixa da CNO invalida');
  }
  if (cnoBaixada === 'Sim' && statusObra !== 'Entregue') {
    throw new BadRequestException(
      'A CNO so pode ser baixada quando a obra estiver entregue',
    );
  }

  return { statusObra, termoDefinitivoFinalizado, cnoBaixada };
}

function assertStatePayload(data: any) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BadRequestException('Estado do Controle de Obras invalido');
  }

  if (!Array.isArray(data.works)) {
    throw new BadRequestException('Lista de obras invalida');
  }

  const invalidCode = data.works.some((work: any) => {
    const code = String(work?.codigoObra || '');
    return code && !/^\d+$/.test(code);
  });

  if (invalidCode) {
    throw new BadRequestException('Codigo da obra deve conter somente numeros');
  }

  const invalidCnoClosure = data.works.some(
    (work: any) =>
      work?.cnoBaixada === 'Sim' && work?.statusObra !== 'Entregue',
  );

  if (invalidCnoClosure) {
    throw new BadRequestException(
      'A CNO so pode ser baixada quando a obra estiver entregue',
    );
  }
}

function normalizeAethosCode(code?: string | null) {
  return String(code || '').replace(/\D/g, '');
}

function stageScheduleFingerprint(stage: any) {
  return {
    id: String(stage?.id || ''),
    workId: String(stage?.workId || ''),
    descricao: String(stage?.descricao || ''),
    valorTotal: Number(stage?.valorTotal || stage?.valorContratadoTotal || 0),
    possui: stage?.possui === 'Nao' ? 'Nao' : 'Sim',
    dataInicio: String(stage?.dataInicio || ''),
    dataFim: String(stage?.dataFim || ''),
    mesesMedicao: (Array.isArray(stage?.mesesMedicao) ? stage.mesesMedicao : [])
      .map((month: any) => ({
        id: String(month?.id || ''),
        mes: Number(month?.mes || 0),
        percentual: Number(month?.percentual || 0),
        valor: Number(month?.valor || 0),
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
    metasMedicao: (Array.isArray(stage?.metasMedicao) ? stage.metasMedicao : [])
      .map((goal: any) => ({
        id: String(goal?.id || ''),
        dataInicio: String(goal?.dataInicio || goal?.dataMeta || ''),
        dataFim: String(goal?.dataFim || ''),
        valorMeta: Number(goal?.valorMeta || 0),
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  };
}

function workScheduleFingerprint(data: any, workId: string) {
  return JSON.stringify(
    (Array.isArray(data?.stages) ? data.stages : [])
      .filter((stage: any) => stage?.workId === workId)
      .map(stageScheduleFingerprint)
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  );
}

function scheduleControlForWork(data: any, workId: string) {
  return (
    Array.isArray(data?.scheduleControls) ? data.scheduleControls : []
  ).find((item: any) => item?.workId === workId);
}

function additiveFingerprint(additive: any) {
  return JSON.stringify({
    id: String(additive?.id || ''),
    workId: String(additive?.workId || ''),
    tipo: String(additive?.tipo || ''),
    subtipo: String(additive?.subtipo || ''),
    valor: Number(additive?.valor || 0),
    dataLancamento: String(additive?.dataLancamento || ''),
    dataAditivoPrazo: String(additive?.dataAditivoPrazo || ''),
    dataDocumento: String(additive?.dataDocumento || ''),
    etapa: String(additive?.etapa || ''),
    numeroAditivo: String(additive?.numeroAditivo || ''),
    prateleira: String(additive?.prateleira || ''),
    aplicacao: String(additive?.aplicacao || ''),
    calculoPrazo: String(additive?.calculoPrazo || ''),
    prazoDias: Number(additive?.prazoDias || 0),
    dataEventoPrazo: String(additive?.dataEventoPrazo || ''),
    dataEntregaAnterior: String(additive?.dataEntregaAnterior || ''),
    paralisacaoId: String(additive?.paralisacaoId || ''),
  });
}

function additiveChanges(currentData: any, nextData: any) {
  const current = new Map(
    (Array.isArray(currentData?.additives) ? currentData.additives : []).map(
      (item: any) => [String(item?.id || ''), item],
    ),
  );
  const next = new Map(
    (Array.isArray(nextData?.additives) ? nextData.additives : []).map(
      (item: any) => [String(item?.id || ''), item],
    ),
  );
  const changes: { additiveId: string; action: 'EDIT' | 'DELETE' }[] = [];

  current.forEach((item: any, additiveId: string) => {
    const nextItem = next.get(additiveId);
    if (!nextItem) {
      changes.push({ additiveId, action: 'DELETE' });
      return;
    }
    if (additiveFingerprint(item) !== additiveFingerprint(nextItem)) {
      changes.push({ additiveId, action: 'EDIT' });
    }
  });

  return changes;
}

function ensureAdditiveAuthorizationRequestAccess(role?: string | null) {
  if (!ADDITIVE_AUTHORIZATION_REQUEST_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para solicitar alteracao ou exclusao de aditivo',
    );
  }
}

function ensureAdditiveAuthorizationDecisionAccess(role?: string | null) {
  if (normalizeRole(role) !== 'admin') {
    throw new ForbiddenException(
      'Somente o administrador pode autorizar alteracao ou exclusao de aditivo',
    );
  }
}

function filterWorkState(data: any, workId: string) {
  const nextActiveId =
    data.activeWorkId === workId
      ? data.works.find((work: any) => work?.id !== workId)?.id || ''
      : data.activeWorkId;

  return {
    ...data,
    activeWorkId: nextActiveId,
    works: (data.works || []).filter((work: any) => work?.id !== workId),
    stages: (data.stages || []).filter((item: any) => item?.workId !== workId),
    measurements: (data.measurements || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    additives: (data.additives || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    arts: (data.arts || []).filter((item: any) => item?.workId !== workId),
    quality: (data.quality || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    requirements: (data.requirements || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    production: (data.production || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    audit: Array.isArray(data.audit) ? data.audit : [],
    scheduleControls: (data.scheduleControls || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    scheduleVersions: (data.scheduleVersions || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    additiveAuthorizations: (data.additiveAuthorizations || []).filter(
      (item: any) => item?.workId !== workId,
    ),
  };
}

@Injectable()
export class ConstructionControlService {
  constructor(private readonly prisma: PrismaService) {}

  async findState(role?: string | null) {
    ensureReadAccess(role);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });

    return row?.data ?? null;
  }

  async findAudit(role?: string | null, limitInput?: string | number | null) {
    ensureAuditAccess(role);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    const state =
      row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as any)
        : null;
    const works = Array.isArray(state?.works) ? state.works : [];
    const workMap = new Map(
      works.map((work: any) => [String(work?.id || ''), work]),
    );
    const rawEvents = Array.isArray(state?.audit) ? state.audit : [];
    const normalizedEvents = rawEvents
      .map((event: any) => {
        const timestamp = String(event?.dataHora || '');
        const work = workMap.get(String(event?.workId || '')) as any;
        return {
          id: String(event?.id || randomUUID()),
          workId: String(event?.workId || ''),
          workCode: String(event?.obraCodigo || work?.codigoObra || ''),
          workName: String(
            event?.obraNome || work?.apelido || work?.nome || '',
          ),
          origin: String(event?.origem || 'Controle de Obras'),
          reference: String(event?.referencia || ''),
          oldValue: String(event?.valorAntigo || ''),
          newValue: String(event?.valorNovo || ''),
          user: String(event?.usuario || 'Sistema'),
          userId: String(event?.usuarioId || ''),
          userEmail: String(event?.usuarioEmail || ''),
          role: String(event?.perfil || ''),
          timestamp,
          detail: String(event?.detalhe || ''),
          timestampMs: Number.isFinite(Date.parse(timestamp))
            ? Date.parse(timestamp)
            : 0,
        };
      })
      .sort((left: any, right: any) => right.timestampMs - left.timestampMs);

    const now = new Date();
    const nowMs = now.getTime();
    const todayKey = saoPauloDateKey(now);
    const last7Cutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
    const last30Cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
    const last30Events = normalizedEvents.filter(
      (event: any) => event.timestampMs >= last30Cutoff,
    );
    const editorMap = new Map<
      string,
      { user: string; email: string; count: number; lastChangeAt: string }
    >();
    for (const event of last30Events) {
      const key = String(event.userEmail || event.user).toLowerCase();
      const current = editorMap.get(key);
      editorMap.set(key, {
        user: event.user,
        email: event.userEmail,
        count: (current?.count || 0) + 1,
        lastChangeAt: current?.lastChangeAt || event.timestamp,
      });
    }
    const parsedLimit = Number(limitInput);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(500, Math.max(10, Math.trunc(parsedLimit)))
      : 200;

    return {
      summary: {
        totalChanges: normalizedEvents.length,
        todayChanges: normalizedEvents.filter(
          (event: any) =>
            event.timestampMs > 0 &&
            saoPauloDateKey(new Date(event.timestampMs)) === todayKey,
        ).length,
        last7DaysChanges: normalizedEvents.filter(
          (event: any) => event.timestampMs >= last7Cutoff,
        ).length,
        activeEditors30Days: editorMap.size,
        lastChangeAt: normalizedEvents[0]?.timestamp || null,
        lastChangedBy: normalizedEvents[0]?.user || null,
      },
      editors: Array.from(editorMap.values()).sort(
        (left, right) => right.count - left.count,
      ),
      events: normalizedEvents
        .slice(0, limit)
        .map(({ timestampMs, ...event }) => event),
    };
  }

  async findAethosObraByCode(code: string, role?: string | null) {
    ensureReadAccess(role);
    const normalizedCode = normalizeAethosCode(code);

    if (!normalizedCode) {
      throw new BadRequestException('Codigo da obra invalido');
    }

    const obra = await this.prisma.aethosObra.findUnique({
      where: { code: normalizedCode },
      select: {
        code: true,
        name: true,
        clientName: true,
      },
    });

    if (!obra) return null;

    return {
      code: obra.code,
      name: obra.name,
      cliente: obra.clientName,
    };
  }

  async findAethosObraCostsByCode(code: string, role?: string | null) {
    ensureReadAccess(role);
    const normalizedCode = normalizeAethosCode(code);

    if (!normalizedCode) {
      throw new BadRequestException('Codigo da obra invalido');
    }

    const rows = await this.prisma.aethosObraCusto.findMany({
      where: {
        code: normalizedCode,
        active: true,
      },
      orderBy: [{ competencia: 'asc' }, { origem: 'asc' }],
      select: {
        code: true,
        name: true,
        competencia: true,
        custoTotal: true,
        origem: true,
        syncedAt: true,
      },
    });

    const monthly = new Map<
      string,
      {
        competencia: string;
        custoTotal: number;
        origens: Set<string>;
        syncedAt: Date | null;
      }
    >();

    rows.forEach((row) => {
      const competencia = String(row.competencia || '')
        .trim()
        .replace(/\s+/g, '');
      if (!/^\d{4}-\d{2}$/.test(competencia)) return;

      const current =
        monthly.get(competencia) ||
        ({
          competencia,
          custoTotal: 0,
          origens: new Set<string>(),
          syncedAt: null,
        } satisfies {
          competencia: string;
          custoTotal: number;
          origens: Set<string>;
          syncedAt: Date | null;
        });

      current.custoTotal += Number(
        row.custoTotal?.toString?.() ?? row.custoTotal ?? 0,
      );
      if (row.origem) current.origens.add(row.origem);
      if (!current.syncedAt || row.syncedAt > current.syncedAt)
        current.syncedAt = row.syncedAt;
      monthly.set(competencia, current);
    });

    const normalizedRows = Array.from(monthly.values())
      .sort((a, b) => a.competencia.localeCompare(b.competencia))
      .map((row) => ({
        competencia: row.competencia,
        custoTotal: Math.round(row.custoTotal * 100) / 100,
        origem: Array.from(row.origens).join(', ') || 'AETHOS',
        syncedAt: row.syncedAt?.toISOString() || null,
      }));

    return {
      code: normalizedCode,
      name: rows.find((row) => row.name)?.name || null,
      totalCusto:
        Math.round(
          normalizedRows.reduce((sum, row) => sum + row.custoTotal, 0) * 100,
        ) / 100,
      rows: normalizedRows,
    };
  }

  async saveState(
    data: any,
    role?: string | null,
    actorName?: string | null,
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureWriteAccess(role);
    assertStatePayload(data);

    const currentRow = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    const currentData =
      currentRow?.data &&
      typeof currentRow.data === 'object' &&
      !Array.isArray(currentRow.data)
        ? (currentRow.data as any)
        : null;

    if (currentData && normalizeRole(role) === 'engenharia') {
      for (const work of currentData.works || []) {
        const workId = String(work?.id || '');
        if (!workId) continue;
        const changed =
          workScheduleFingerprint(currentData, workId) !==
          workScheduleFingerprint(data, workId);
        if (
          changed &&
          scheduleControlForWork(currentData, workId)?.status !== 'OPEN'
        ) {
          throw new ForbiddenException(
            'O cronograma precisa ser liberado e reaberto antes do ajuste',
          );
        }
      }
    }

    let additiveAuthorizations = Array.isArray(
      currentData?.additiveAuthorizations,
    )
      ? [...currentData.additiveAuthorizations]
      : [];
    const changes = currentData ? additiveChanges(currentData, data) : [];
    if (changes.length && normalizeRole(role) !== 'admin') {
      const normalizedActorId = String(actorId || '').trim();
      const usedAt = new Date().toISOString();
      for (const change of changes) {
        const authorizationIndex = additiveAuthorizations.findIndex(
          (item: any) =>
            item?.additiveId === change.additiveId &&
            item?.action === change.action &&
            item?.status === 'APPROVED' &&
            item?.requestedByUserId === normalizedActorId,
        );
        if (authorizationIndex < 0) {
          throw new ForbiddenException(
            `A ${
              change.action === 'EDIT' ? 'alteracao' : 'exclusao'
            } deste aditivo precisa ser autorizada pelo administrador`,
          );
        }
        additiveAuthorizations[authorizationIndex] = {
          ...additiveAuthorizations[authorizationIndex],
          status: 'USED',
          usedAt,
          usedBy: String(actorName || actorId || 'Usuario').trim(),
        };
      }
    }

    const nextData = currentData
      ? {
          ...data,
          scheduleControls: Array.isArray(currentData.scheduleControls)
            ? currentData.scheduleControls
            : [],
          scheduleVersions: Array.isArray(currentData.scheduleVersions)
            ? currentData.scheduleVersions
            : [],
          additiveAuthorizations,
        }
      : {
          ...data,
          scheduleControls: [],
          scheduleVersions: [],
          additiveAuthorizations: [],
        };
    const actor = {
      name: String(actorName || actorEmail || actorId || 'Sistema').trim(),
      id: String(actorId || '').trim(),
      email: String(actorEmail || '').trim(),
      role: normalizeRole(role),
    };
    const trustedAudit = currentData
      ? Array.isArray(currentData.audit)
        ? currentData.audit
        : []
      : Array.isArray(data.audit)
        ? data.audit
        : [];
    nextData.audit = currentData
      ? [
          ...buildAutomaticAuditEvents(currentData, nextData, actor),
          ...trustedAudit,
        ]
      : trustedAudit;
    assertStatePayload(nextData);

    const row = await this.prisma.constructionControlState.upsert({
      where: { id: STATE_ID },
      create: {
        id: STATE_ID,
        data: nextData as Prisma.InputJsonValue,
      },
      update: {
        data: nextData as Prisma.InputJsonValue,
      },
    });

    return row.data;
  }

  async requestAdditiveAuthorization(
    additiveId: string,
    data: any,
    role?: string | null,
    actorId?: string | null,
    actorName?: string | null,
    actorEmail?: string | null,
  ) {
    ensureAdditiveAuthorizationRequestAccess(role);
    const action = String(data?.action || '')
      .trim()
      .toUpperCase();
    const reason = String(data?.reason || '').trim();
    if (!ADDITIVE_AUTHORIZATION_ACTIONS.has(action)) {
      throw new BadRequestException('Acao de autorizacao invalida');
    }
    if (reason.length < 5) {
      throw new BadRequestException('Informe o motivo da solicitacao');
    }

    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new NotFoundException('Cadastro de obras nao encontrado');
    }
    const state = row.data as any;
    assertStatePayload(state);
    const additive = (state.additives || []).find(
      (item: any) => item?.id === additiveId,
    );
    if (!additive) throw new NotFoundException('Aditivo nao encontrado');

    const actor = String(actorName || actorId || 'Usuario').trim();
    const authorizations = Array.isArray(state.additiveAuthorizations)
      ? state.additiveAuthorizations
      : [];
    const existing = authorizations.find(
      (item: any) =>
        item?.additiveId === additiveId &&
        item?.action === action &&
        item?.requestedByUserId === actorId &&
        (item?.status === 'PENDING' || item?.status === 'APPROVED'),
    );
    if (existing) return state;

    const now = new Date().toISOString();
    const authorization = {
      id: randomUUID(),
      workId: additive.workId,
      additiveId,
      action,
      status: 'PENDING',
      reason,
      requestedByUserId: String(actorId || ''),
      requestedBy: actor,
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      usedAt: null,
      usedBy: null,
    };
    const nextData = {
      ...state,
      additiveAuthorizations: [authorization, ...authorizations],
      audit: [
        {
          id: randomUUID(),
          workId: additive.workId,
          origem: 'Aditivos',
          referencia: `Solicitacao de ${action === 'EDIT' ? 'alteracao' : 'exclusao'}`,
          valorAntigo: additiveId,
          valorNovo: 'PENDING',
          usuario: actor,
          usuarioId: String(actorId || ''),
          usuarioEmail: String(actorEmail || ''),
          perfil: normalizeRole(role),
          dataHora: now,
          detalhe: reason,
        },
        ...(Array.isArray(state.audit) ? state.audit : []),
      ],
    };
    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: { data: nextData as Prisma.InputJsonValue },
    });
    return updated.data;
  }

  async decideAdditiveAuthorization(
    authorizationId: string,
    data: any,
    role?: string | null,
    actorName?: string | null,
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureAdditiveAuthorizationDecisionAccess(role);
    const decision = String(data?.decision || '')
      .trim()
      .toUpperCase();
    const decisionReason = String(data?.reason || '').trim();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException('Decisao de autorizacao invalida');
    }

    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new NotFoundException('Cadastro de obras nao encontrado');
    }
    const state = row.data as any;
    assertStatePayload(state);
    const authorizations = Array.isArray(state.additiveAuthorizations)
      ? state.additiveAuthorizations
      : [];
    const target = authorizations.find(
      (item: any) => item?.id === authorizationId,
    );
    if (!target) throw new NotFoundException('Solicitacao nao encontrada');
    if (target.status !== 'PENDING') {
      throw new BadRequestException('Esta solicitacao ja foi decidida');
    }

    const now = new Date().toISOString();
    const actor = String(actorName || 'Administrador').trim();
    const nextData = {
      ...state,
      additiveAuthorizations: authorizations.map((item: any) =>
        item?.id === authorizationId
          ? {
              ...item,
              status: decision,
              decidedBy: actor,
              decidedAt: now,
              decisionReason: decisionReason || null,
            }
          : item,
      ),
      audit: [
        {
          id: randomUUID(),
          workId: target.workId,
          origem: 'Aditivos',
          referencia: `Autorizacao de ${target.action === 'EDIT' ? 'alteracao' : 'exclusao'}`,
          valorAntigo: 'PENDING',
          valorNovo: decision,
          usuario: actor,
          usuarioId: String(actorId || ''),
          usuarioEmail: String(actorEmail || ''),
          perfil: normalizeRole(role),
          dataHora: now,
          detalhe: decisionReason || 'Decisao registrada pelo administrador',
        },
        ...(Array.isArray(state.audit) ? state.audit : []),
      ],
    };
    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: { data: nextData as Prisma.InputJsonValue },
    });
    return updated.data;
  }

  async releaseSchedule(
    workId: string,
    role?: string | null,
    actorName?: string | null,
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureScheduleReleaseAccess(role, actorName);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new NotFoundException('Cadastro de obras nao encontrado');
    }

    const state = row.data as any;
    assertStatePayload(state);
    if (!(state.works || []).some((work: any) => work?.id === workId)) {
      throw new NotFoundException('Obra nao encontrada');
    }

    const now = new Date().toISOString();
    const actor =
      String(actorName || 'Maria Eduarda').trim() || 'Maria Eduarda';
    const controls = (
      Array.isArray(state.scheduleControls) ? state.scheduleControls : []
    ).filter((item: any) => item?.workId !== workId);
    const nextData = {
      ...state,
      scheduleControls: [
        {
          workId,
          status: 'RELEASED',
          releasedAt: now,
          releasedBy: actor,
          reopenedAt: null,
          reopenedBy: null,
          reason: null,
        },
        ...controls,
      ],
      scheduleVersions: Array.isArray(state.scheduleVersions)
        ? state.scheduleVersions
        : [],
      audit: [
        {
          id: randomUUID(),
          workId,
          origem: 'Cronograma da Obra',
          referencia: 'Liberacao para ajuste',
          valorAntigo:
            scheduleControlForWork(state, workId)?.status || 'LOCKED',
          valorNovo: 'RELEASED',
          usuario: actor,
          usuarioId: String(actorId || ''),
          usuarioEmail: String(actorEmail || ''),
          perfil: normalizeRole(role),
          dataHora: now,
          detalhe: 'Cronograma liberado para reabertura pela Engenharia',
        },
        ...(Array.isArray(state.audit) ? state.audit : []),
      ],
    };
    assertStatePayload(nextData);

    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: { data: nextData as Prisma.InputJsonValue },
    });
    return updated.data;
  }

  async reopenSchedule(
    workId: string,
    reasonInput: unknown,
    role?: string | null,
    actorName?: string | null,
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureScheduleReopenAccess(role);
    const reason = String(reasonInput || '').trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Informe o motivo da reabertura do cronograma',
      );
    }

    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });
    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new NotFoundException('Cadastro de obras nao encontrado');
    }

    const state = row.data as any;
    assertStatePayload(state);
    if (!(state.works || []).some((work: any) => work?.id === workId)) {
      throw new NotFoundException('Obra nao encontrada');
    }
    const control = scheduleControlForWork(state, workId);
    if (control?.status !== 'RELEASED') {
      throw new BadRequestException(
        'O cronograma ainda nao foi liberado por Maria Eduarda',
      );
    }

    const previousVersions = Array.isArray(state.scheduleVersions)
      ? state.scheduleVersions
      : [];
    const workVersions = previousVersions.filter(
      (item: any) => item?.workId === workId,
    );
    const now = new Date().toISOString();
    const actor = String(actorName || 'Engenharia').trim() || 'Engenharia';
    const version = {
      id: randomUUID(),
      workId,
      version: workVersions.length + 1,
      reason,
      stages: JSON.parse(
        JSON.stringify(
          (Array.isArray(state.stages) ? state.stages : []).filter(
            (stage: any) => stage?.workId === workId,
          ),
        ),
      ),
      createdAt: now,
      createdBy: actor,
      releasedAt: control.releasedAt || null,
      releasedBy: control.releasedBy || null,
    };
    const controls = (
      Array.isArray(state.scheduleControls) ? state.scheduleControls : []
    ).filter((item: any) => item?.workId !== workId);
    const nextData = {
      ...state,
      scheduleControls: [
        {
          ...control,
          workId,
          status: 'OPEN',
          reopenedAt: now,
          reopenedBy: actor,
          reason,
        },
        ...controls,
      ],
      scheduleVersions: [version, ...previousVersions],
      audit: [
        {
          id: randomUUID(),
          workId,
          origem: 'Cronograma da Obra',
          referencia: `Versao ${version.version}`,
          valorAntigo: 'RELEASED',
          valorNovo: 'OPEN',
          usuario: actor,
          usuarioId: String(actorId || ''),
          usuarioEmail: String(actorEmail || ''),
          perfil: normalizeRole(role),
          dataHora: now,
          detalhe: `Cronograma reaberto. Motivo: ${reason}`,
        },
        ...(Array.isArray(state.audit) ? state.audit : []),
      ],
    };
    assertStatePayload(nextData);

    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: { data: nextData as Prisma.InputJsonValue },
    });
    return updated.data;
  }

  async updateLimitedCadastralFields(
    workId: string,
    data: any,
    role?: string | null,
    actor = 'Sistema',
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureLimitedCadastralWriteAccess(role);
    const fields = validateLimitedCadastralFields(data);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });

    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new NotFoundException('Cadastro de obras nao encontrado');
    }

    const state = row.data as any;
    assertStatePayload(state);
    const currentWork = state.works.find((work: any) => work?.id === workId);
    if (!currentWork) {
      throw new NotFoundException('Obra nao encontrada');
    }

    const fieldDefinitions = [
      {
        key: 'termoDefinitivoFinalizado',
        label: 'Recebimento do termo definitivo',
      },
      { key: 'cnoBaixada', label: 'Baixa da CNO' },
      { key: 'statusObra', label: 'Status da obra' },
    ] as const;
    const auditEntries = fieldDefinitions
      .filter(({ key }) => String(currentWork[key] || 'Nao') !== fields[key])
      .map(({ key, label }) => ({
        id: randomUUID(),
        workId,
        origem: 'Dados Cadastrais',
        referencia: label,
        valorAntigo: String(currentWork[key] || 'Nao'),
        valorNovo: fields[key],
        usuario: actor,
        usuarioId: String(actorId || ''),
        usuarioEmail: String(actorEmail || ''),
        perfil: normalizeRole(role),
        dataHora: new Date().toISOString(),
        detalhe: `${label} alterado`,
      }));

    const nextData = {
      ...state,
      works: state.works.map((work: any) =>
        work?.id === workId ? { ...work, ...fields } : work,
      ),
      audit: [
        ...auditEntries,
        ...(Array.isArray(state.audit) ? state.audit : []),
      ],
    };
    assertStatePayload(nextData);

    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: { data: nextData as Prisma.InputJsonValue },
    });

    return updated.data;
  }

  async deleteWork(
    workId: string,
    role?: string | null,
    actorName?: string | null,
    actorId?: string | null,
    actorEmail?: string | null,
  ) {
    ensureWriteAccess(role);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });

    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      return null;
    }

    const state = row.data as any;
    const work = (state.works || []).find((item: any) => item?.id === workId);
    if (!work) throw new NotFoundException('Obra nao encontrada');
    const now = new Date().toISOString();
    const workLabel = String(
      work?.codigoObra || work?.apelido || work?.nome || workId,
    );
    const preservedAudit = Array.isArray(state.audit) ? state.audit : [];
    const nextData = {
      ...filterWorkState(state, workId),
      audit: [
        {
          id: randomUUID(),
          workId,
          origem: 'Dados Cadastrais',
          referencia: 'Obra',
          valorAntigo: workLabel,
          valorNovo: '',
          usuario: String(actorName || actorEmail || 'Sistema'),
          usuarioId: String(actorId || ''),
          usuarioEmail: String(actorEmail || ''),
          perfil: normalizeRole(role),
          dataHora: now,
          detalhe: `Obra ${workLabel} excluida`,
          obraCodigo: String(work?.codigoObra || ''),
          obraNome: String(work?.apelido || work?.nome || ''),
        },
        ...preservedAudit,
      ],
    };
    assertStatePayload(nextData);

    const updated = await this.prisma.constructionControlState.update({
      where: { id: STATE_ID },
      data: {
        data: nextData as Prisma.InputJsonValue,
      },
    });

    return updated.data;
  }
}
