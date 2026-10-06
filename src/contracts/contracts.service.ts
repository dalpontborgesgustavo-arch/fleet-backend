import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const READ_ROLES = new Set([
  'admin',
  'gestor',
  'ceo',
  'administrativo',
  'juridico',
]);
const WRITE_ROLES = new Set(['admin', 'administrativo']);
const CONTRACT_STATUS = new Set(['A', 'C', 'F', 'O', 'P']);
const CONTRACT_TYPES = new Set(['empreiteiro', 'servico', 'sem_classificacao']);
const WORKFLOW_TYPES = new Set(['SERVICO', 'EMPREITEIRO']);
const WORKFLOW_STATUSES = new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type ContractWorkflowType = 'SERVICO' | 'EMPREITEIRO';
type ContractWorkflowStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type TargetUnit = 'BUSINESS_DAYS' | 'CALENDAR_DAYS';
type TargetComparison = 'MAX' | 'MIN';

interface WorkflowStageTemplate {
  key: string;
  label: string;
  responsible: string;
  targetDays: number | null;
  targetUnit: TargetUnit | null;
  targetComparison: TargetComparison | null;
  targetLabel: string;
}

const SERVICE_WORKFLOW: WorkflowStageTemplate[] = [
  {
    key: 'SOLICITACAO',
    label: 'Solicitacao do contrato',
    responsible: 'Solicitante (Gerente)',
    targetDays: 0,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Imediato',
  },
  {
    key: 'CONFERENCIA_ADMINISTRATIVO',
    label: 'Conferencia da documentacao',
    responsible: 'Administrativo',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'ELABORACAO_JURIDICO',
    label: 'Elaboracao, validacao e envio para assinatura',
    responsible: 'Juridico',
    targetDays: 3,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 3 dias uteis',
  },
  {
    key: 'ASSINATURA_FORNECEDOR',
    label: 'Validacao e assinatura do fornecedor',
    responsible: 'Fornecedor / Prestador',
    targetDays: 2,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 2 dias uteis',
  },
  {
    key: 'APROVACAO_DIRETORA_ADMINISTRATIVA',
    label: 'Conferencia, aprovacao e assinatura',
    responsible: 'Diretora Administrativa',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'DISPONIBILIZACAO_JURIDICO',
    label: 'Disponibilizacao do contrato assinado',
    responsible: 'Juridico',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'CONTRATO_LIBERADO',
    label: 'Contrato liberado no Aethos',
    responsible: 'Processo concluido',
    targetDays: null,
    targetUnit: null,
    targetComparison: null,
    targetLabel: 'Conclusao',
  },
];

const CONTRACTOR_WORKFLOW: WorkflowStageTemplate[] = [
  {
    key: 'SOLICITACAO_ENGENHEIRO',
    label: 'Solicitacao do contrato',
    responsible: 'Engenheiro de Obras',
    targetDays: 15,
    targetUnit: 'CALENDAR_DAYS',
    targetComparison: 'MIN',
    targetLabel: 'Minimo de 15 dias de antecedencia',
  },
  {
    key: 'CONFERENCIA_ADMINISTRATIVO',
    label: 'Conferencia das informacoes e documentacao',
    responsible: 'Administrativo',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'APROVACAO_DIRETOR_OPERACOES',
    label: 'Analise e aprovacao da solicitacao',
    responsible: 'Diretor de Operacoes',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'ENCAMINHAMENTO_JURIDICO',
    label: 'Insercao da documentacao e envio ao Juridico',
    responsible: 'Administrativo',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'VALIDACAO_JURIDICO',
    label: 'Validacao, minuta e plataforma de assinaturas',
    responsible: 'Juridico',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'ASSINATURA_EMPREITEIRO',
    label: 'Assinatura eletronica de todas as partes',
    responsible: 'Empreiteiro / Fornecedor',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'LIBERACAO_GERENTE_ADMINISTRATIVA',
    label: 'Conferencia final, assinatura e liberacao',
    responsible: 'Gerente Administrativa',
    targetDays: 1,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Ate 1 dia util',
  },
  {
    key: 'CONTRATO_LIBERADO',
    label: 'Contrato liberado no Aethos',
    responsible: 'Processo concluido',
    targetDays: null,
    targetUnit: null,
    targetComparison: null,
    targetLabel: 'Conclusao',
  },
];

function normalizeRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

export function ensureContractReadAccess(role?: string | null) {
  if (!READ_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Sem permissao para acessar Gestao de Contratos',
    );
  }
}

export function ensureContractWriteAccess(role?: string | null) {
  if (!WRITE_ROLES.has(normalizeRole(role))) {
    throw new ForbiddenException(
      'Somente o Administrativo pode preencher o fluxo do contrato',
    );
  }
}

function text(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(text(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function registrationDate(value: unknown, fieldName: string) {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException(`${fieldName} invalida`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException(`${fieldName} invalida`);
  }
  return parsed;
}

function nextUtcDay(value: Date) {
  return new Date(value.getTime() + 86400000);
}

function decimalNumber(value: Prisma.Decimal | null | undefined) {
  return value ? value.toNumber() : 0;
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function optionalText(value: unknown, maxLength = 4000) {
  const normalized = text(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalDate(value: unknown, fieldName: string) {
  const normalized = text(value);
  if (!normalized) return null;
  const dateOnly = normalized.match(/^\d{4}-\d{2}-\d{2}$/)
    ? `${normalized}T12:00:00.000Z`
    : normalized;
  const parsed = new Date(dateOnly);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} invalida`);
  }
  return parsed;
}

function dateOnlyUtc(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function isCalendarDateBefore(value: Date, reference: Date) {
  return dateOnlyUtc(value).getTime() < dateOnlyUtc(reference).getTime();
}

function calendarDaysBetween(start: Date, end: Date) {
  return Math.max(
    0,
    Math.round(
      (dateOnlyUtc(end).getTime() - dateOnlyUtc(start).getTime()) / 86400000,
    ),
  );
}

export function businessDaysBetween(start: Date, end: Date) {
  let cursor = dateOnlyUtc(start);
  const finish = dateOnlyUtc(end);
  if (finish.getTime() <= cursor.getTime()) return 0;

  let days = 0;
  while (cursor.getTime() < finish.getTime()) {
    cursor = new Date(cursor.getTime() + 86400000);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

export function workflowTemplate(type: ContractWorkflowType) {
  return type === 'EMPREITEIRO' ? CONTRACTOR_WORKFLOW : SERVICE_WORKFLOW;
}

function defaultWorkflowStatus(statusCode: string): ContractWorkflowStatus {
  if (statusCode === 'C') return 'CANCELLED';
  if (statusCode === 'F') return 'COMPLETED';
  return 'IN_PROGRESS';
}

function mapContractWorkflow(contract: any) {
  const saved = contract.workflow;
  const type: ContractWorkflowType = WORKFLOW_TYPES.has(saved?.type)
    ? saved.type
    : 'SERVICO';
  const status: ContractWorkflowStatus = WORKFLOW_STATUSES.has(saved?.status)
    ? saved.status
    : defaultWorkflowStatus(contract.statusCode);
  const savedByKey = new Map(
    (saved?.stages || []).map((stage: any) => [stage.key, stage]),
  );
  let previousCompletedAt: Date | null = null;

  const stages = workflowTemplate(type).map((definition, index) => {
    const stored: any = savedByKey.get(definition.key);
    const completedAt: Date | null =
      index === 0
        ? contract.registeredAt
        : definition.key === 'CONTRATO_LIBERADO'
          ? (contract.contractedAt ?? stored?.completedAt ?? null)
          : (stored?.completedAt ?? null);
    // As metas pertencem ao fluxo oficial, e nao ao preenchimento individual.
    // Isso evita que configuracoes antigas persistidas prevalecam sobre o
    // procedimento vigente.
    const targetDays = definition.targetDays;
    const targetUnit = definition.targetUnit;
    const targetComparison = definition.targetComparison;
    let elapsedDays: number | null = null;
    let performanceStatus: 'PENDING' | 'ON_TIME' | 'LATE' | 'COMPLETED' =
      completedAt ? 'COMPLETED' : 'PENDING';

    if (index === 0 && targetComparison === 'MIN') {
      if (completedAt && contract.startDate) {
        elapsedDays = calendarDaysBetween(completedAt, contract.startDate);
        performanceStatus =
          elapsedDays >= Number(targetDays || 0) ? 'ON_TIME' : 'LATE';
      }
    } else if (index === 0 && completedAt) {
      elapsedDays = 0;
      performanceStatus = 'ON_TIME';
    } else if (previousCompletedAt) {
      const end = completedAt || new Date();
      elapsedDays =
        targetUnit === 'CALENDAR_DAYS'
          ? calendarDaysBetween(previousCompletedAt, end)
          : businessDaysBetween(previousCompletedAt, end);
      if (targetDays !== null && targetDays !== undefined) {
        const reached =
          targetComparison === 'MIN'
            ? elapsedDays >= targetDays
            : elapsedDays <= targetDays;
        performanceStatus = completedAt
          ? reached
            ? 'ON_TIME'
            : 'LATE'
          : targetComparison === 'MAX' && elapsedDays > targetDays
            ? 'LATE'
            : 'PENDING';
      }
    }

    if (completedAt) previousCompletedAt = completedAt;

    return {
      id: stored?.id ?? null,
      key: definition.key,
      sequence: index + 1,
      label: stored?.label ?? definition.label,
      responsible: stored?.responsible ?? definition.responsible,
      targetDays,
      targetUnit,
      targetComparison,
      targetLabel: definition.targetLabel,
      completedAt: iso(completedAt),
      notes: stored?.notes ?? null,
      elapsedDays,
      performanceStatus,
      updatedByName: stored?.updatedByName ?? null,
      updatedAt: iso(stored?.updatedAt),
    };
  });

  const completedStages = stages.filter((stage) => stage.completedAt).length;
  const firstDate = stages.find((stage) => stage.completedAt)?.completedAt;
  const lastDate = [...stages]
    .reverse()
    .find((stage) => stage.completedAt)?.completedAt;
  const outcomeAt =
    saved?.outcomeAt ??
    (status !== 'IN_PROGRESS'
      ? contract.finalizedAt || contract.endDate || null
      : null);
  const totalEnd = outcomeAt || (lastDate ? new Date(lastDate) : null);

  return {
    id: saved?.id ?? null,
    persisted: Boolean(saved),
    type,
    status,
    outcomeAt: iso(outcomeAt),
    cancellationReason:
      saved?.cancellationReason ?? contract.cancellationReason ?? null,
    notes: saved?.notes ?? null,
    completedStages,
    totalStages: stages.length,
    progressPercent: Math.round((completedStages / stages.length) * 100),
    totalElapsedBusinessDays:
      firstDate && totalEnd
        ? businessDaysBetween(new Date(firstDate), totalEnd)
        : null,
    updatedByName: saved?.updatedByName ?? null,
    updatedAt: iso(saved?.updatedAt),
    stages,
  };
}

function companyName(companyAethosId: string) {
  if (companyAethosId === '1') return 'JR Construções';
  if (companyAethosId === '4') return 'Pedraforte';
  return `Empresa ${companyAethosId}`;
}

function mapAttachment(attachment: {
  id: string;
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
  fileUrl: string | null;
  fileReceivedAt: Date | null;
  syncedAt: Date;
}) {
  return {
    ...attachment,
    includedAt: iso(attachment.includedAt),
    fileReceivedAt: iso(attachment.fileReceivedAt),
    syncedAt: attachment.syncedAt.toISOString(),
    available: Boolean(attachment.fileUrl),
  };
}

function mapContract(contract: any, includeAttachments = false) {
  const contractType: ContractWorkflowType | null = WORKFLOW_TYPES.has(
    contract.workflow?.type,
  )
    ? contract.workflow.type
    : null;

  return {
    id: contract.id,
    aethosId: contract.aethosId,
    quotationAethosId: contract.quotationAethosId,
    companyAethosId: contract.companyAethosId,
    companyName: companyName(contract.companyAethosId),
    workAethosId: contract.workAethosId,
    workName: contract.workName,
    contractorAethosId: contract.contractorAethosId,
    contractorName: contract.contractorName,
    registeredAt: iso(contract.registeredAt),
    startDate: iso(contract.startDate),
    endDate: iso(contract.endDate),
    finalizedAt: iso(contract.finalizedAt),
    contractedAt: iso(contract.contractedAt),
    lastContractedAt: iso(contract.lastContractedAt),
    contractedByUser: contract.contractedByUser,
    originalValue: decimalNumber(contract.originalValue),
    statusCode: contract.statusCode,
    statusDescription: contract.statusDescription,
    notes: contract.notes,
    engineerAethosId: contract.engineerAethosId,
    engineerName: contract.engineerName,
    retentionValue: decimalNumber(contract.retentionValue),
    anticipatedRetentionValue: decimalNumber(
      contract.anticipatedRetentionValue,
    ),
    retentionBalance: decimalNumber(contract.retentionBalance),
    totalMeasuredValue: decimalNumber(contract.totalMeasuredValue),
    payableBalance: decimalNumber(contract.payableBalance),
    measurementBalance: decimalNumber(contract.measurementBalance),
    contractBalance: decimalNumber(contract.contractBalance),
    contractQuantity: decimalNumber(contract.contractQuantity),
    movesFinancial: contract.movesFinancial,
    returnsWorkBalance: contract.returnsWorkBalance,
    accountPlanAethosId: contract.accountPlanAethosId,
    accountPlanName: contract.accountPlanName,
    cancellationReason: contract.cancellationReason,
    contractType,
    syncedAt: contract.syncedAt.toISOString(),
    attachmentCount:
      contract._count?.attachments ?? contract.attachments?.length ?? 0,
    workflow: mapContractWorkflow(contract),
    ...(includeAttachments
      ? {
          attachments: (contract.attachments || []).map(mapAttachment),
          generatedAttachments: contract.generatedAttachments ?? null,
        }
      : {}),
  };
}

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: Record<string, unknown>, role?: string | null) {
    ensureContractReadAccess(role);

    const search = text(query.search).slice(0, 120);
    const statuses = Array.from(
      new Set(
        text(query.status)
          .toUpperCase()
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean),
      ),
    );
    const company = text(query.company);
    const contractType = text(query.contractType).toLowerCase();
    const registeredFrom = registrationDate(
      query.registeredFrom,
      'Data inicial de cadastro',
    );
    const registeredTo = registrationDate(
      query.registeredTo,
      'Data final de cadastro',
    );
    const page = positiveInteger(query.page, 1);
    const pageSize = Math.min(
      positiveInteger(query.pageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    if (statuses.some((status) => !CONTRACT_STATUS.has(status))) {
      throw new BadRequestException('Status de contrato invalido');
    }
    if (contractType && !CONTRACT_TYPES.has(contractType)) {
      throw new BadRequestException('Tipo de contrato invalido');
    }
    if (
      registeredFrom &&
      registeredTo &&
      registeredFrom.getTime() > registeredTo.getTime()
    ) {
      throw new BadRequestException(
        'Data inicial de cadastro nao pode ser posterior a data final',
      );
    }

    const typeFilter: Prisma.AethosContractWhereInput | null =
      contractType === 'empreiteiro'
        ? { workflow: { is: { type: 'EMPREITEIRO' } } }
        : contractType === 'servico'
          ? { workflow: { is: { type: 'SERVICO' } } }
          : contractType === 'sem_classificacao'
            ? { workflow: { is: null } }
            : null;

    const where: Prisma.AethosContractWhereInput = {
      active: true,
      ...(statuses.length ? { statusCode: { in: statuses } } : {}),
      ...(company ? { companyAethosId: company } : {}),
      ...(registeredFrom || registeredTo
        ? {
            registeredAt: {
              ...(registeredFrom ? { gte: registeredFrom } : {}),
              ...(registeredTo ? { lt: nextUtcDay(registeredTo) } : {}),
            },
          }
        : {}),
      ...(search || typeFilter
        ? {
            AND: [
              ...(search
                ? [
                    {
                      OR: [
                        {
                          aethosId: {
                            contains: search,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          workAethosId: {
                            contains: search,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          workName: {
                            contains: search,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          contractorName: {
                            contains: search,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          engineerName: {
                            contains: search,
                            mode: 'insensitive' as const,
                          },
                        },
                      ],
                    },
                  ]
                : []),
              ...(typeFilter ? [typeFilter] : []),
            ],
          }
        : {}),
    };

    const [items, total, aggregate, statusGroups, lastSync] = await Promise.all(
      [
        this.prisma.aethosContract.findMany({
          where,
          orderBy: [{ registeredAt: 'desc' }, { aethosId: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            _count: { select: { attachments: { where: { active: true } } } },
            workflow: { include: { stages: { orderBy: { sequence: 'asc' } } } },
          },
        }),
        this.prisma.aethosContract.count({ where }),
        this.prisma.aethosContract.aggregate({
          where,
          _sum: {
            originalValue: true,
            totalMeasuredValue: true,
            contractBalance: true,
          },
        }),
        this.prisma.aethosContract.groupBy({
          by: ['statusCode', 'statusDescription'],
          where,
          _count: { _all: true },
          _sum: { originalValue: true },
        }),
        this.prisma.aethosContract.findFirst({
          where: { active: true },
          orderBy: { syncedAt: 'desc' },
          select: { syncedAt: true },
        }),
      ],
    );

    return {
      summary: {
        total,
        originalValue: decimalNumber(aggregate._sum.originalValue),
        measuredValue: decimalNumber(aggregate._sum.totalMeasuredValue),
        balanceValue: decimalNumber(aggregate._sum.contractBalance),
        byStatus: statusGroups.map((group) => ({
          code: group.statusCode,
          description: group.statusDescription,
          count: group._count._all,
          value: decimalNumber(group._sum.originalValue),
        })),
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      lastSyncAt: iso(lastSync?.syncedAt),
      items: items.map((item) => mapContract(item)),
    };
  }

  async findOne(id: string, role?: string | null) {
    ensureContractReadAccess(role);

    const normalizedId = text(id);
    if (!normalizedId) {
      throw new BadRequestException('Contrato invalido');
    }

    const contract = await this.prisma.aethosContract.findFirst({
      where: {
        active: true,
        OR: [{ id: normalizedId }, { aethosId: normalizedId }],
      },
      include: {
        attachments: {
          where: { active: true },
          orderBy: [{ includedAt: 'desc' }, { fileName: 'asc' }],
        },
        workflow: { include: { stages: { orderBy: { sequence: 'asc' } } } },
      },
    });

    if (!contract) {
      throw new NotFoundException('Contrato nao encontrado');
    }

    return mapContract(contract, true);
  }

  async updateType(
    id: string,
    body: Record<string, unknown>,
    role?: string | null,
    actor?: { id?: string | null; name?: string | null },
  ) {
    ensureContractWriteAccess(role);
    const normalizedId = text(id);
    const requestedType = text(body.type).toUpperCase();
    if (!WORKFLOW_TYPES.has(requestedType)) {
      throw new BadRequestException('Classificacao do contrato invalida');
    }
    const type = requestedType as ContractWorkflowType;

    const contract = await this.prisma.aethosContract.findFirst({
      where: {
        active: true,
        OR: [{ id: normalizedId }, { aethosId: normalizedId }],
      },
      include: {
        workflow: { include: { stages: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contrato nao encontrado');

    const actorId = optionalText(actor?.id, 120);
    const actorName = optionalText(actor?.name, 200);
    await this.prisma.$transaction(async (tx) => {
      if (contract.workflow && contract.workflow.type !== type) {
        await tx.contractWorkflowStage.deleteMany({
          where: { workflowId: contract.workflow.id },
        });
      }

      await tx.contractWorkflow.upsert({
        where: { contractId: contract.id },
        create: {
          contractId: contract.id,
          type,
          status: defaultWorkflowStatus(contract.statusCode),
          updatedById: actorId,
          updatedByName: actorName,
        },
        update: {
          type,
          updatedById: actorId,
          updatedByName: actorName,
        },
      });
    });

    return this.findOne(contract.id, role);
  }

  async updateWorkflow(
    id: string,
    body: Record<string, unknown>,
    role?: string | null,
    actor?: { id?: string | null; name?: string | null },
  ) {
    ensureContractWriteAccess(role);
    const normalizedId = text(id);
    const contract = await this.prisma.aethosContract.findFirst({
      where: {
        active: true,
        OR: [{ id: normalizedId }, { aethosId: normalizedId }],
      },
      include: {
        workflow: { include: { stages: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contrato nao encontrado');

    const requestedType = text(body.type).toUpperCase();
    const type = (requestedType ||
      contract.workflow?.type) as ContractWorkflowType;
    if (!WORKFLOW_TYPES.has(type)) {
      throw new BadRequestException(
        'Classifique o contrato antes de preencher o fluxo',
      );
    }

    const requestedStatus = text(body.status).toUpperCase();
    const status = (requestedStatus ||
      contract.workflow?.status ||
      'IN_PROGRESS') as ContractWorkflowStatus;
    if (!WORKFLOW_STATUSES.has(status)) {
      throw new BadRequestException('Status do fluxo invalido');
    }

    if (!Array.isArray(body.stages)) {
      throw new BadRequestException('Etapas do fluxo sao obrigatorias');
    }
    const stageInputs = new Map<string, Record<string, unknown>>();
    for (const raw of body.stages) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('Etapa do fluxo invalida');
      }
      const input = raw as Record<string, unknown>;
      const key = text(input.key).toUpperCase();
      if (!key || stageInputs.has(key)) {
        throw new BadRequestException('Etapa duplicada ou sem identificacao');
      }
      stageInputs.set(key, input);
    }

    const template = workflowTemplate(type);
    const allowedKeys = new Set(template.map((stage) => stage.key));
    for (const key of stageInputs.keys()) {
      if (!allowedKeys.has(key)) {
        throw new BadRequestException(`Etapa ${key} nao pertence a este fluxo`);
      }
    }

    const completedDates = template.map((definition, index) => {
      if (index === 0) return contract.registeredAt;
      if (definition.key === 'CONTRATO_LIBERADO') {
        return (
          contract.contractedAt ??
          optionalDate(
            stageInputs.get(definition.key)?.completedAt,
            `Data da etapa ${definition.label}`,
          )
        );
      }
      return optionalDate(
        stageInputs.get(definition.key)?.completedAt,
        `Data da etapa ${definition.label}`,
      );
    });
    let previous: Date | null = null;
    for (const [index, date] of completedDates.entries()) {
      const isAutomaticFinalStage =
        template[index]?.key === 'CONTRATO_LIBERADO' &&
        Boolean(contract.contractedAt);
      if (
        date &&
        index > 0 &&
        !completedDates[index - 1] &&
        !isAutomaticFinalStage
      ) {
        throw new BadRequestException(
          `Preencha a etapa anterior antes de ${template[index].label}`,
        );
      }
      if (date && previous && isCalendarDateBefore(date, previous)) {
        throw new BadRequestException(
          `A data de ${template[index].label} nao pode ser anterior a etapa anterior`,
        );
      }
      if (date) previous = date;
    }

    const outcomeAt = optionalDate(body.outcomeAt, 'Data de conclusao');
    if (status === 'COMPLETED' && !completedDates.at(-1)) {
      throw new BadRequestException(
        'Preencha a data da etapa Contrato liberado para concluir o fluxo',
      );
    }
    if (status === 'CANCELLED' && !outcomeAt) {
      throw new BadRequestException('Informe a data do cancelamento');
    }
    if (outcomeAt && previous && isCalendarDateBefore(outcomeAt, previous)) {
      throw new BadRequestException(
        'A data de conclusao ou cancelamento nao pode ser anterior as etapas',
      );
    }

    const actorId = optionalText(actor?.id, 120);
    const actorName = optionalText(actor?.name, 200);
    await this.prisma.$transaction(async (tx) => {
      if (contract.workflow && contract.workflow.type !== type) {
        await tx.contractWorkflowStage.deleteMany({
          where: { workflowId: contract.workflow.id },
        });
      }

      const workflow = await tx.contractWorkflow.upsert({
        where: { contractId: contract.id },
        create: {
          contractId: contract.id,
          type,
          status,
          outcomeAt: status === 'IN_PROGRESS' ? null : outcomeAt,
          cancellationReason:
            status === 'CANCELLED'
              ? optionalText(body.cancellationReason)
              : null,
          notes: optionalText(body.notes),
          updatedById: actorId,
          updatedByName: actorName,
        },
        update: {
          type,
          status,
          outcomeAt: status === 'IN_PROGRESS' ? null : outcomeAt,
          cancellationReason:
            status === 'CANCELLED'
              ? optionalText(body.cancellationReason)
              : null,
          notes: optionalText(body.notes),
          updatedById: actorId,
          updatedByName: actorName,
        },
      });

      await tx.contractWorkflowStage.deleteMany({
        where: {
          workflowId: workflow.id,
          key: { notIn: template.map((stage) => stage.key) },
        },
      });

      for (const [index, definition] of template.entries()) {
        const input = stageInputs.get(definition.key);
        await tx.contractWorkflowStage.upsert({
          where: {
            workflowId_key: {
              workflowId: workflow.id,
              key: definition.key,
            },
          },
          create: {
            workflowId: workflow.id,
            key: definition.key,
            sequence: index + 1,
            label: definition.label,
            responsible: definition.responsible,
            targetDays: definition.targetDays,
            targetUnit: definition.targetUnit,
            targetComparison: definition.targetComparison,
            completedAt: completedDates[index],
            notes: optionalText(input?.notes, 1000),
            updatedById: actorId,
            updatedByName: actorName,
          },
          update: {
            sequence: index + 1,
            label: definition.label,
            responsible: definition.responsible,
            targetDays: definition.targetDays,
            targetUnit: definition.targetUnit,
            targetComparison: definition.targetComparison,
            completedAt: completedDates[index],
            notes: optionalText(input?.notes, 1000),
            updatedById: actorId,
            updatedByName: actorName,
          },
        });
      }
    });

    return this.findOne(contract.id, role);
  }
}
