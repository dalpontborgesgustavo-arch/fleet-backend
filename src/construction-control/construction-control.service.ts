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
const CONSTRUCTION_WORK_STATUS = new Set([
  'Em andamento',
  'Entregue',
  'Paralisada',
]);
const CONSTRUCTION_YES_NO = new Set(['Sim', 'Nao']);

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
  return normalized === 'maria eduarda' || normalized.startsWith('maria eduarda ');
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
    mesesMedicao: (Array.isArray(stage?.mesesMedicao)
      ? stage.mesesMedicao
      : []
    )
      .map((month: any) => ({
        id: String(month?.id || ''),
        mes: Number(month?.mes || 0),
        percentual: Number(month?.percentual || 0),
        valor: Number(month?.valor || 0),
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
    metasMedicao: (Array.isArray(stage?.metasMedicao)
      ? stage.metasMedicao
      : []
    )
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
  return (Array.isArray(data?.scheduleControls) ? data.scheduleControls : []).find(
    (item: any) => item?.workId === workId,
  );
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
    audit: (data.audit || []).filter((item: any) => item?.workId !== workId),
    scheduleControls: (data.scheduleControls || []).filter(
      (item: any) => item?.workId !== workId,
    ),
    scheduleVersions: (data.scheduleVersions || []).filter(
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

    const nextData = currentData
      ? {
          ...data,
          scheduleControls: Array.isArray(currentData.scheduleControls)
            ? currentData.scheduleControls
            : [],
          scheduleVersions: Array.isArray(currentData.scheduleVersions)
            ? currentData.scheduleVersions
            : [],
        }
      : {
          ...data,
          scheduleControls: [],
          scheduleVersions: [],
        };
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

  async releaseSchedule(
    workId: string,
    role?: string | null,
    actorName?: string | null,
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
    const actor = String(actorName || 'Maria Eduarda').trim() || 'Maria Eduarda';
    const controls = (Array.isArray(state.scheduleControls)
      ? state.scheduleControls
      : []
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
          valorAntigo: scheduleControlForWork(state, workId)?.status || 'LOCKED',
          valorNovo: 'RELEASED',
          usuario: actor,
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
    const controls = (Array.isArray(state.scheduleControls)
      ? state.scheduleControls
      : []
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

  async deleteWork(workId: string, role?: string | null) {
    ensureWriteAccess(role);
    const row = await this.prisma.constructionControlState.findUnique({
      where: { id: STATE_ID },
    });

    if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      return null;
    }

    const nextData = filterWorkState(row.data, workId);
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
