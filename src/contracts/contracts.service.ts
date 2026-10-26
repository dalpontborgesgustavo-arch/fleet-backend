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
    label: 'Entrada em aprovacao',
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
    label: 'Entrada em aprovacao',
    responsible: 'Engenheiro de Obras',
    targetDays: 0,
    targetUnit: 'BUSINESS_DAYS',
    targetComparison: 'MAX',
    targetLabel: 'Inicio do prazo operacional',
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
  if (statusCode === 'O' || statusCode === 'F') return 'COMPLETED';
  return 'IN_PROGRESS';
}

export function mapContractWorkflow(contract: any) {
  const saved = contract.workflow;
  const type: ContractWorkflowType = WORKFLOW_TYPES.has(saved?.type)
    ? saved.type
    : 'SERVICO';
  // A situacao operacional vem do Aethos; o preenchimento e independente.
  const status = defaultWorkflowStatus(contract.statusCode);
  const eligibleForIndicators = ['P', 'O', 'F'].includes(contract.statusCode);
  const operationallyActive = contract.statusCode === 'P';
  const approvedAt: Date | null =
    eligibleForIndicators && contract.approvalCycleHistoryComplete
      ? (contract.approvedAt ?? null)
      : null;
  const cycleContractedAt: Date | null =
    approvedAt &&
    status === 'COMPLETED' &&
    contract.approvalCycleContractedAt &&
    contract.approvalCycleContractedAt >= approvedAt
      ? contract.approvalCycleContractedAt
      : null;
  const savedByKey = new Map(
    (saved?.stages || []).map((stage: any) => [stage.key, stage]),
  );
  const template = workflowTemplate(type);
  const dates: (Date | null)[] = template.map((definition, index) => {
    if (index === 0) return approvedAt;
    if (definition.key === 'CONTRATO_LIBERADO') return cycleContractedAt;
    const stored: any = savedByKey.get(definition.key);
    const date: Date | null = stored?.completedAt ?? null;
    // Datas de outro ciclo permanecem salvas, mas nao viram evidencia deste.
    return date &&
      approvedAt &&
      !isCalendarDateBefore(date, approvedAt) &&
      (!cycleContractedAt || !isCalendarDateBefore(cycleContractedAt, date))
      ? date
      : null;
  });
  const firstPendingIndex = dates.findIndex((date) => !date);
  const stages = template.map((definition, index) => {
    const stored: any = savedByKey.get(definition.key);
    const completedAt = dates[index];
    const previousCompletedAt = index > 0 ? dates[index - 1] : null;
    const isCurrent =
      operationallyActive && Boolean(approvedAt) && index === firstPendingIndex;
    // As metas pertencem ao fluxo oficial, e nao ao preenchimento individual.
    // Isso evita que configuracoes antigas persistidas prevalecam sobre o
    // procedimento vigente.
    const targetDays = definition.targetDays;
    const targetUnit = definition.targetUnit;
    const targetComparison = definition.targetComparison;
    let elapsedDays: number | null = null;
    let performanceStatus: 'PENDING' | 'ON_TIME' | 'LATE' | 'COMPLETED' =
      completedAt ? 'COMPLETED' : 'PENDING';

    if (index === 0 && completedAt) {
      elapsedDays = 0;
      performanceStatus = 'ON_TIME';
    } else if (previousCompletedAt && (completedAt || isCurrent)) {
      const end = completedAt || new Date();
      if (!isCalendarDateBefore(end, previousCompletedAt)) {
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
    }

    return {
      id: stored?.id ?? null,
      key: definition.key,
      sequence: index + 1,
      label: definition.label,
      responsible: stored?.responsible ?? definition.responsible,
      targetDays,
      targetUnit,
      targetComparison,
      targetLabel: definition.targetLabel,
      completedAt: iso(completedAt),
      notes: stored?.notes ?? null,
      elapsedDays,
      performanceStatus,
      isCurrent,
      intervalComplete:
        index > 0 &&
        Boolean(completedAt && previousCompletedAt) &&
        elapsedDays !== null,
      requiresDataEntry: status === 'COMPLETED' && !completedAt,
      updatedByName: stored?.updatedByName ?? null,
      updatedAt: iso(stored?.updatedAt),
    };
  });

  const completedStages = stages.filter((stage) => stage.completedAt).length;
  const totalEnd = operationallyActive ? new Date() : cycleContractedAt;
  const noticeDays =
    type === 'EMPREITEIRO' && contract.registeredAt && contract.startDate
      ? calendarDaysBetween(contract.registeredAt, contract.startDate)
      : null;

  return {
    id: saved?.id ?? null,
    persisted: Boolean(saved),
    type,
    status,
    outcomeAt: iso(cycleContractedAt),
    approvedAt: iso(approvedAt),
    approvalCycleContractedAt: iso(cycleContractedAt),
    approvalCycleSourceId: contract.approvalCycleSourceId ?? null,
    approvalCycleHistoryComplete:
      contract.approvalCycleHistoryComplete === true,
    operationallyActive,
    eligibleForIndicators,
    dataEntryComplete:
      completedStages === stages.length &&
      stages.every((stage, index) => index === 0 || stage.intervalComplete),
    missingStageCount: stages.length - completedStages,
    requestNotice: {
      registeredAt: iso(contract.registeredAt),
      startDate: iso(contract.startDate),
      elapsedCalendarDays: noticeDays,
      targetCalendarDays: type === 'EMPREITEIRO' ? 15 : null,
      performanceStatus:
        noticeDays === null ? 'PENDING' : noticeDays >= 15 ? 'ON_TIME' : 'LATE',
    },
    cancellationReason:
      saved?.cancellationReason ?? contract.cancellationReason ?? null,
    notes: saved?.notes ?? null,
    completedStages,
    totalStages: stages.length,
    progressPercent: Math.round((completedStages / stages.length) * 100),
    totalElapsedBusinessDays:
      approvedAt && totalEnd && !isCalendarDateBefore(totalEnd, approvedAt)
        ? businessDaysBetween(approvedAt, totalEnd)
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
    approvedAt: iso(contract.approvedAt),
    approvalCycleContractedAt: iso(contract.approvalCycleContractedAt),
    approvalCycleSourceId: contract.approvalCycleSourceId ?? null,
    approvalCycleHistoryComplete:
      contract.approvalCycleHistoryComplete === true,
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
    const status = defaultWorkflowStatus(contract.statusCode);
    if (requestedStatus && !WORKFLOW_STATUSES.has(requestedStatus)) {
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

    const approvedAt = contract.approvalCycleHistoryComplete
      ? contract.approvedAt
      : null;
    const cycleContractedAt =
      approvedAt &&
      status === 'COMPLETED' &&
      contract.approvalCycleContractedAt &&
      contract.approvalCycleContractedAt >= approvedAt
        ? contract.approvalCycleContractedAt
        : null;
    const completedDates = template.map((definition, index) => {
      if (index === 0) return approvedAt;
      if (definition.key === 'CONTRATO_LIBERADO') {
        return cycleContractedAt;
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
        Boolean(cycleContractedAt);
      if (date && index > 0 && !approvedAt) {
        throw new BadRequestException(
          'A entrada oficial em aprovacao ainda nao foi sincronizada',
        );
      }
      if (date && approvedAt && isCalendarDateBefore(date, approvedAt)) {
        throw new BadRequestException(
          'A data da etapa nao pode ser anterior a entrada em aprovacao',
        );
      }
      if (
        date &&
        cycleContractedAt &&
        isCalendarDateBefore(cycleContractedAt, date)
      ) {
        throw new BadRequestException(
          'A data da etapa nao pode ser posterior a contratacao',
        );
      }
      if (
        date &&
        index > 0 &&
        !completedDates[index - 1] &&
        status !== 'COMPLETED' &&
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

    const outcomeAt = cycleContractedAt;
    if (outcomeAt && previous && isCalendarDateBefore(outcomeAt, previous)) {
      throw new BadRequestException(
        'A data de conclusao ou cancelamento nao pode ser anterior as etapas',
      );
    }

    // O read model oculta datas de outro ciclo. Salvar notas com esses campos
    // vazios nao deve apagar a evidencia antiga que ainda permanece no banco.
    const persistedDates = completedDates.map((date, index) => {
      if (date || contract.workflow?.type !== type) return date;
      const stored = contract.workflow?.stages.find(
        (stage) => stage.key === template[index].key,
      )?.completedAt;
      if (!stored) return date;
      if (
        index === 0 ||
        template[index].key === 'CONTRATO_LIBERADO' ||
        !approvedAt ||
        isCalendarDateBefore(stored, approvedAt) ||
        (cycleContractedAt && isCalendarDateBefore(cycleContractedAt, stored))
      ) {
        return stored;
      }
      return date;
    });

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
            completedAt: persistedDates[index],
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
            completedAt: persistedDates[index],
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
