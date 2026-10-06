import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RncAssignmentStatus,
  RncHistoryAction,
  RncStatus,
  RncType,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../storage/s3-upload.service';
import { AnswerRncAssignmentDto } from './dto/answer-rnc-assignment.dto';
import { CancelRncDto } from './dto/cancel-rnc.dto';
import { CompleteRncCorrectiveActionDto } from './dto/complete-rnc-corrective-action.dto';
import { UpdateRncCorrectiveActionDto } from './dto/update-rnc-corrective-action.dto';
import { CreateRncDto } from './dto/create-rnc.dto';
import { DirectRncDto } from './dto/direct-rnc.dto';
import { ReviewRncEffectivenessDto } from './dto/review-rnc-effectiveness.dto';
import { ReviewRncDto } from './dto/review-rnc.dto';
import {
  SubmitRncCauseAnalysisDto,
  SubmitRncResponsibleActionDto,
} from './dto/submit-rnc-responsible-action.dto';
import { UpdateRncInvestigationDto } from './dto/update-rnc-investigation.dto';
import { UpdateRncProgressDto } from './dto/update-rnc-progress.dto';

const includeRncRelations = {
  engineer: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  reviewedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  responsibleUser: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  effectivenessReviewedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  systemItemIncludedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  items: {
    orderBy: {
      createdAt: 'asc' as const,
    },
    include: {
      includedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  history: {
    orderBy: {
      createdAt: 'desc' as const,
    },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  assignments: {
    orderBy: {
      createdAt: 'desc' as const,
    },
    include: {
      assignedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  attachments: {
    where: {
      correctiveActionId: null,
    },
    orderBy: {
      createdAt: 'desc' as const,
    },
    include: {
      uploadedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  correctiveActions: {
    orderBy: [
      { sequence: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
    include: {
      responsibleUser: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
        },
      },
      completedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      evidence: {
        orderBy: {
          createdAt: 'asc' as const,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      },
    },
  },
};

const RNC_INTERNAL_UNIT_OPTIONS = [
  'Unidade',
  'Peca',
  'Metro',
  'Metro quadrado',
  'Metro cubico',
  'Quilograma',
  'Tonelada',
  'Litro',
  'Saco',
  'Hora',
  'Dia',
  'Viagem',
  'Verba',
];

const RNC_DIRECTION_TARGET_ROLES = [
  'engenharia',
  'gestor',
  'ceo',
  'supervisor',
  'supervisor_apoio',
  'manutencao',
  'manutentor',
  'compras',
  'topografia',
  'orcamento',
  'administrativo',
  'contabilidade',
  'ssma',
  'ti',
  'vendas',
  'rh',
  'qualidade',
  'juridico',
  'almoxarifado',
  'licitacao',
  'licitacao_gestor',
  'usina_icara',
];

const RNC_INTERNAL_AREA_OPTIONS = [
  'Qualidade',
  'Meio Ambiente',
  'Saude e seguranca',
  'Saúde e segurança',
];

const RNC_CORRECTIVE_ACTION_STATUS_OPTIONS = [
  'Pendente',
  'Em andamento',
  'Concluida',
  'Concluída',
  'Cancelada',
];

const RNC_EMAIL_TARGET_EMAIL = 'everton.silvestre@jrmc.com.br';
const RNC_EMAIL_TOKEN_KIND_ASSIGNMENT = 'ASSIGNMENT_RESPONSE';
const RNC_EMAIL_TOKEN_KIND_MANAGER_REVIEW = 'MANAGER_REVIEW';
const RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON =
  'Analise de causa e plano de acao corretiva';
const RNC_MANAGER_ACTION_HISTORY_ACTIONS = new Set<RncHistoryAction>([
  RncHistoryAction.APPROVED,
  RncHistoryAction.DIRECTED,
  RncHistoryAction.INVESTIGATION_UPDATED,
  RncHistoryAction.REJECTED,
  RncHistoryAction.RETURNED,
]);
const RNC_FISHBONE_KEYS = [
  'maoDeObra',
  'metodo',
  'maquina',
  'material',
  'meioAmbiente',
  'medicao',
] as const;
const RNC_CANCELLATION_NOTIFICATION_EMAILS = [
  'maria.teixeira@jrmc.com.br',
  'everton.silvestre@jrmc.com.br',
] as const;

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function canReadAllRncs(role?: string | null) {
  const normalized = normalizeRole(role);
  return (
    normalized === 'gestor' ||
    normalized === 'ceo' ||
    normalized === 'admin' ||
    normalized === 'administrador' ||
    normalized === 'qualidade' ||
    normalized === 'juridico' ||
    normalized === 'almoxarifado' ||
    normalized === 'licitacao' ||
    normalized === 'licitacao_gestor' ||
    normalized === 'usina_icara'
  );
}

function isConsultantRole(role?: string | null) {
  return normalizeRole(role) === 'consultor';
}

function isResponsibilityOnlyRole(role?: string | null) {
  const normalized = normalizeRole(role);
  return (
    normalized === 'financeiro' ||
    normalized === 'contabilidade' ||
    normalized === 'ssma' ||
    normalized === 'ti' ||
    normalized === 'vendas' ||
    normalized === 'rh'
  );
}

function isEngineeringRole(role?: string | null) {
  const normalized = normalizeRole(role);
  return normalized === 'engenharia' || normalized === 'engenheiro';
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}

function normalizeFishbone(value?: Record<string, unknown> | null) {
  return Object.fromEntries(
    RNC_FISHBONE_KEYS.map((key) => [key, coerceText(value?.[key])]),
  );
}

function normalizeFiveWhys(value?: unknown[] | null) {
  return Array.from({ length: 5 }, (_, index) => coerceText(value?.[index]));
}

function trimRequired(value: unknown, fieldName: string) {
  const text = coerceText(value);
  if (!text) {
    throw new BadRequestException(`${fieldName} e obrigatorio`);
  }
  return text;
}

function trimOptional(value: unknown) {
  const text = coerceText(value);
  return text || null;
}

function normalizeEngineerName(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^eng(?:enheiro|enheira)?\.?\s*/i, '')
    .trim();
}

function normalizeAethosItemCode(value: unknown) {
  return coerceText(value).replace(/\D/g, '');
}

function normalizeRncType(value: unknown, dto?: CreateRncDto) {
  const normalized = (coerceText(value) || 'EXTERNAL').toUpperCase();

  if (normalized === 'WORK') return RncType.WORK;
  if (normalized === RncType.INTERNAL) {
    const looksLikeLegacyWorkRnc =
      !!dto &&
      !trimOptional(dto.ncArea) &&
      (!!trimOptional(dto.internalMotivo) ||
        !!trimOptional(dto.internalCausador) ||
        dto.colocarItemSistema !== undefined ||
        dto.valorNc !== undefined);

    return looksLikeLegacyWorkRnc ? RncType.WORK : RncType.INTERNAL;
  }

  return RncType.EXTERNAL;
}

function parseDate(value: unknown, fieldName: string) {
  const text = coerceText(value);
  if (!text) {
    throw new BadRequestException(`${fieldName} e obrigatorio`);
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} invalida`);
  }

  return date;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parseRequiredDecimal(value: unknown, fieldName: string) {
  const normalized = normalizeDecimal(value, fieldName);
  if (normalized === null) {
    throw new BadRequestException(`${fieldName} e obrigatorio`);
  }
  return normalized;
}

function parseOptionalDecimal(value: unknown, fieldName: string) {
  return normalizeDecimal(value, fieldName);
}

function normalizeDecimal(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return null;

  const raw = coerceText(value).replace(/[^\d,.-]/g, '');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new BadRequestException(`${fieldName} invalido`);
  }

  return new Prisma.Decimal(normalized);
}

function validateOption(value: unknown, fieldName: string, options: string[]) {
  const text = trimRequired(value, fieldName);
  if (!options.includes(text)) {
    throw new BadRequestException(`${fieldName} invalido`);
  }
  return text;
}

function normalizeOptionKey(value: string) {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function validateRncInternalUnit(value: unknown) {
  const text = trimRequired(value, 'Unidade de medida');
  const normalized = normalizeOptionKey(text);
  const canonical = RNC_INTERNAL_UNIT_OPTIONS.find(
    (option) => normalizeOptionKey(option) === normalized,
  );

  if (!canonical) {
    throw new BadRequestException('Unidade de medida invalida');
  }

  return canonical;
}

type RncWithRelations = Prisma.RncGetPayload<{
  include: typeof includeRncRelations;
}>;
const includeRncEmailTokenRelations = {
  targetUser: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  assignment: {
    include: {
      assignedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  rnc: {
    include: includeRncRelations,
  },
} as const;
type RncEmailTokenWithRelations = Prisma.RncEmailTokenGetPayload<{
  include: typeof includeRncEmailTokenRelations;
}>;
type InitialRncData = Omit<
  Prisma.RncUncheckedCreateInput,
  'engineerId' | 'history'
>;
type InitialRncItemData = {
  code?: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unit: string;
  unitValue: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  status: string;
};
type InitialRncBuild = {
  data: InitialRncData;
  items: InitialRncItemData[];
};

@Injectable()
export class RncsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
    private readonly s3UploadService: S3UploadService,
  ) {}

  async findAll(actorRole?: string | null, actorId?: string | null) {
    const role = normalizeRole(actorRole);
    const where: Prisma.RncWhereInput = {};

    if (isEngineeringRole(role)) {
      // Engenharia acompanha todas as RNCs. As permissoes de alteracao
      // continuam sendo validadas separadamente em cada acao.
    } else if (canReadAllRncs(role)) {
      // Gestor e administrador acompanham todo o fluxo.
    } else if (isResponsibilityOnlyRole(role)) {
      if (!actorId) {
        throw new BadRequestException('Usuario autenticado nao encontrado');
      }
      where.OR = [
        { responsibleUserId: actorId },
        {
          correctiveActions: {
            some: { responsibleUserId: actorId },
          },
        },
        {
          assignments: {
            some: { assignedToId: actorId },
          },
        },
      ];
    } else if (isConsultantRole(role)) {
      where.type = RncType.INTERNAL;
    } else if (this.canAnswerDirectedRnc(role)) {
      if (!actorId) {
        throw new BadRequestException('Usuario autenticado nao encontrado');
      }
      where.OR = [
        {
          correctiveActions: {
            some: { responsibleUserId: actorId },
          },
        },
        {
          assignments: {
            some: {
              assignedToId: actorId,
            },
          },
        },
      ];

      if (this.canIncludeSystemItem(role)) {
        where.OR.push({
          colocarItemSistema: true,
          systemItemStatus: { in: ['PENDING', 'INCLUDED'] },
        });
        where.OR.push({
          type: RncType.WORK,
          status: { in: [RncStatus.IN_PROGRESS, RncStatus.COMPLETED] },
        });
      }

      where.OR.push({
        responsibleUserId: actorId,
        type: RncType.INTERNAL,
      });
    } else if (actorId) {
      where.OR = [
        {
          correctiveActions: {
            some: { responsibleUserId: actorId },
          },
        },
        {
          assignments: {
            some: { assignedToId: actorId },
          },
        },
        {
          responsibleUserId: actorId,
          type: RncType.INTERNAL,
        },
      ];
    } else {
      throw new ForbiddenException('Sem permissao para acessar RNCs');
    }

    const rncs = await this.prisma.rnc.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: includeRncRelations,
    });

    return rncs.map((rnc) => this.serialize(rnc));
  }

  async findAethosItemByCode(code: string) {
    const normalizedCode = normalizeAethosItemCode(code);
    if (!normalizedCode) {
      throw new BadRequestException('Codigo do item invalido');
    }

    const item = await this.prisma.aethosItem.findUnique({
      where: { code: normalizedCode },
      select: {
        code: true,
        description: true,
        unit: true,
        syncedAt: true,
      },
    });

    if (!item) return null;

    return item;
  }

  async findOne(
    id: string,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    const rnc = await this.getRnc(id);
    this.ensureCanRead(rnc, actorRole, actorId);

    return this.serialize(rnc);
  }

  async findEmailResponseByToken(token: string) {
    const tokenRecord = await this.findRncEmailTokenByToken(token);
    return this.toPublicEmailResponse(tokenRecord);
  }

  async respondEmailResponseToken(
    token: string,
    responseValue: unknown,
    ip?: string,
    userAgent?: string,
  ) {
    const tokenRecord = await this.findRncEmailTokenByToken(token);

    if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Este link de resposta expirou.');
    }

    if (!tokenRecord.assignmentId || !tokenRecord.assignment) {
      throw new BadRequestException(
        'Este link nao esta vinculado a uma solicitacao ativa.',
      );
    }

    if (
      tokenRecord.usedAt ||
      tokenRecord.assignment.status !== RncAssignmentStatus.PENDING
    ) {
      return this.toPublicEmailResponse(tokenRecord);
    }

    const response = trimRequired(responseValue, 'Explicacao');

    await this.respondAssignment(
      tokenRecord.rncId,
      { response },
      tokenRecord.targetUserId,
      tokenRecord.targetUser.role,
    );

    await this.prisma.rncEmailToken.update({
      where: { id: tokenRecord.id },
      data: {
        usedAt: new Date(),
        responseIp: trimOptional(ip),
        responseUserAgent: trimOptional(userAgent),
      },
    });

    return this.findEmailResponseByToken(token);
  }

  async performEmailManagerAction(
    token: string,
    actionValue: unknown,
    reasonValue?: unknown,
    assignedToIdValue?: unknown,
    ip?: string,
    userAgent?: string,
  ) {
    const tokenRecord = await this.findRncEmailTokenByToken(token);

    if (tokenRecord.kind !== RNC_EMAIL_TOKEN_KIND_MANAGER_REVIEW) {
      throw new BadRequestException('Este link nao e de revisao do gestor.');
    }

    if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Este link de revisao expirou.');
    }

    if (tokenRecord.usedAt) {
      return this.toPublicEmailResponse(tokenRecord);
    }

    if (
      !['gestor', 'ceo'].includes(normalizeRole(tokenRecord.targetUser.role))
    ) {
      throw new ForbiddenException('Este link nao pertence a um gestor.');
    }

    const action = trimRequired(actionValue, 'Acao').toUpperCase();

    if (action === 'APPROVE') {
      await this.approve(
        tokenRecord.rncId,
        tokenRecord.targetUserId,
        tokenRecord.targetUser.role,
      );
    } else if (action === 'RETURN') {
      await this.returnForAdjustment(
        tokenRecord.rncId,
        { reason: trimRequired(reasonValue, 'Motivo da devolucao') },
        tokenRecord.targetUserId,
        tokenRecord.targetUser.role,
      );
    } else if (action === 'REJECT') {
      await this.reject(
        tokenRecord.rncId,
        { reason: trimRequired(reasonValue, 'Motivo da reprovacao') },
        tokenRecord.targetUserId,
        tokenRecord.targetUser.role,
      );
    } else if (action === 'DIRECT') {
      await this.direct(
        tokenRecord.rncId,
        {
          assignedToId: trimRequired(assignedToIdValue, 'Responsavel'),
          reason: trimRequired(reasonValue, 'Motivo do direcionamento'),
        },
        tokenRecord.targetUserId,
        tokenRecord.targetUser.role,
      );
    } else {
      throw new BadRequestException('Acao de gestor invalida.');
    }

    await this.prisma.rncEmailToken.update({
      where: { id: tokenRecord.id },
      data: {
        usedAt: new Date(),
        responseIp: trimOptional(ip),
        responseUserAgent: trimOptional(userAgent),
      },
    });

    return this.findEmailResponseByToken(token);
  }

  async create(
    dto: CreateRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    this.ensureCanCreateRnc(actorRole, normalizeRncType(dto.type, dto));
    const { data, items } = await this.buildInitialData(dto);
    const isInternal = data.type === RncType.INTERNAL;

    const rnc = await this.prisma.rnc.create({
      data: {
        ...data,
        engineerId: actorId,
        ...(items.length > 0
          ? {
              items: {
                create: items,
              },
            }
          : {}),
        history: {
          create: {
            actorId,
            action: RncHistoryAction.CREATED,
            note: isInternal
              ? 'RNC enviada diretamente ao responsavel pelo tratamento'
              : 'RNC enviada para aprovacao do gestor',
          },
        },
      },
      include: includeRncRelations,
    });

    if (isInternal) {
      this.notifyUsers([data.responsibleUserId!], {
        title: 'RNC Interna para tratamento',
        body: `RNC #${rnc.number} foi direcionada para sua analise.`,
        data: this.notificationData(rnc.id),
      });
    } else {
      this.notifyRoles(['gestor'], {
        title: 'Nova RNC aguardando aprovação',
        body: `RNC #${rnc.number} enviada para análise do gestor.`,
        data: this.notificationData(rnc.id),
      });

      await this.sendManagerReviewEmailIfEnabled(rnc);
    }

    return this.serialize(rnc);
  }

  async editBeforeManagerAction(
    id: string,
    dto: CreateRncDto,
    actorId?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const requestedType = normalizeRncType(dto.type, dto);
    const { data, items } = await this.buildInitialData(dto);

    const rnc = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Rnc" WHERE "id" = ${id} FOR UPDATE`,
      );
      const existing = await this.getRnc(id, tx);
      this.ensureIssuerCanChangeBeforeManagerAction(existing, actorId);

      if (requestedType !== existing.type) {
        throw new BadRequestException(
          'O tipo da RNC nao pode ser alterado depois da abertura',
        );
      }

      const preserveAutomaticDates = existing.type !== RncType.EXTERNAL;

      return tx.rnc.update({
        where: { id },
        data: {
          ...data,
          ...(preserveAutomaticDates
            ? {
                dataEntrada: existing.dataEntrada,
                dataLimiteRetorno: existing.dataLimiteRetorno,
              }
            : {}),
          status: RncStatus.PENDING_MANAGER_APPROVAL,
          reviewedById: null,
          reviewedAt: null,
          reviewReason: null,
          items: {
            deleteMany: {},
            ...(items.length > 0 ? { create: items } : {}),
          },
          history: {
            create: {
              actorId,
              action: RncHistoryAction.EDITED,
              note: 'RNC editada pelo emitente antes da primeira acao do gestor',
            },
          },
        },
        include: includeRncRelations,
      });
    });

    return this.serialize(rnc);
  }

  async updateInternalOpening(
    id: string,
    dto: CreateRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    if (existing.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'A edicao desta etapa se aplica apenas a RNC Interna',
      );
    }
    this.ensureInternalOpeningOwner(existing, actorId, actorRole);
    if (existing.status === RncStatus.CANCELLED) {
      throw new BadRequestException('Uma RNC cancelada nao pode ser editada');
    }

    const requestedType = normalizeRncType(dto.type, dto);
    if (requestedType !== RncType.INTERNAL) {
      throw new BadRequestException(
        'O tipo da RNC nao pode ser alterado depois da abertura',
      );
    }

    const initialData = this.buildNewInternalInitialData(dto);
    const ncArea = validateOption(
      dto.ncArea,
      'Area',
      RNC_INTERNAL_AREA_OPTIONS,
    );
    const responsibleUserId = trimRequired(
      dto.responsibleUserId,
      'Responsavel',
    );
    const responsibleUser = await this.prisma.user.findFirst({
      where: {
        id: responsibleUserId,
        active: true,
        role: { notIn: ['motorista', 'operador'] },
      },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!responsibleUser) {
      throw new BadRequestException(
        'Selecione um usuario ativo do Sistema JR como responsavel',
      );
    }
    const responsibleChanged =
      responsibleUserId !== existing.responsibleUserId;
    if (
      responsibleChanged &&
      existing.status !== RncStatus.AWAITING_RESPONSIBLE_ACTION &&
      !isConsultantRole(actorRole)
    ) {
      throw new BadRequestException(
        'O responsavel pelo tratamento nao pode ser trocado depois que a etapa seguinte iniciou',
      );
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        ncArea,
        enquadramentoMotivo: ncArea,
        issuer: initialData.issuer,
        destinationSector: initialData.destinationSector,
        responsibleUserId,
        responsavel: responsibleUser.name,
        nonConformityDescription: initialData.nonConformityDescription,
        immediateReaction: initialData.immediateReaction,
        immediateResponsible: initialData.immediateResponsible,
        immediateDate: initialData.immediateDate,
        justificativasObservacoes: initialData.justificativasObservacoes,
        history: {
            create: {
              actorId,
              action: RncHistoryAction.EDITED,
              note: responsibleChanged
                ? `Responsavel pelo tratamento alterado de ${existing.responsibleUser?.name || existing.responsavel || 'responsavel anterior'} para ${responsibleUser.name}; etapas e registros existentes preservados`
                : 'Dados da abertura da RNC Interna atualizados pelo emitente',
            },
          },
      },
      include: includeRncRelations,
    });

    if (responsibleChanged) {
      this.notifyUsers([responsibleUserId], {
        title: 'RNC Interna para tratamento',
        body: `A responsabilidade principal da RNC #${rnc.number} foi atribuida a voce.`,
        data: this.notificationData(rnc.id),
      });
      await this.sendInternalRncTaskEmail(rnc, responsibleUser, {
        subject: `RNC #${rnc.number} - responsabilidade de tratamento atribuida a voce`,
        title: 'Responsabilidade pelo tratamento',
        description:
          'Voce foi definido como responsavel principal pelo tratamento desta RNC Interna. As etapas e os registros ja realizados foram preservados.',
      });
    }

    return this.serialize(rnc);
  }

  async cancel(
    id: string,
    dto: CancelRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const cancellationReason = trimRequired(
      dto.reason,
      'Motivo do cancelamento',
    );
    const cancelledAt = new Date();

    const rnc = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Rnc" WHERE "id" = ${id} FOR UPDATE`,
      );
      const existing = await this.getRnc(id, tx);
      this.ensureCanCancel(existing, actorId, actorRole);

      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!actor) {
        throw new BadRequestException('Usuario autenticado nao encontrado');
      }

      await tx.rncEmailToken.updateMany({
        where: { rncId: id, usedAt: null },
        data: { usedAt: cancelledAt },
      });

      return tx.rnc.update({
        where: { id },
        data: {
          status: RncStatus.CANCELLED,
          cancelledAt,
          cancelledById: actor.id,
          cancelledByName: actor.name,
          cancelledByEmail: actor.email,
          cancellationReason,
          history: {
            create: {
              actorId,
              action: RncHistoryAction.CANCELLED,
              note: `RNC cancelada por ${actor.name}. Motivo: ${cancellationReason}`,
            },
          },
        },
        include: includeRncRelations,
      });
    });

    await this.sendCancellationEmails(rnc);
    return this.serialize(rnc);
  }

  async resubmit(
    id: string,
    dto: CreateRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureEngineer(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    this.ensureOwnRnc(existing, actorId);

    if (
      existing.status !== RncStatus.RETURNED_FOR_ADJUSTMENT &&
      existing.status !== RncStatus.REJECTED
    ) {
      throw new BadRequestException('Esta RNC nao esta liberada para reenvio');
    }

    const { data, items } = await this.buildInitialData(dto);
    const isInternal = data.type === RncType.INTERNAL;

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        ...data,
        status: isInternal
          ? RncStatus.AWAITING_RESPONSIBLE_ACTION
          : RncStatus.PENDING_MANAGER_APPROVAL,
        reviewedById: null,
        reviewedAt: null,
        reviewReason: null,
        items: {
          deleteMany: {},
          ...(items.length > 0
            ? {
                create: items,
              }
            : {}),
        },
        history: {
          create: {
            actorId,
            action: RncHistoryAction.RESUBMITTED,
            note: isInternal
              ? 'RNC reenviada diretamente ao responsavel pelo tratamento'
              : 'RNC reenviada para aprovacao do gestor',
          },
        },
      },
      include: includeRncRelations,
    });

    if (isInternal) {
      this.notifyUsers([data.responsibleUserId!], {
        title: 'RNC Interna para tratamento',
        body: `RNC #${rnc.number} foi reenviada para sua analise.`,
        data: this.notificationData(rnc.id),
      });
    } else {
      this.notifyRoles(['gestor'], {
        title: 'RNC reenviada para aprovação',
        body: `RNC #${rnc.number} voltou para análise do gestor.`,
        data: this.notificationData(rnc.id),
      });

      await this.sendManagerReviewEmailIfEnabled(rnc);
    }

    return this.serialize(rnc);
  }

  async updateProgress(
    id: string,
    dto: UpdateRncProgressDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureEngineer(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    this.ensureOwnRnc(existing, actorId);

    if (existing.type === RncType.WORK) {
      throw new BadRequestException(
        'RNC de Obra aprovada deve ser finalizada pelo Administrativo',
      );
    }

    if (
      existing.status !== RncStatus.IN_PROGRESS &&
      existing.status !== RncStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Somente RNC aprovada pode receber andamento',
      );
    }

    const nextStatus = dto.status ?? existing.status;
    if (
      nextStatus !== RncStatus.IN_PROGRESS &&
      nextStatus !== RncStatus.COMPLETED
    ) {
      throw new BadRequestException('Status de andamento invalido');
    }

    const updateData: Prisma.RncUpdateInput = {
      respondido:
        typeof dto.respondido === 'boolean'
          ? dto.respondido
          : existing.respondido,
      planoAcaoSolucao: dto.planoAcaoSolucao?.trim() || null,
      status: nextStatus,
      valorRetido:
        dto.valorRetido === undefined
          ? existing.valorRetido
          : parseOptionalDecimal(dto.valorRetido, 'Valor retido'),
      dataAssinatura:
        dto.dataAssinatura === undefined
          ? existing.dataAssinatura
          : dto.dataAssinatura
            ? parseDate(dto.dataAssinatura, 'Data de assinatura')
            : null,
      obs: dto.obs?.trim() || null,
      history: {
        create: {
          actorId,
          action: RncHistoryAction.UPDATED_PROGRESS,
          note:
            nextStatus === RncStatus.COMPLETED
              ? 'RNC marcada como concluida'
              : 'Andamento da RNC atualizado',
        },
      },
    };

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: updateData,
      include: includeRncRelations,
    });

    return this.serialize(rnc);
  }

  async approve(
    id: string,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureManager(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    if (existing.type === RncType.INTERNAL) {
      throw new BadRequestException(
        'RNC Interna e enviada diretamente ao responsavel e nao exige aprovacao do gestor',
      );
    }
    this.ensureManagerReviewable(existing);

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: RncStatus.IN_PROGRESS,
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewReason: null,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.APPROVED,
            note: 'RNC aprovada pelo gestor',
          },
        },
      },
      include: includeRncRelations,
    });

    if (existing.type === RncType.WORK) {
      this.notifyRoles(['administrativo'], {
        title: 'RNC aprovada para continuidade',
        body: `RNC #${rnc.number} está pronta para tratamento administrativo.`,
        data: this.notificationData(rnc.id),
      });
    } else {
      this.notifyUsers([existing.engineerId], {
        title: 'RNC aprovada',
        body: `RNC #${rnc.number} foi aprovada e está em andamento.`,
        data: this.notificationData(rnc.id),
      });
    }

    return this.serialize(rnc);
  }

  async submitResponsibleAction(
    id: string,
    dto: SubmitRncResponsibleActionDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);

    if (existing.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Tratamento do responsavel se aplica apenas a RNC Interna',
      );
    }

    const isInitialSubmission =
      existing.status === RncStatus.AWAITING_RESPONSIBLE_ACTION;
    const canEditSavedStage: boolean = [
      RncStatus.AWAITING_CAUSE_ANALYSIS,
      RncStatus.RESPONSIBLE_ACTION_COMPLETED,
      RncStatus.COMPLETED,
    ].some((status) => status === existing.status);

    if (!isInitialSubmission && !canEditSavedStage) {
      throw new BadRequestException(
        'Esta etapa da RNC nao pode ser editada no status atual',
      );
    }

    if (
      existing.responsibleUserId !== actorId &&
      !isConsultantRole(actorRole)
    ) {
      throw new ForbiddenException(
        'Somente o responsavel definido na abertura pode decidir este fluxo',
      );
    }

    if (!dto.nonConformityAnalysis?.trim()) {
      throw new BadRequestException('Informe a analise da nao conformidade');
    }

    if (typeof dto.similarNonconformities !== 'boolean') {
      throw new BadRequestException('Informe se existem NCs similares');
    }

    if (!isInitialSubmission) {
      const currentCauseAssignment = existing.assignments.find(
        (assignment) =>
          assignment.reason === RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON &&
          assignment.status !== RncAssignmentStatus.CANCELLED,
      );
      const requestedCauseResponsibleId =
        dto.causeAnalysisResponsibleUserId?.trim() || null;
      const causeResponsibleChanged = Boolean(
        requestedCauseResponsibleId &&
          requestedCauseResponsibleId !==
            currentCauseAssignment?.assignedToId,
      );

      if (
        causeResponsibleChanged &&
        (!isConsultantRole(actorRole) ||
          existing.status !== RncStatus.AWAITING_CAUSE_ANALYSIS ||
          currentCauseAssignment?.status !== RncAssignmentStatus.PENDING)
      ) {
        throw new BadRequestException(
          'O responsavel pela analise de causa so pode ser trocado pelo consultor enquanto esta etapa estiver pendente',
        );
      }

      const nextCauseResponsible = causeResponsibleChanged
        ? await this.prisma.user.findFirst({
            where: {
              id: requestedCauseResponsibleId!,
              active: true,
              role: { notIn: ['motorista', 'operador'] },
            },
            select: { id: true, name: true, email: true, role: true },
          })
        : null;
      if (causeResponsibleChanged && !nextCauseResponsible) {
        throw new BadRequestException(
          'Selecione um usuario ativo do Sistema JR para a analise de causa',
        );
      }

      const rnc = await this.prisma.$transaction(async (tx) => {
        if (causeResponsibleChanged && currentCauseAssignment) {
          await tx.rncAssignment.update({
            where: { id: currentCauseAssignment.id },
            data: { assignedToId: nextCauseResponsible!.id },
          });
        }

        return tx.rnc.update({
          where: { id },
          data: {
            nonConformityAnalysis: dto.nonConformityAnalysis.trim(),
            similarNonconformities: dto.similarNonconformities,
            similarNonconformitiesComment:
              dto.similarNonconformitiesComment?.trim() || null,
            history: {
              create: {
                actorId,
                action: RncHistoryAction.UPDATED_PROGRESS,
                note: causeResponsibleChanged
                  ? `Responsavel pela analise de causa e plano de acao alterado de ${currentCauseAssignment?.assignedTo?.name || 'responsavel anterior'} para ${nextCauseResponsible!.name}; andamento e registros existentes preservados`
                  : 'Tratamento inicial atualizado pelo responsavel da etapa',
              },
            },
          },
          include: includeRncRelations,
        });
      });

      if (causeResponsibleChanged && nextCauseResponsible) {
        this.notifyUsers([nextCauseResponsible.id], {
          title: 'RNC Interna para analise de causa',
          body: `A analise de causa e o plano de acao da RNC #${rnc.number} foram atribuidos a voce.`,
          data: this.notificationData(rnc.id),
        });
        await this.sendInternalRncTaskEmail(rnc, nextCauseResponsible, {
          subject: `RNC #${rnc.number} - analise de causa atribuida a voce`,
          title: 'Analise de causa e plano de acao',
          description:
            'Voce foi definido como responsavel pela analise de causa e pelo plano de acao desta RNC Interna. O andamento e os registros ja realizados foram preservados.',
        });
      }

      return this.serialize(rnc);
    }

    if (typeof dto.needsCorrectiveActionPlan !== 'boolean') {
      throw new BadRequestException(
        'Informe se precisa de plano de acao corretiva',
      );
    }

    const causeAnalysisResponsibleUserId = dto.needsCorrectiveActionPlan
      ? trimRequired(
          dto.causeAnalysisResponsibleUserId,
          'Responsavel pela analise de causa',
        )
      : null;
    const causeAnalysisResponsible = causeAnalysisResponsibleUserId
      ? await this.prisma.user.findFirst({
          where: {
            id: causeAnalysisResponsibleUserId,
            active: true,
            role: { notIn: ['motorista', 'operador'] },
          },
          select: { id: true, name: true, email: true, role: true },
        })
      : null;

    if (causeAnalysisResponsibleUserId && !causeAnalysisResponsible) {
      throw new BadRequestException(
        'Selecione um usuario ativo do Sistema JR para a analise de causa',
      );
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: dto.needsCorrectiveActionPlan
          ? RncStatus.AWAITING_CAUSE_ANALYSIS
          : RncStatus.RESPONSIBLE_ACTION_COMPLETED,
        nonConformityAnalysis: dto.nonConformityAnalysis.trim(),
        similarNonconformities: dto.similarNonconformities,
        similarNonconformitiesComment:
          dto.similarNonconformitiesComment?.trim() || null,
        needsCorrectiveActionPlan: dto.needsCorrectiveActionPlan,
        causeInvestigation: null,
        identifiedCauses: null,
        rootCause: null,
        causeFishbone: Prisma.DbNull,
        causeFiveWhys: Prisma.DbNull,
        correctiveActions: {
          deleteMany: {},
        },
        ...(causeAnalysisResponsibleUserId
          ? {
              assignments: {
                create: {
                  assignedById: actorId,
                  assignedToId: causeAnalysisResponsibleUserId,
                  reason: RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON,
                  status: RncAssignmentStatus.PENDING,
                },
              },
            }
          : {}),
        history: {
          create: {
            actorId,
            action: RncHistoryAction.CORRECTIVE_PLAN_DECIDED,
            note: dto.needsCorrectiveActionPlan
              ? `Plano corretivo necessario. Analise direcionada para ${causeAnalysisResponsible?.name || 'responsavel selecionado'}`
              : 'Plano corretivo nao necessario. Encaminhada para verificacao de eficacia',
          },
        },
      },
      include: includeRncRelations,
    });

    if (causeAnalysisResponsibleUserId) {
      this.notifyUsers([causeAnalysisResponsibleUserId], {
        title: 'RNC Interna para analise de causa',
        body: `RNC #${rnc.number} precisa da sua analise de causa e plano de acao.`,
        data: this.notificationData(rnc.id),
      });
      await this.sendInternalRncTaskEmail(rnc, causeAnalysisResponsible!, {
        subject: `RNC #${rnc.number} - analise de causa sob sua responsabilidade`,
        title: 'Analise de causa e plano de acao',
        description:
          'Voce foi indicado como responsavel pela analise de causa desta RNC Interna. Acesse o Sistema JR para preencher a investigacao, a causa raiz e o plano de acao.',
      });
    } else {
      this.notifyUsers([existing.engineerId], {
        title: 'RNC Interna para verificacao de eficacia',
        body: `RNC #${rnc.number} nao precisa de plano corretivo e voltou para sua verificacao.`,
        data: this.notificationData(rnc.id),
      });
    }

    return this.serialize(rnc);
  }

  async submitCauseAnalysis(
    id: string,
    dto: SubmitRncCauseAnalysisDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    if (existing.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Analise de causa se aplica apenas a RNC Interna',
      );
    }
    const isInitialSubmission =
      existing.status === RncStatus.AWAITING_CAUSE_ANALYSIS;
    const canEditSavedStage: boolean = [
      RncStatus.RESPONSIBLE_ACTION_COMPLETED,
      RncStatus.COMPLETED,
    ].some((status) => status === existing.status);
    if (!isInitialSubmission && !canEditSavedStage) {
      throw new BadRequestException(
        'Esta etapa da RNC nao pode ser editada no status atual',
      );
    }

    const actorAssignment = existing.assignments.find(
      (item) =>
        item.assignedToId === actorId &&
        item.status !== RncAssignmentStatus.CANCELLED &&
        item.reason === RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON,
    );
    const canTestAnyInternalStage =
      isConsultantRole(actorRole) ||
      ['admin', 'administrador'].includes(normalizeRole(actorRole));
    const assignment =
      actorAssignment ||
      (canTestAnyInternalStage
        ? existing.assignments.find(
            (item) =>
              item.status !== RncAssignmentStatus.CANCELLED &&
              item.reason === RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON,
          )
        : undefined);
    if (!assignment && !canTestAnyInternalStage) {
      throw new ForbiddenException(
        'Somente o responsavel indicado pode preencher a analise de causa',
      );
    }

    const rootCause = trimRequired(dto.rootCause, 'Causa raiz');
    const fishbone = normalizeFishbone(dto.fishbone);
    const fiveWhys = normalizeFiveWhys(dto.fiveWhys);

    if (!isInitialSubmission) {
      const rnc = await this.prisma.$transaction(async (tx) => {
        if (assignment) {
          await tx.rncAssignment.update({
            where: { id: assignment.id },
            data: { response: rootCause },
          });
        }

        return tx.rnc.update({
          where: { id },
          data: {
            causeInvestigation: trimOptional(dto.causeInvestigation),
            identifiedCauses: trimOptional(dto.identifiedCauses),
            rootCause,
            causeFishbone: fishbone,
            causeFiveWhys: fiveWhys,
            history: {
              create: {
                actorId,
                action: RncHistoryAction.UPDATED_PROGRESS,
                note: 'Analise de causa atualizada pelo responsavel da etapa',
              },
            },
          },
          include: includeRncRelations,
        });
      });

      return this.serialize(rnc);
    }

    const actionDrafts = (dto.correctiveActions || [])
      .map((action) => ({
        description: action.description?.trim() || '',
        responsibleUserId: action.responsibleUserId?.trim() || '',
        dueDate: action.dueDate
          ? parseDate(action.dueDate, 'Prazo da acao corretiva')
          : null,
        situation: action.situation?.trim() || 'Pendente',
      }))
      .filter(
        (action) =>
          action.description ||
          action.responsibleUserId ||
          Boolean(action.dueDate),
      );

    actionDrafts.forEach((action) => {
      if (!action.description) {
        throw new BadRequestException(
          'Descricao da acao corretiva obrigatoria',
        );
      }
      if (!action.responsibleUserId) {
        throw new BadRequestException(
          'Responsavel da acao corretiva obrigatorio',
        );
      }
      if (!action.dueDate) {
        throw new BadRequestException('Prazo da acao corretiva obrigatorio');
      }
      if (!RNC_CORRECTIVE_ACTION_STATUS_OPTIONS.includes(action.situation)) {
        throw new BadRequestException('Situacao da acao corretiva invalida');
      }
      if (action.situation.toLowerCase().startsWith('conclu')) {
        throw new BadRequestException(
          'A conclusao da acao deve ser registrada depois, com descricao da execucao e evidencia',
        );
      }
    });

    const responsibleIds = [
      ...new Set(actionDrafts.map((action) => action.responsibleUserId)),
    ];
    const responsibleUsers = responsibleIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: responsibleIds },
            active: true,
            role: { notIn: ['motorista', 'operador'] },
          },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const responsibleUsersById = new Map(
      responsibleUsers.map((user) => [user.id, user]),
    );
    if (responsibleUsers.length !== responsibleIds.length) {
      throw new BadRequestException(
        'Todas as acoes devem ter um usuario ativo do Sistema JR como responsavel',
      );
    }

    const actions = actionDrafts.map((action, index) => ({
      ...action,
      responsible: responsibleUsersById.get(action.responsibleUserId)!.name,
      sequence: index + 1,
    }));

    const rnc = await this.prisma.$transaction(async (tx) => {
      if (assignment) {
        await tx.rncAssignment.update({
          where: { id: assignment.id },
          data: {
            response: rootCause,
            status: RncAssignmentStatus.ANSWERED,
            respondedAt: new Date(),
          },
        });
      }

      return tx.rnc.update({
        where: { id },
        data: {
          status: RncStatus.RESPONSIBLE_ACTION_COMPLETED,
          causeInvestigation: trimOptional(dto.causeInvestigation),
          identifiedCauses: trimOptional(dto.identifiedCauses),
          rootCause,
          causeFishbone: fishbone,
          causeFiveWhys: fiveWhys,
          correctiveActions: {
            deleteMany: {},
            create: actions,
          },
          history: {
            create: {
              actorId,
              action: RncHistoryAction.CAUSE_ANALYSIS_SUBMITTED,
              note: actions.length
                ? 'Analise de causa concluida e plano de acao iniciado'
                : 'Analise de causa concluida sem acoes corretivas pendentes',
            },
          },
        },
        include: includeRncRelations,
      });
    });

    this.notifyUsers([existing.engineerId], {
      title: actions.length
        ? 'Plano de acao corretiva registrado'
        : 'RNC Interna para verificacao de eficacia',
      body: actions.length
        ? `RNC #${rnc.number} recebeu um plano de acao. A verificacao de eficacia sera liberada quando todas as acoes forem concluidas com registro e evidencia.`
        : `RNC #${rnc.number} concluiu a analise de causa e voltou para sua verificacao.`,
      data: this.notificationData(rnc.id),
    });

    for (const user of responsibleUsers) {
      const userActions = actions.filter(
        (action) => action.responsibleUserId === user.id,
      );
      this.notifyUsers([user.id], {
        title: 'Nova acao corretiva sob sua responsabilidade',
        body: `Voce recebeu ${userActions.length} acao(oes) no plano da RNC #${rnc.number}.`,
        data: this.notificationData(rnc.id),
      });
      await this.sendInternalRncTaskEmail(rnc, user, {
        subject: `RNC #${rnc.number} - ${userActions.length} acao(oes) corretiva(s) atribuida(s)`,
        title: 'Plano de acao corretiva',
        description:
          'Voce foi indicado como responsavel pelas acoes abaixo. Acesse a RNC Comigo no Sistema JR para acompanhar, registrar a execucao e anexar as evidencias.',
        items: userActions.map(
          (action) =>
            `Acao ${action.sequence}: ${action.description} - prazo ${formatDateTime(action.dueDate!)}`,
        ),
      });
    }

    return this.serialize(rnc);
  }

  async reviewEffectiveness(
    id: string,
    dto: ReviewRncEffectivenessDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);

    if (existing.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Revisao de eficacia se aplica apenas a RNC Interna',
      );
    }

    const isEditingCompletedReview = existing.status === RncStatus.COMPLETED;
    if (
      existing.status !== RncStatus.RESPONSIBLE_ACTION_COMPLETED &&
      !isEditingCompletedReview
    ) {
      throw new BadRequestException(
        'Esta RNC ainda nao voltou do responsavel para revisao',
      );
    }
    if (existing.engineerId !== actorId && !isConsultantRole(actorRole)) {
      throw new ForbiddenException(
        'Somente o emitente pode realizar a verificacao de eficacia',
      );
    }

    const pendingCorrectiveActions = existing.correctiveActions.filter(
      (action) =>
        !action.situation.toLowerCase().startsWith('conclu') &&
        !action.situation.toLowerCase().startsWith('cancel'),
    );
    if (pendingCorrectiveActions.length > 0) {
      throw new BadRequestException(
        'Conclua as acoes corretivas com registro e evidencia antes da verificacao de eficacia',
      );
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: RncStatus.COMPLETED,
        actionsEffective: dto.actionsEffective,
        actionsEffectiveNotes: dto.actionsEffectiveNotes?.trim() || null,
        requiresDocumentChange: dto.requiresDocumentChange,
        requiresDocumentChangeNotes:
          dto.requiresDocumentChangeNotes?.trim() || null,
        requiresRiskReview: dto.requiresRiskReview,
        requiresRiskReviewNotes: dto.requiresRiskReviewNotes?.trim() || null,
        effectivenessReviewedAt: new Date(),
        effectivenessReviewedById: actorId,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.EFFECTIVENESS_REVIEWED,
            note: isEditingCompletedReview
              ? 'Verificacao de eficacia atualizada pelo emitente'
              : 'Verificacao de eficacia concluida pelo emitente',
          },
        },
      },
      include: includeRncRelations,
    });

    if (!isEditingCompletedReview) {
      this.notifyUsers(
        [
          existing.responsibleUserId,
          ...existing.assignments.map((assignment) => assignment.assignedToId),
        ].filter((userId): userId is string => !!userId),
        {
          title: 'RNC Interna finalizada',
          body: `RNC #${rnc.number} teve a revisao final concluida.`,
          data: this.notificationData(rnc.id),
        },
      );
    }

    return this.serialize(rnc);
  }

  async markSystemItemIncluded(
    id: string,
    actorId?: string | null,
    actorRole?: string | null,
    itemId?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    if (!this.canIncludeSystemItem(normalizeRole(actorRole))) {
      throw new ForbiddenException(
        'Sem permissao para incluir item no sistema',
      );
    }

    const existing = await this.getRnc(id);

    if (!existing.colocarItemSistema) {
      throw new BadRequestException(
        'Esta RNC nao possui item para incluir no sistema',
      );
    }

    if (existing.status !== RncStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Item so pode ser marcado apos aprovacao do gestor',
      );
    }

    if (existing.items.length > 0) {
      const targetItem = itemId
        ? existing.items.find((item) => item.id === itemId)
        : existing.items.find((item) => item.status !== 'INCLUDED');

      if (!targetItem) {
        throw new BadRequestException(
          itemId
            ? 'Item da RNC nao encontrado'
            : 'Todos os itens ja foram marcados como incluidos',
        );
      }

      if (targetItem.status === 'INCLUDED') {
        throw new BadRequestException('Item ja foi marcado como incluido');
      }

      const allIncludedAfterThis = existing.items.every(
        (item) => item.id === targetItem.id || item.status === 'INCLUDED',
      );

      const rnc = await this.prisma.$transaction(async (tx) => {
        await tx.rncItem.update({
          where: { id: targetItem.id },
          data: {
            status: 'INCLUDED',
            includedAt: new Date(),
            includedById: actorId,
          },
        });

        return tx.rnc.update({
          where: { id },
          data: {
            systemItemStatus: allIncludedAfterThis ? 'INCLUDED' : 'PENDING',
            systemItemIncludedAt: allIncludedAfterThis ? new Date() : null,
            systemItemIncludedById: allIncludedAfterThis ? actorId : null,
            history: {
              create: {
                actorId,
                action: RncHistoryAction.UPDATED_PROGRESS,
                note: `Item "${targetItem.description}" marcado como incluido no sistema pelo Administrativo`,
              },
            },
          },
          include: includeRncRelations,
        });
      });

      return this.serialize(rnc);
    }

    if (existing.systemItemStatus === 'INCLUDED') {
      throw new BadRequestException('Item ja foi marcado como incluido');
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        systemItemStatus: 'INCLUDED',
        systemItemIncludedAt: new Date(),
        systemItemIncludedById: actorId,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.UPDATED_PROGRESS,
            note: 'Item marcado como incluido no sistema pelo Administrativo',
          },
        },
      },
      include: includeRncRelations,
    });

    return this.serialize(rnc);
  }

  async finalize(
    id: string,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    if (!this.canIncludeSystemItem(normalizeRole(actorRole))) {
      throw new ForbiddenException('Somente Administrativo pode finalizar RNC');
    }

    const existing = await this.getRnc(id);

    if (existing.type !== RncType.WORK) {
      throw new BadRequestException(
        'Somente RNC de Obra pode ser finalizada pelo Administrativo',
      );
    }

    if (existing.status !== RncStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Somente RNC de Obra aprovada pode ser finalizada',
      );
    }

    const hasPendingSystemItems =
      existing.items.length > 0
        ? existing.items.some((item) => item.status !== 'INCLUDED')
        : existing.colocarItemSistema &&
          existing.systemItemStatus !== 'INCLUDED';

    if (hasPendingSystemItems) {
      throw new BadRequestException(
        'Inclua todos os itens no sistema antes de finalizar a RNC',
      );
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: RncStatus.COMPLETED,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.UPDATED_PROGRESS,
            note: 'RNC finalizada pelo Administrativo',
          },
        },
      },
      include: includeRncRelations,
    });

    return this.serialize(rnc);
  }

  async direct(
    id: string,
    dto: DirectRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureManager(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    this.ensureCanDirect(existing);

    const assignedToId = trimRequired(dto.assignedToId, 'Responsavel');
    const reason = trimRequired(dto.reason, 'Motivo do direcionamento');
    const assignedTo = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    if (!assignedTo) {
      throw new NotFoundException('Usuario direcionado nao encontrado');
    }

    const assignedToRole = normalizeRole(assignedTo.role);
    if (!this.canAnswerDirectedRnc(assignedToRole)) {
      throw new BadRequestException(
        'Este perfil nao pode receber direcionamento de RNC',
      );
    }

    const note = `Direcionado para ${assignedTo.name}: ${reason}`;

    const rnc = await this.prisma.$transaction(async (tx) => {
      await tx.rncAssignment.updateMany({
        where: {
          rncId: id,
          status: RncAssignmentStatus.PENDING,
        },
        data: {
          status: RncAssignmentStatus.CANCELLED,
        },
      });

      return tx.rnc.update({
        where: { id },
        data: {
          status: RncStatus.AWAITING_CAUSER_EXPLANATION,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewReason: null,
          assignments: {
            create: {
              assignedById: actorId,
              assignedToId,
              reason,
              status: RncAssignmentStatus.PENDING,
            },
          },
          history: {
            create: {
              actorId,
              action: RncHistoryAction.DIRECTED,
              note,
            },
          },
        },
        include: includeRncRelations,
      });
    });

    this.notifyUsers([assignedToId], {
      title: 'RNC direcionada para você',
      body: `RNC #${rnc.number} precisa da sua explicação.`,
      data: this.notificationData(rnc.id),
    });

    await this.sendAssignmentEmailIfEnabled(rnc, assignedTo);

    return this.serialize(rnc);
  }

  async updateInvestigation(
    id: string,
    dto: UpdateRncInvestigationDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureManager(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    const requiresInvestigation = dto.requiresInvestigation === true;

    if (existing.requiresInvestigation === requiresInvestigation) {
      return this.serialize(existing);
    }

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        requiresInvestigation,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.INVESTIGATION_UPDATED,
            note: requiresInvestigation
              ? 'Gestor marcou que esta RNC necessita investigação'
              : 'Gestor removeu a marcação de investigação da RNC',
          },
        },
      },
      include: includeRncRelations,
    });

    return this.serialize(rnc);
  }

  async attachFile(
    id: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);

    const uploaded = await this.s3UploadService.uploadFile(file, 'rnc');
    const fileName = trimRequired(file.originalname, 'Nome do arquivo');

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        attachments: {
          create: {
            fileName,
            fileUrl: uploaded.url,
            fileKey: uploaded.key,
            mimeType: file.mimetype || null,
            sizeBytes: file.size ?? null,
            uploadedById: actorId,
          },
        },
        history: {
          create: {
            actorId,
            action: RncHistoryAction.ATTACHMENT_ADDED,
            note: `Anexo adicionado: ${fileName}`,
          },
        },
      },
      include: includeRncRelations,
    });

    return this.serialize(rnc);
  }

  async deleteAttachment(
    id: string,
    attachmentId: string,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);
    this.ensureRncRecordCanLoseFiles(current);

    const attachment = current.attachments.find(
      (item) => item.id === attachmentId,
    );

    if (!attachment) {
      throw new NotFoundException('Anexo nao encontrado');
    }

    if (attachment.uploadedById !== actorId) {
      throw new ForbiddenException(
        'Somente quem anexou pode excluir este arquivo',
      );
    }

    await this.prisma.rncAttachment.delete({
      where: { id: attachmentId },
    });

    await this.s3UploadService.deleteFile(attachment.fileKey);

    const rnc = await this.getRnc(id);
    return this.serialize(rnc);
  }

  async attachCorrectiveActionEvidence(
    id: string,
    actionId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);

    if (current.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Evidencia de acao se aplica apenas a RNC Interna',
      );
    }

    const action = current.correctiveActions.find(
      (item) => item.id === actionId,
    );
    if (!action) {
      throw new NotFoundException('Acao corretiva nao encontrada');
    }
    this.ensureCorrectiveActionParticipant(
      current,
      action,
      actorId,
      actorRole,
    );
    if (action.situation.toLowerCase().startsWith('conclu')) {
      throw new BadRequestException(
        'Nao e possivel alterar evidencias de uma acao ja concluida',
      );
    }

    const uploaded = await this.s3UploadService.uploadFile(
      file,
      'rnc/corrective-actions',
    );
    const fileName = trimRequired(file.originalname, 'Nome do arquivo');

    await this.prisma.$transaction([
      this.prisma.rncAttachment.create({
        data: {
          rncId: id,
          correctiveActionId: actionId,
          fileName,
          fileUrl: uploaded.url,
          fileKey: uploaded.key,
          mimeType: file.mimetype || null,
          sizeBytes: file.size ?? null,
          uploadedById: actorId,
        },
      }),
      this.prisma.rncHistory.create({
        data: {
          rncId: id,
          actorId,
          action: RncHistoryAction.ATTACHMENT_ADDED,
          note: `Evidencia adicionada na acao corretiva: ${fileName}`,
        },
      }),
    ]);

    return this.serialize(await this.getRnc(id));
  }

  async deleteCorrectiveActionEvidence(
    id: string,
    actionId: string,
    attachmentId: string,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);
    this.ensureRncRecordCanLoseFiles(current);

    const action = current.correctiveActions.find(
      (item) => item.id === actionId,
    );
    if (!action) {
      throw new NotFoundException('Acao corretiva nao encontrada');
    }
    this.ensureCorrectiveActionParticipant(
      current,
      action,
      actorId,
      actorRole,
    );
    if (action.situation.toLowerCase().startsWith('conclu')) {
      throw new BadRequestException(
        'Nao e possivel alterar evidencias de uma acao ja concluida',
      );
    }

    const attachment = action.evidence.find((item) => item.id === attachmentId);
    if (!attachment) {
      throw new NotFoundException('Evidencia nao encontrada');
    }
    if (attachment.uploadedById !== actorId) {
      throw new ForbiddenException(
        'Somente quem anexou pode excluir esta evidencia',
      );
    }

    await this.prisma.rncAttachment.delete({
      where: { id: attachmentId },
    });
    await this.s3UploadService.deleteFile(attachment.fileKey);

    return this.serialize(await this.getRnc(id));
  }

  async updateCorrectiveAction(
    id: string,
    actionId: string,
    dto: UpdateRncCorrectiveActionDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);

    if (current.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Edicao de acao se aplica apenas a RNC Interna',
      );
    }
    if (current.status !== RncStatus.RESPONSIBLE_ACTION_COMPLETED) {
      throw new BadRequestException(
        'As acoes so podem ser editadas durante a execucao do plano',
      );
    }

    const action = current.correctiveActions.find(
      (item) => item.id === actionId,
    );
    if (!action) {
      throw new NotFoundException('Acao corretiva nao encontrada');
    }
    this.ensureCorrectiveActionParticipant(
      current,
      action,
      actorId,
      actorRole,
      true,
    );
    if (
      action.situation.toLowerCase().startsWith('conclu') ||
      action.situation.toLowerCase().startsWith('cancel')
    ) {
      throw new BadRequestException(
        'Acoes concluidas ou canceladas nao podem mais ser editadas',
      );
    }

    const description = trimRequired(dto.description, 'Descricao da acao');
    const responsibleUserId = trimRequired(
      dto.responsibleUserId,
      'Responsavel da acao',
    );
    const responsibleUser = await this.prisma.user.findFirst({
      where: {
        id: responsibleUserId,
        active: true,
        role: { notIn: ['motorista', 'operador'] },
      },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!responsibleUser) {
      throw new BadRequestException(
        'Selecione um usuario ativo do Sistema JR como responsavel',
      );
    }
    const dueDate = parseDate(dto.dueDate, 'Prazo da acao corretiva');
    const situation = trimRequired(dto.situation, 'Situacao da acao');
    if (!['Pendente', 'Em andamento', 'Cancelada'].includes(situation)) {
      throw new BadRequestException(
        'Para concluir a acao, use o registro de execucao e evidencia',
      );
    }

    await this.prisma.$transaction([
      this.prisma.rncCorrectiveAction.update({
        where: { id: actionId },
        data: {
          description,
          responsible: responsibleUser.name,
          responsibleUserId: responsibleUser.id,
          dueDate,
          situation,
        },
      }),
      this.prisma.rncHistory.create({
        data: {
          rncId: id,
          actorId,
          action: RncHistoryAction.UPDATED_PROGRESS,
          note: `Acao corretiva atualizada: ${description} - Situacao: ${situation}`,
        },
      }),
    ]);

    const updatedRnc = await this.getRnc(id);
    if (action.responsibleUserId !== responsibleUser.id) {
      this.notifyUsers([responsibleUser.id], {
        title: 'Acao corretiva atribuida a voce',
        body: `A acao ${action.sequence} da RNC #${updatedRnc.number} agora esta sob sua responsabilidade.`,
        data: this.notificationData(updatedRnc.id),
      });
      await this.sendInternalRncTaskEmail(updatedRnc, responsibleUser, {
        subject: `RNC #${updatedRnc.number} - acao corretiva atribuida a voce`,
        title: 'Acao corretiva atribuida',
        description:
          'Esta acao passou a ficar sob sua responsabilidade. Acesse a RNC Comigo no Sistema JR para acompanhar e registrar a execucao.',
        items: [
          `Acao ${action.sequence}: ${description} - prazo ${formatDateTime(dueDate)}`,
        ],
      });
    }
    if (
      situation.toLowerCase().startsWith('cancel') &&
      this.correctiveActionsAreResolved(updatedRnc.correctiveActions)
    ) {
      this.notifyEffectivenessReady(updatedRnc);
    }

    return this.serialize(updatedRnc);
  }

  async completeCorrectiveAction(
    id: string,
    actionId: string,
    dto: CompleteRncCorrectiveActionDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const current = await this.getRnc(id);
    this.ensureCanRead(current, actorRole, actorId);

    if (current.type !== RncType.INTERNAL) {
      throw new BadRequestException(
        'Conclusao de acao se aplica apenas a RNC Interna',
      );
    }
    if (
      (
        [
          RncStatus.CANCELLED,
          RncStatus.REJECTED,
          RncStatus.COMPLETED,
        ] as RncStatus[]
      ).includes(current.status)
    ) {
      throw new BadRequestException(
        'Esta RNC nao permite mais concluir acoes corretivas',
      );
    }

    const action = current.correctiveActions.find(
      (item) => item.id === actionId,
    );
    if (!action) {
      throw new NotFoundException('Acao corretiva nao encontrada');
    }
    this.ensureCorrectiveActionParticipant(
      current,
      action,
      actorId,
      actorRole,
    );
    if (action.situation.toLowerCase().startsWith('conclu')) {
      throw new BadRequestException('Esta acao corretiva ja foi concluida');
    }
    if (action.situation.toLowerCase().startsWith('cancel')) {
      throw new BadRequestException(
        'Uma acao cancelada nao pode ser marcada como concluida',
      );
    }

    const executionNotes = trimRequired(
      dto.executionNotes,
      'Registro do que foi executado',
    );
    if (action.evidence.length === 0) {
      throw new BadRequestException(
        'Anexe pelo menos uma evidencia antes de concluir a acao',
      );
    }

    const completedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.rncCorrectiveAction.update({
        where: { id: actionId },
        data: {
          situation: 'Concluida',
          executionNotes,
          completedAt,
          completedById: actorId,
        },
      }),
      this.prisma.rncHistory.create({
        data: {
          rncId: id,
          actorId,
          action: RncHistoryAction.CORRECTIVE_ACTION_COMPLETED,
          note: `Acao corretiva concluida: ${action.description}`,
        },
      }),
    ]);

    const updatedRnc = await this.getRnc(id);
    if (this.correctiveActionsAreResolved(updatedRnc.correctiveActions)) {
      this.notifyEffectivenessReady(updatedRnc);
    }

    return this.serialize(updatedRnc);
  }

  private correctiveActionsAreResolved(actions: Array<{ situation: string }>) {
    return actions.every((action) => {
      const situation = action.situation.toLowerCase();
      return situation.startsWith('conclu') || situation.startsWith('cancel');
    });
  }

  private notifyEffectivenessReady(rnc: {
    id: string;
    number: number;
    engineerId: string;
  }) {
    this.notifyUsers([rnc.engineerId], {
      title: 'RNC Interna pronta para avaliacao de eficacia',
      body: `Todas as acoes da RNC #${rnc.number} foram concluidas ou canceladas. A avaliacao de eficacia esta liberada.`,
      data: this.notificationData(rnc.id),
    });
  }

  private ensureCorrectiveActionParticipant(
    rnc: RncWithRelations,
    action: RncWithRelations['correctiveActions'][number],
    actorId: string,
    actorRole?: string | null,
    allowCauseAnalysisOwner = false,
  ) {
    const role = normalizeRole(actorRole);
    if (
      isConsultantRole(role) ||
      role === 'admin' ||
      role === 'administrador'
    ) {
      return;
    }

    if (action.responsibleUserId === actorId) {
      return;
    }

    const isCauseAnalysisOwner = rnc.assignments.some(
      (assignment) =>
        assignment.assignedToId === actorId &&
        assignment.status !== RncAssignmentStatus.CANCELLED &&
        assignment.reason === RNC_CAUSE_ANALYSIS_ASSIGNMENT_REASON,
    );
    if (allowCauseAnalysisOwner && isCauseAnalysisOwner) {
      return;
    }

    // Compatibilidade: acoes antigas ainda sem ID continuam operaveis pelo
    // responsavel da analise ate serem associadas a um usuario no primeiro edit.
    if (!action.responsibleUserId && isCauseAnalysisOwner) {
      return;
    }

    throw new ForbiddenException(
      allowCauseAnalysisOwner
        ? 'Somente o responsavel da acao ou da analise de causa pode editar esta acao'
        : 'Somente o usuario responsavel pela acao pode registrar sua execucao',
    );
  }

  async respondAssignment(
    id: string,
    dto: AnswerRncAssignmentDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    if (!this.canAnswerDirectedRnc(normalizeRole(actorRole))) {
      throw new ForbiddenException('Sem permissao para responder RNC');
    }

    const response = trimRequired(dto.response, 'Explicacao');
    const existing = await this.getRnc(id);
    const assignment = existing.assignments.find(
      (item) =>
        item.assignedToId === actorId &&
        item.status === RncAssignmentStatus.PENDING,
    );

    if (!assignment) {
      throw new ForbiddenException(
        'Esta RNC nao esta direcionada para este usuario',
      );
    }

    if (existing.status !== RncStatus.AWAITING_CAUSER_EXPLANATION) {
      throw new BadRequestException(
        'Esta RNC nao esta aguardando explicacao do causador',
      );
    }

    const rnc = await this.prisma.$transaction(async (tx) => {
      await tx.rncAssignment.update({
        where: { id: assignment.id },
        data: {
          response,
          status: RncAssignmentStatus.ANSWERED,
          respondedAt: new Date(),
        },
      });

      return tx.rnc.update({
        where: { id },
        data: {
          status: RncStatus.CAUSER_EXPLANATION_RECEIVED,
          history: {
            create: {
              actorId,
              action: RncHistoryAction.EXPLANATION_SUBMITTED,
              note: response,
            },
          },
        },
        include: includeRncRelations,
      });
    });

    this.notifyRoles(['gestor'], {
      title: 'Explicação recebida em RNC',
      body: `RNC #${rnc.number} recebeu uma explicação e voltou para decisão.`,
      data: this.notificationData(rnc.id),
    });

    await this.sendManagerReviewEmailIfEnabled(rnc);

    return this.serialize(rnc);
  }

  async reject(
    id: string,
    dto: ReviewRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureManager(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    this.ensureManagerReviewable(existing);
    const reason = trimRequired(dto.reason, 'Motivo da reprovacao');

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: RncStatus.REJECTED,
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewReason: reason,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.REJECTED,
            note: reason,
          },
        },
      },
      include: includeRncRelations,
    });

    this.notifyUsers([existing.engineerId], {
      title: 'RNC reprovada',
      body: `RNC #${rnc.number} foi reprovada pelo gestor.`,
      data: this.notificationData(rnc.id),
    });

    return this.serialize(rnc);
  }

  async returnForAdjustment(
    id: string,
    dto: ReviewRncDto,
    actorId?: string | null,
    actorRole?: string | null,
  ) {
    this.ensureManager(actorRole);
    if (!actorId) {
      throw new BadRequestException('Usuario autenticado nao encontrado');
    }

    const existing = await this.getRnc(id);
    this.ensureManagerReviewable(existing);
    const reason = trimRequired(dto.reason, 'Motivo da devolucao');

    const rnc = await this.prisma.rnc.update({
      where: { id },
      data: {
        status: RncStatus.RETURNED_FOR_ADJUSTMENT,
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewReason: reason,
        history: {
          create: {
            actorId,
            action: RncHistoryAction.RETURNED,
            note: reason,
          },
        },
      },
      include: includeRncRelations,
    });

    this.notifyUsers([existing.engineerId], {
      title: 'RNC devolvida para ajuste',
      body: `RNC #${rnc.number} precisa de ajuste antes de nova análise.`,
      data: this.notificationData(rnc.id),
    });

    return this.serialize(rnc);
  }

  private async buildInitialData(dto: CreateRncDto): Promise<InitialRncBuild> {
    const type = normalizeRncType(dto.type, dto);

    if (type === RncType.WORK) {
      return this.buildInternalInitialData(dto);
    }

    if (type === RncType.INTERNAL) {
      return {
        data: this.buildNewInternalInitialData(dto),
        items: [],
      };
    }

    return {
      data: this.buildExternalInitialData(dto),
      items: [],
    };
  }

  private buildExternalInitialData(dto: CreateRncDto): InitialRncData {
    const cliente = trimRequired(dto.cliente, 'Cliente');
    const obra = trimRequired(dto.obra, 'Obra');

    if (!/^\d+$/.test(obra)) {
      throw new BadRequestException('Obra deve conter somente numeros');
    }

    const dataEntrada = parseDate(dto.dataEntrada, 'Data entrada');
    const dataLimiteRetorno = dto.dataLimiteRetorno
      ? parseDate(dto.dataLimiteRetorno, 'Data limite de retorno')
      : addDays(dataEntrada, 30);

    return {
      type: RncType.EXTERNAL,
      cliente,
      obra,
      obraDescricao: null,
      responsavel: normalizeEngineerName(
        trimRequired(dto.responsavel, 'Responsavel'),
      ),
      dataEntrada,
      dataLimiteRetorno,
      etapaObra: trimRequired(dto.etapaObra, 'Etapa da obra'),
      enquadramentoMotivo: trimRequired(
        dto.enquadramentoMotivo,
        'Enquadramento de motivo',
      ),
      valorRetidoInicial: parseRequiredDecimal(
        dto.valorRetidoInicial,
        'Valor retido inicial',
      ),
      respondido: false,
      planoAcaoSolucao: null,
      status: RncStatus.PENDING_MANAGER_APPROVAL,
      valorRetido: null,
      dataAssinatura: null,
      obs: null,
      reviewedById: null,
      reviewedAt: null,
      reviewReason: null,
      justificativasObservacoes: trimOptional(dto.justificativasObservacoes),
      internalMotivo: null,
      internalCausador: null,
      internalNomeColaborador: null,
      valorNc: null,
      colocarItemSistema: false,
      internalCodigoItem: null,
      internalDescricao: null,
      internalQuantidade: null,
      internalUnidadeMedida: null,
      internalValorUnitario: null,
      internalValorTotal: null,
      systemItemStatus: 'NOT_REQUIRED',
      systemItemIncludedAt: null,
      systemItemIncludedById: null,
      photoUrl: null,
    };
  }

  private async buildInternalItemData(dto: CreateRncDto, enabled: boolean) {
    if (!enabled) return [];

    const rawItems =
      Array.isArray(dto.internalItems) && dto.internalItems.length > 0
        ? dto.internalItems
        : [
            {
              code: dto.internalCodigoItem,
              description: dto.internalDescricao,
              quantity: dto.internalQuantidade,
              unit: dto.internalUnidadeMedida,
              unitValue: dto.internalValorUnitario,
            },
          ];

    if (rawItems.length > 30) {
      throw new BadRequestException('RNC permite no maximo 30 itens');
    }

    const codes = rawItems
      .map((item) => normalizeAethosItemCode(item?.code))
      .filter(Boolean);
    const itemCatalog = codes.length
      ? await this.prisma.aethosItem.findMany({
          where: {
            code: { in: [...new Set(codes)] },
            active: true,
          },
          select: {
            code: true,
            description: true,
            unit: true,
          },
        })
      : [];
    const itemByCode = new Map(itemCatalog.map((item) => [item.code, item]));

    return rawItems.map((item, index) => {
      const itemNumber = index + 1;
      const code = normalizeAethosItemCode(item?.code);
      if (!code) {
        throw new BadRequestException(
          `Codigo do item ${itemNumber} e obrigatorio`,
        );
      }
      const catalogItem = itemByCode.get(code);
      const description =
        catalogItem?.description ||
        trimRequired(item?.description, `Descricao do item ${itemNumber}`);
      const quantity = parseRequiredDecimal(
        item?.quantity,
        `Quantidade do item ${itemNumber}`,
      );
      let unit: string;
      try {
        unit = validateRncInternalUnit(item?.unit);
      } catch {
        throw new BadRequestException(
          `Unidade de medida do item ${itemNumber} invalido`,
        );
      }
      const unitValue = parseRequiredDecimal(
        item?.unitValue,
        `Valor unitario do item ${itemNumber}`,
      );

      return {
        code,
        description,
        quantity,
        unit,
        unitValue,
        totalValue: quantity.mul(unitValue),
        status: 'PENDING',
      };
    });
  }

  private async buildInternalInitialData(
    dto: CreateRncDto,
  ): Promise<InitialRncBuild> {
    const obra = trimRequired(dto.obra, 'Codigo da obra');
    if (!/^\d+$/.test(obra)) {
      throw new BadRequestException(
        'Codigo da obra deve conter somente numeros',
      );
    }
    const obraCatalog = await this.prisma.aethosObra.findUnique({
      where: { code: obra },
      select: { name: true },
    });
    const obraDescricao = trimOptional(dto.obraDescricao) || obraCatalog?.name;
    if (!obraDescricao) {
      throw new BadRequestException(
        'Nome da obra nao encontrado para o codigo informado',
      );
    }
    const internalMotivo = validateOption(dto.internalMotivo, 'Motivo', [
      'Não previsto',
      'Furto',
      'Danificado',
      'Seguro/Garantia',
      'Contingência',
    ]);
    const internalCausador = validateOption(dto.internalCausador, 'Causador', [
      'Colaborador JR',
      'Empreiteiro',
      'Cliente',
      'Externo',
      'Interno',
    ]);
    const internalNomeColaborador =
      internalCausador === 'Colaborador JR'
        ? trimRequired(dto.internalNomeColaborador, 'Nome colaborador')
        : null;
    const valorNc = parseRequiredDecimal(dto.valorNc, 'Valor da NC');
    const colocarItemSistema = dto.colocarItemSistema === true;
    const items = await this.buildInternalItemData(dto, colocarItemSistema);
    const firstItem = items[0];
    const dataEntrada = new Date();

    return {
      data: {
        type: RncType.WORK,
        cliente: 'JR Construcoes',
        obra,
        obraDescricao,
        responsavel: normalizeEngineerName(
          trimRequired(dto.responsavel, 'Responsavel'),
        ),
        dataEntrada,
        dataLimiteRetorno: addDays(dataEntrada, 30),
        etapaObra: 'RNC de Obra',
        enquadramentoMotivo: internalMotivo,
        valorRetidoInicial: valorNc,
        respondido: false,
        planoAcaoSolucao: null,
        status: RncStatus.PENDING_MANAGER_APPROVAL,
        valorRetido: null,
        dataAssinatura: null,
        obs: null,
        reviewedById: null,
        reviewedAt: null,
        reviewReason: null,
        justificativasObservacoes: trimOptional(dto.justificativasObservacoes),
        internalMotivo,
        internalCausador,
        internalNomeColaborador,
        valorNc,
        colocarItemSistema,
        internalCodigoItem: firstItem?.code ?? null,
        internalDescricao: firstItem?.description ?? null,
        internalQuantidade: firstItem?.quantity ?? null,
        internalUnidadeMedida: firstItem?.unit ?? null,
        internalValorUnitario: firstItem?.unitValue ?? null,
        internalValorTotal: firstItem?.totalValue ?? null,
        systemItemStatus: colocarItemSistema ? 'PENDING' : 'NOT_REQUIRED',
        systemItemIncludedAt: null,
        systemItemIncludedById: null,
        photoUrl: trimOptional(dto.photoUrl),
      },
      items,
    };
  }

  private buildNewInternalInitialData(dto: CreateRncDto): InitialRncData {
    const dataEntrada = new Date();
    const ncArea = validateOption(
      dto.ncArea,
      'Area',
      RNC_INTERNAL_AREA_OPTIONS,
    );
    const responsibleUserId = trimRequired(
      dto.responsibleUserId,
      'Responsavel',
    );
    const immediateDate = dto.immediateDate
      ? parseDate(dto.immediateDate, 'Data da reacao imediata')
      : null;

    return {
      type: RncType.INTERNAL,
      cliente: 'JR Construcoes',
      obra: 'Interna',
      obraDescricao: null,
      responsavel: trimOptional(dto.responsavel),
      dataEntrada,
      dataLimiteRetorno: addDays(dataEntrada, 30),
      etapaObra: 'RNC Interna',
      enquadramentoMotivo: ncArea,
      valorRetidoInicial: new Prisma.Decimal(0),
      respondido: false,
      planoAcaoSolucao: null,
      status: RncStatus.AWAITING_RESPONSIBLE_ACTION,
      valorRetido: null,
      dataAssinatura: null,
      obs: null,
      reviewedById: null,
      reviewedAt: null,
      reviewReason: null,
      justificativasObservacoes: trimOptional(dto.justificativasObservacoes),
      internalMotivo: null,
      internalCausador: null,
      internalNomeColaborador: null,
      valorNc: null,
      colocarItemSistema: false,
      internalCodigoItem: null,
      internalDescricao: null,
      internalQuantidade: null,
      internalUnidadeMedida: null,
      internalValorUnitario: null,
      internalValorTotal: null,
      systemItemStatus: 'NOT_REQUIRED',
      systemItemIncludedAt: null,
      systemItemIncludedById: null,
      photoUrl: null,
      ncArea,
      issuer: trimRequired(dto.issuer, 'Emitente'),
      destinationSector: trimRequired(
        dto.destinationSector,
        'Setor de destino',
      ),
      responsibleUserId,
      nonConformityDescription: trimRequired(
        dto.nonConformityDescription,
        'Descricao da nao conformidade',
      ),
      immediateReaction: trimOptional(dto.immediateReaction),
      immediateResponsible: trimOptional(dto.immediateResponsible),
      immediateDate,
    };
  }

  private serialize(rnc: RncWithRelations) {
    const valorRetidoInicial = Number(rnc.valorRetidoInicial ?? 0);
    const valorRetido = rnc.valorRetido === null ? 0 : Number(rnc.valorRetido);
    const items =
      rnc.items.length > 0
        ? rnc.items.map((item) => ({
            ...item,
            quantity: Number(item.quantity ?? 0),
            unitValue: Number(item.unitValue ?? 0),
            totalValue: Number(item.totalValue ?? 0),
          }))
        : rnc.colocarItemSistema && rnc.internalDescricao
          ? [
              {
                id: `legacy-${rnc.id}`,
                rncId: rnc.id,
                code: rnc.internalCodigoItem,
                description: rnc.internalDescricao,
                quantity: Number(rnc.internalQuantidade ?? 0),
                unit: rnc.internalUnidadeMedida || '',
                unitValue: Number(rnc.internalValorUnitario ?? 0),
                totalValue: Number(rnc.internalValorTotal ?? 0),
                status:
                  rnc.systemItemStatus === 'INCLUDED' ? 'INCLUDED' : 'PENDING',
                includedAt: rnc.systemItemIncludedAt,
                includedById: rnc.systemItemIncludedById,
                includedBy: rnc.systemItemIncludedBy,
                createdAt: rnc.createdAt,
                updatedAt: rnc.updatedAt,
              },
            ]
          : [];

    return {
      ...rnc,
      items,
      managerActionTaken: this.hasManagerActionTaken(rnc),
      valorRecuperado: valorRetidoInicial - valorRetido,
    };
  }

  private hasManagerActionTaken(rnc: RncWithRelations) {
    return Boolean(
      rnc.reviewedAt ||
      rnc.reviewedById ||
      rnc.history.some((item) =>
        RNC_MANAGER_ACTION_HISTORY_ACTIONS.has(item.action),
      ),
    );
  }

  private ensureIssuerCanChangeBeforeManagerAction(
    rnc: RncWithRelations,
    actorId: string,
  ) {
    this.ensureOwnRnc(rnc, actorId);

    if (
      rnc.status !== RncStatus.PENDING_MANAGER_APPROVAL ||
      this.hasManagerActionTaken(rnc)
    ) {
      throw new BadRequestException(
        'A RNC so pode ser editada antes da primeira acao do gestor',
      );
    }
  }

  private ensureCanCancel(
    rnc: RncWithRelations,
    actorId: string,
    actorRole?: string | null,
  ) {
    if (rnc.status === RncStatus.CANCELLED) {
      throw new BadRequestException('Esta RNC ja foi cancelada');
    }

    const role = normalizeRole(actorRole);
    const canCancelByRole =
      ['admin', 'administrador', 'gestor', 'ceo', 'qualidade'].includes(role) ||
      (isConsultantRole(role) && rnc.type === RncType.INTERNAL);

    if (rnc.engineerId !== actorId && !canCancelByRole) {
      throw new ForbiddenException(
        'Somente o emitente ou um perfil autorizado pode cancelar esta RNC',
      );
    }
  }

  private ensureRncRecordCanLoseFiles(rnc: RncWithRelations) {
    if (
      rnc.status === RncStatus.COMPLETED ||
      rnc.status === RncStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'RNC finalizada ou cancelada deve permanecer integra e nao permite excluir anexos',
      );
    }
  }

  private ensureInternalOpeningOwner(
    rnc: Pick<RncWithRelations, 'engineerId'>,
    actorId: string,
    actorRole?: string | null,
  ) {
    if (rnc.engineerId !== actorId && !isConsultantRole(actorRole)) {
      throw new ForbiddenException(
        'Somente o emitente pode editar os dados da abertura',
      );
    }
  }

  private ensureEngineer(role?: string | null) {
    if (!isEngineeringRole(role)) {
      throw new ForbiddenException(
        'Somente engenharia pode executar esta acao',
      );
    }
  }

  private ensureCanCreateRnc(role: string | null | undefined, type: RncType) {
    if (isEngineeringRole(role)) return;
    if (isConsultantRole(role) && type === RncType.INTERNAL) return;
    throw new ForbiddenException('Sem permissao para criar este tipo de RNC');
  }

  private ensureManager(role?: string | null) {
    if (!['gestor', 'ceo'].includes(normalizeRole(role))) {
      throw new ForbiddenException('Somente gestor pode aprovar RNC');
    }
  }

  private ensureCanRead(
    rnc: RncWithRelations,
    actorRole?: string | null,
    actorId?: string | null,
  ) {
    const role = normalizeRole(actorRole);
    if (canReadAllRncs(role)) return;
    if (isEngineeringRole(role)) return;
    if (
      isResponsibilityOnlyRole(role) &&
      actorId &&
      (rnc.responsibleUserId === actorId ||
        (rnc.correctiveActions || []).some(
          (action) => action.responsibleUserId === actorId,
        ) ||
        rnc.assignments.some(
          (assignment) => assignment.assignedToId === actorId,
        ))
    ) {
      return;
    }
    if (isConsultantRole(role) && rnc.type === RncType.INTERNAL) return;
    if (
      this.canIncludeSystemItem(role) &&
      rnc.type === RncType.WORK &&
      (rnc.status === RncStatus.IN_PROGRESS ||
        rnc.status === RncStatus.COMPLETED)
    ) {
      return;
    }
    if (
      this.canIncludeSystemItem(role) &&
      rnc.colocarItemSistema &&
      (rnc.systemItemStatus === 'PENDING' ||
        rnc.systemItemStatus === 'INCLUDED')
    ) {
      return;
    }
    if (
      actorId &&
      (rnc.correctiveActions || []).some(
        (action) => action.responsibleUserId === actorId,
      )
    ) {
      return;
    }
    if (
      actorId &&
      rnc.type === RncType.INTERNAL &&
      rnc.responsibleUserId === actorId &&
      (rnc.status === RncStatus.AWAITING_RESPONSIBLE_ACTION ||
        rnc.status === RncStatus.AWAITING_CAUSE_ANALYSIS ||
        rnc.status === RncStatus.RESPONSIBLE_ACTION_COMPLETED)
    ) {
      return;
    }
    if (
      actorId &&
      rnc.assignments.some((assignment) => assignment.assignedToId === actorId)
    ) {
      return;
    }
    throw new ForbiddenException('Sem permissao para acessar esta RNC');
  }

  private ensureOwnRnc(rnc: RncWithRelations, actorId: string) {
    if (rnc.engineerId !== actorId) {
      throw new ForbiddenException(
        'Somente o responsavel pode editar esta RNC',
      );
    }
  }

  private ensureManagerReviewable(rnc: RncWithRelations) {
    if (
      rnc.status !== RncStatus.PENDING_MANAGER_APPROVAL &&
      rnc.status !== RncStatus.CAUSER_EXPLANATION_RECEIVED
    ) {
      throw new BadRequestException('Esta RNC nao esta pendente de aprovacao');
    }
  }

  private ensureCanDirect(rnc: RncWithRelations) {
    if (rnc.type !== RncType.WORK) {
      throw new BadRequestException(
        'Somente RNC de Obra pode ser direcionada ao causador',
      );
    }

    if (
      rnc.status !== RncStatus.PENDING_MANAGER_APPROVAL &&
      rnc.status !== RncStatus.AWAITING_CAUSER_EXPLANATION &&
      rnc.status !== RncStatus.CAUSER_EXPLANATION_RECEIVED
    ) {
      throw new BadRequestException(
        'Esta RNC nao pode receber direcionamento neste status',
      );
    }
  }

  private canAnswerDirectedRnc(role?: string | null) {
    return RNC_DIRECTION_TARGET_ROLES.includes(normalizeRole(role));
  }

  private canIncludeSystemItem(role?: string | null) {
    return normalizeRole(role) === 'administrativo';
  }

  private async sendManagerReviewEmailIfEnabled(rnc: RncWithRelations) {
    if (rnc.type === RncType.INTERNAL) {
      return;
    }

    if (
      rnc.status !== RncStatus.PENDING_MANAGER_APPROVAL &&
      rnc.status !== RncStatus.CAUSER_EXPLANATION_RECEIVED
    ) {
      return;
    }

    const targetEmails = getRncEmailTargetEmails();
    const managers = await this.prisma.user.findMany({
      where: { role: 'gestor' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });
    const targetManagers = managers.filter((manager) => {
      const email = normalizeEmail(manager.email);
      return email && targetEmails.has(email);
    });

    for (const manager of targetManagers) {
      const targetEmail = normalizeEmail(manager.email);
      if (!targetEmail) continue;

      let tokenRecordId: string | null = null;

      try {
        const token = randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
        const recipientEmail = getRncEmailRecipient(targetEmail);

        const tokenRecord = await this.prisma.rncEmailToken.create({
          data: {
            rncId: rnc.id,
            targetUserId: manager.id,
            targetEmail,
            tokenHash,
            kind: RNC_EMAIL_TOKEN_KIND_MANAGER_REVIEW,
            expiresAt,
          },
        });
        tokenRecordId = tokenRecord.id;

        const link = buildRncEmailResponseLink(token);
        const emailResult = await this.emailService.sendMail({
          to: recipientEmail,
          subject: `RNC #${rnc.number} aguardando decisao do gestor`,
          html: buildRncManagerReviewEmailHtml({
            rnc,
            manager,
            link,
            recipientEmail,
            targetEmail,
          }),
          text: buildRncManagerReviewEmailText({
            rnc,
            manager,
            link,
            recipientEmail,
            targetEmail,
          }),
        });

        await this.prisma.rncEmailToken.update({
          where: { id: tokenRecord.id },
          data: {
            sentAt: emailResult.sent ? new Date() : null,
            lastEmailError: emailResult.error,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Falha desconhecida no envio.';
        console.warn(
          `[rnc-email] Falha ao preparar e-mail de gestor da RNC ${rnc.id}: ${message}`,
        );

        if (tokenRecordId) {
          await this.prisma.rncEmailToken
            .update({
              where: { id: tokenRecordId },
              data: { lastEmailError: message },
            })
            .catch(() => undefined);
        }
      }
    }
  }

  private async sendAssignmentEmailIfEnabled(
    rnc: RncWithRelations,
    assignedTo: {
      id: string;
      name: string;
      email?: string | null;
      role?: string | null;
    },
  ) {
    const targetEmail = normalizeEmail(assignedTo.email);

    if (!targetEmail || !getRncEmailTargetEmails().has(targetEmail)) {
      return;
    }

    const assignment = rnc.assignments.find(
      (item) =>
        item.assignedToId === assignedTo.id &&
        item.status === RncAssignmentStatus.PENDING,
    );

    if (!assignment) {
      return;
    }

    let tokenRecordId: string | null = null;

    try {
      const token = randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      const recipientEmail = getRncEmailRecipient(targetEmail);

      const tokenRecord = await this.prisma.rncEmailToken.create({
        data: {
          rncId: rnc.id,
          assignmentId: assignment.id,
          targetUserId: assignedTo.id,
          targetEmail,
          tokenHash,
          kind: RNC_EMAIL_TOKEN_KIND_ASSIGNMENT,
          expiresAt,
        },
      });
      tokenRecordId = tokenRecord.id;

      const link = buildRncEmailResponseLink(token);
      const emailResult = await this.emailService.sendMail({
        to: recipientEmail,
        subject: `RNC #${rnc.number} direcionada para resposta`,
        html: buildRncAssignmentEmailHtml({
          rnc,
          assignedTo,
          assignment,
          link,
          recipientEmail,
          targetEmail,
        }),
        text: buildRncAssignmentEmailText({
          rnc,
          assignedTo,
          assignment,
          link,
          recipientEmail,
          targetEmail,
        }),
      });

      await this.prisma.rncEmailToken.update({
        where: { id: tokenRecord.id },
        data: {
          sentAt: emailResult.sent ? new Date() : null,
          lastEmailError: emailResult.error,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida no envio.';
      console.warn(
        `[rnc-email] Falha ao preparar e-mail da RNC ${rnc.id}: ${message}`,
      );

      if (tokenRecordId) {
        await this.prisma.rncEmailToken
          .update({
            where: { id: tokenRecordId },
            data: { lastEmailError: message },
          })
          .catch(() => undefined);
      }
    }
  }

  private async findRncEmailTokenByToken(token: string) {
    if (!token || token.length < 24) {
      throw new NotFoundException('Resposta de RNC nao encontrada.');
    }

    const tokenHash = hashToken(token);
    const tokenRecord = await this.prisma.rncEmailToken.findUnique({
      where: { tokenHash },
      include: includeRncEmailTokenRelations,
    });

    if (!tokenRecord) {
      throw new NotFoundException('Resposta de RNC nao encontrada.');
    }

    return tokenRecord;
  }

  private async toPublicEmailResponse(tokenRecord: RncEmailTokenWithRelations) {
    const assignment = tokenRecord.assignment;
    const expired =
      !!tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < Date.now();
    const answered =
      !!tokenRecord.usedAt ||
      assignment?.status === RncAssignmentStatus.ANSWERED;
    const isManagerReview =
      tokenRecord.kind === RNC_EMAIL_TOKEN_KIND_MANAGER_REVIEW;
    const availableActions: string[] = [];

    if (isManagerReview && !answered && !expired) {
      if (
        tokenRecord.rnc.status === RncStatus.PENDING_MANAGER_APPROVAL ||
        tokenRecord.rnc.status === RncStatus.CAUSER_EXPLANATION_RECEIVED
      ) {
        availableActions.push('APPROVE', 'RETURN', 'REJECT');
      }

      if (
        tokenRecord.rnc.type === RncType.WORK &&
        (tokenRecord.rnc.status === RncStatus.PENDING_MANAGER_APPROVAL ||
          tokenRecord.rnc.status === RncStatus.AWAITING_CAUSER_EXPLANATION ||
          tokenRecord.rnc.status === RncStatus.CAUSER_EXPLANATION_RECEIVED)
      ) {
        availableActions.push('DIRECT');
      }
    } else if (!isManagerReview && !answered && !expired && assignment) {
      availableActions.push('RESPOND');
    }

    const assignableUsers =
      isManagerReview && availableActions.includes('DIRECT')
        ? await this.prisma.user.findMany({
            where: { role: { in: RNC_DIRECTION_TARGET_ROLES } },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              role: true,
            },
          })
        : [];

    return {
      id: tokenRecord.id,
      kind: tokenRecord.kind,
      status: answered ? 'ANSWERED' : expired ? 'EXPIRED' : 'PENDING',
      expired,
      availableActions,
      assignableUsers,
      sentAt: tokenRecord.sentAt?.toISOString() ?? null,
      expiresAt: tokenRecord.expiresAt?.toISOString() ?? null,
      usedAt: tokenRecord.usedAt?.toISOString() ?? null,
      targetUser: {
        id: tokenRecord.targetUser.id,
        name: tokenRecord.targetUser.name,
        email: tokenRecord.targetUser.email,
        role: tokenRecord.targetUser.role,
      },
      assignment: assignment
        ? {
            id: assignment.id,
            reason: assignment.reason,
            response: assignment.response,
            status: assignment.status,
            createdAt: assignment.createdAt.toISOString(),
            respondedAt: assignment.respondedAt?.toISOString() ?? null,
            assignedBy: assignment.assignedBy,
            assignedTo: assignment.assignedTo,
          }
        : null,
      rnc: {
        id: tokenRecord.rnc.id,
        number: tokenRecord.rnc.number,
        type: tokenRecord.rnc.type,
        cliente: tokenRecord.rnc.cliente,
        obra: tokenRecord.rnc.obra,
        obraDescricao: tokenRecord.rnc.obraDescricao,
        responsavel: tokenRecord.rnc.responsavel,
        dataEntrada: tokenRecord.rnc.dataEntrada.toISOString(),
        dataLimiteRetorno: tokenRecord.rnc.dataLimiteRetorno.toISOString(),
        etapaObra: tokenRecord.rnc.etapaObra,
        enquadramentoMotivo: tokenRecord.rnc.enquadramentoMotivo,
        valorRetidoInicial: Number(tokenRecord.rnc.valorRetidoInicial ?? 0),
        status: tokenRecord.rnc.status,
        reviewedAt: tokenRecord.rnc.reviewedAt?.toISOString() ?? null,
        ncArea: tokenRecord.rnc.ncArea,
        issuer: tokenRecord.rnc.issuer,
        destinationSector: tokenRecord.rnc.destinationSector,
        nonConformityDescription: tokenRecord.rnc.nonConformityDescription,
        immediateReaction: tokenRecord.rnc.immediateReaction,
        immediateResponsible: tokenRecord.rnc.immediateResponsible,
        immediateDate: tokenRecord.rnc.immediateDate?.toISOString() ?? null,
        internalMotivo: tokenRecord.rnc.internalMotivo,
        internalCausador: tokenRecord.rnc.internalCausador,
        internalNomeColaborador: tokenRecord.rnc.internalNomeColaborador,
        valorNc:
          tokenRecord.rnc.valorNc === null
            ? null
            : Number(tokenRecord.rnc.valorNc),
        photoUrl: resolvePublicAssetUrl(tokenRecord.rnc.photoUrl),
        engineer: tokenRecord.rnc.engineer,
        attachments: tokenRecord.rnc.attachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          fileUrl:
            resolvePublicAssetUrl(attachment.fileUrl) || attachment.fileUrl,
          mimeType: attachment.mimeType,
          createdAt: attachment.createdAt.toISOString(),
        })),
      },
    };
  }

  private notifyUsers(
    userIds: string[],
    payload: Parameters<NotificationsService['notifyUsers']>[1],
  ) {
    void this.notifications.notifyUsers(userIds, payload).catch((error) => {
      console.warn(
        `[notifications] user notification failed: ${error?.message ?? error}`,
      );
    });
  }

  private async sendInternalRncTaskEmail(
    rnc: RncWithRelations,
    user: {
      id: string;
      name: string;
      email?: string | null;
      role?: string | null;
    },
    content: {
      subject: string;
      title: string;
      description: string;
      items?: string[];
    },
  ) {
    const targetEmail = normalizeEmail(user.email);
    if (!targetEmail) {
      console.warn(
        `[rnc-email] Usuario ${user.id} sem e-mail valido para a RNC ${rnc.id}.`,
      );
      return;
    }

    try {
      const recipientEmail = getRncEmailRecipient(targetEmail);
      const link = buildRncInternalLink();
      const testNotice =
        recipientEmail !== targetEmail
          ? `<div style="margin:14px 0;border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:12px;color:#92400e;font-size:13px"><strong>Modo teste:</strong> esta mensagem seria enviada para ${escapeHtml(targetEmail)}, mas foi encaminhada para ${escapeHtml(recipientEmail)}.</div>`
          : '';
      const itemsHtml = content.items?.length
        ? `<ul style="padding-left:20px">${content.items
            .map((item) => `<li style="margin:8px 0">${escapeHtml(item)}</li>`)
            .join('')}</ul>`
        : '';
      const itemsText = content.items?.length
        ? `\n${content.items.map((item) => `- ${item}`).join('\n')}`
        : '';

      const result = await this.emailService.sendMail({
        to: recipientEmail,
        subject: content.subject,
        html: `
          <div style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,sans-serif;color:#18181b">
            <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden">
              <div style="background:#b91c1c;color:#fff;padding:18px 22px;font-size:20px;font-weight:800">Sistema JR - RNC #${rnc.number}</div>
              <div style="padding:22px">
                <p>Ola, ${escapeHtml(user.name || targetEmail)}.</p>
                ${testNotice}
                <h1 style="font-size:20px;margin:18px 0 8px">${escapeHtml(content.title)}</h1>
                <p style="line-height:1.55">${escapeHtml(content.description)}</p>
                ${itemsHtml}
                <p style="margin:22px 0">
                  <a href="${escapeHtml(link)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">Abrir RNC Comigo</a>
                </p>
                <p style="color:#6b7280;font-size:12px">Se o botao nao abrir, copie este link: ${escapeHtml(link)}</p>
              </div>
            </div>
          </div>`,
        text: [
          `Sistema JR - RNC #${rnc.number}`,
          '',
          `Ola, ${user.name || targetEmail}.`,
          content.title,
          content.description,
          itemsText,
          '',
          `Abrir RNC Comigo: ${link}`,
        ].join('\n'),
      });

      if (!result.sent) {
        console.warn(
          `[rnc-email] E-mail interno da RNC ${rnc.id} nao enviado para ${targetEmail}: ${result.error || 'motivo nao informado'}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida no envio.';
      console.warn(
        `[rnc-email] Falha no e-mail interno da RNC ${rnc.id} para ${targetEmail}: ${message}`,
      );
    }
  }

  private async sendCancellationEmails(rnc: RncWithRelations) {
    const targetEmails = new Set<string>();
    [rnc.cancelledByEmail, ...RNC_CANCELLATION_NOTIFICATION_EMAILS]
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => !!email)
      .forEach((email) => targetEmails.add(email));

    if (targetEmails.size === 0) {
      console.warn(
        `[rnc-email] RNC ${rnc.id} cancelada sem destinatario de e-mail valido.`,
      );
      return;
    }

    const appLink = buildRncInternalLink();
    const cancelledAt = rnc.cancelledAt || new Date();
    const cancelledBy = rnc.cancelledByName || 'Usuario do Sistema JR';
    const reason = rnc.cancellationReason || 'Nao informado';
    const typeLabel = getRncTypeLabel(String(rnc.type));
    const reference =
      rnc.obraDescricao || rnc.obra || rnc.cliente || 'Sem referencia';
    const configuredTestRecipient = normalizeEmail(process.env.RNC_EMAIL_TEST_TO);
    const deliveries = configuredTestRecipient
      ? [
          {
            recipient: configuredTestRecipient,
            intendedRecipients: [...targetEmails],
          },
        ]
      : [...targetEmails].map((email) => ({
          recipient: email,
          intendedRecipients: [email],
        }));

    await Promise.all(
      deliveries.map(async ({ recipient, intendedRecipients }) => {
        try {
          const testNotice = configuredTestRecipient
            ? `<div style="margin:14px 0;border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:12px;color:#92400e;font-size:13px"><strong>Modo teste:</strong> esta mensagem seria enviada para ${escapeHtml(intendedRecipients.join(', '))}.</div>`
            : '';
          const result = await this.emailService.sendMail({
            to: recipient,
            subject: `RNC #${rnc.number} cancelada - Sistema JR`,
            html: `
              <div style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,sans-serif;color:#18181b">
                <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden">
                  <div style="background:#b91c1c;color:#fff;padding:18px 22px">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase">Sistema JR</div>
                    <h1 style="margin:6px 0 0;font-size:22px">RNC #${rnc.number} cancelada</h1>
                  </div>
                  <div style="padding:22px">
                    ${testNotice}
                    <p>A RNC abaixo foi cancelada e permanece preservada no historico do sistema.</p>
                    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0;line-height:1.6">
                      <strong>Tipo:</strong> ${escapeHtml(typeLabel)}<br>
                      <strong>Referencia:</strong> ${escapeHtml(reference)}<br>
                      <strong>Cancelada por:</strong> ${escapeHtml(cancelledBy)} (${escapeHtml(rnc.cancelledByEmail || '-')})<br>
                      <strong>Data e hora:</strong> ${escapeHtml(formatDateTime(cancelledAt))}<br>
                      <strong>Motivo:</strong> ${escapeHtml(reason)}
                    </div>
                    <p style="margin:22px 0">
                      <a href="${escapeHtml(appLink)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">Consultar RNC</a>
                    </p>
                    <p style="color:#6b7280;font-size:12px">O cancelamento nao exclui o registro nem seu historico.</p>
                  </div>
                </div>
              </div>`,
            text: [
              `Sistema JR - RNC #${rnc.number} cancelada`,
              '',
              `Tipo: ${typeLabel}`,
              `Referencia: ${reference}`,
              `Cancelada por: ${cancelledBy} (${rnc.cancelledByEmail || '-'})`,
              `Data e hora: ${formatDateTime(cancelledAt)}`,
              `Motivo: ${reason}`,
              '',
              `Consultar: ${appLink}`,
              'O cancelamento nao exclui o registro nem seu historico.',
            ].join('\n'),
          });

          if (!result.sent) {
            console.warn(
              `[rnc-email] Aviso de cancelamento da RNC ${rnc.id} nao enviado para ${recipient}: ${result.error || 'motivo nao informado'}`,
            );
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Falha desconhecida no envio.';
          console.warn(
            `[rnc-email] Falha no aviso de cancelamento da RNC ${rnc.id} para ${recipient}: ${message}`,
          );
        }
      }),
    );
  }

  private notifyRoles(
    roles: string[],
    payload: Parameters<NotificationsService['notifyRoles']>[1],
  ) {
    void this.notifications.notifyRoles(roles, payload).catch((error) => {
      console.warn(
        `[notifications] role notification failed: ${error?.message ?? error}`,
      );
    });
  }

  private notificationData(rncId: string) {
    return {
      type: 'rnc',
      screen: 'rncs',
      rncId,
    };
  }

  private async getRnc(
    id: string,
    client: Pick<Prisma.TransactionClient, 'rnc'> = this.prisma,
  ) {
    const rnc = await client.rnc.findUnique({
      where: { id },
      include: includeRncRelations,
    });

    if (!rnc) {
      throw new NotFoundException('RNC nao encontrada');
    }

    return rnc;
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() || '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function getRncEmailTargetEmails() {
  const configured = process.env.RNC_EMAIL_TARGET_EMAILS?.trim();
  const entries = configured ? configured.split(',') : [RNC_EMAIL_TARGET_EMAIL];

  return new Set(
    entries
      .map((entry) => normalizeEmail(entry))
      .filter((entry): entry is string => !!entry),
  );
}

function getRncEmailRecipient(targetEmail: string) {
  return normalizeEmail(process.env.RNC_EMAIL_TEST_TO) || targetEmail;
}

function buildRncEmailResponseLink(token: string) {
  const appUrl =
    process.env.APP_PUBLIC_URL?.trim() || 'https://app.jrconstrucoes.net.br';

  return `${appUrl.replace(/\/$/, '')}/rnc-resposta/${token}`;
}

function buildRncInternalLink() {
  const appUrl =
    process.env.APP_PUBLIC_URL?.trim() || 'https://app.jrconstrucoes.net.br';

  return `${appUrl.replace(/\/$/, '')}/rnc`;
}

function getApiPublicUrl() {
  return (
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim() ||
    'https://api.jrconstrucoes.net.br'
  ).replace(/\/$/, '');
}

function resolvePublicAssetUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(url)) {
    return url;
  }

  return `${getApiPublicUrl()}${url.startsWith('/') ? url : `/${url}`}`;
}

function buildRncManagerReviewEmailHtml(input: {
  rnc: RncWithRelations;
  manager: { name: string; email?: string | null };
  link: string;
  recipientEmail: string;
  targetEmail: string;
}) {
  const rnc = input.rnc;
  const testNotice =
    input.recipientEmail !== input.targetEmail
      ? `<div style="margin:14px 0;border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:12px;color:#92400e;font-size:13px"><strong>Modo teste:</strong> esta mensagem seria enviada para ${escapeHtml(input.targetEmail)}, mas foi encaminhada para ${escapeHtml(input.recipientEmail)}.</div>`
      : '';
  const description =
    rnc.nonConformityDescription ||
    rnc.internalDescricao ||
    rnc.internalMotivo ||
    rnc.enquadramentoMotivo ||
    '';

  return `
    <div style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;color:#111827">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#b91c1c;color:#fff;padding:18px 22px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase">JR Construcoes</div>
          <h1 style="margin:6px 0 0;font-size:22px">RNC #${rnc.number} aguardando decisao do gestor</h1>
        </div>
        <div style="padding:22px">
          <p>Ola, ${escapeHtml(input.manager.name || input.targetEmail)}.</p>
          <p>Uma RNC esta aguardando sua decisao como gestor. Clique no botao abaixo para abrir a analise e escolher uma acao.</p>
          ${testNotice}
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0">
            <strong>RNC #${rnc.number}</strong><br>
            Tipo: ${escapeHtml(getRncTypeLabel(String(rnc.type)))}<br>
            Status: ${escapeHtml(String(rnc.status))}<br>
            Obra/Cliente: ${escapeHtml(rnc.obraDescricao || rnc.obra || rnc.cliente || '-')}<br>
            Responsavel: ${escapeHtml(rnc.responsavel || '-')}<br>
            Prazo: ${escapeHtml(formatDateTime(rnc.dataLimiteRetorno))}
          </div>
          ${
            description
              ? `<h2 style="font-size:16px;margin:20px 0 8px">Nao conformidade</h2><p style="white-space:pre-line">${escapeHtml(description)}</p>`
              : ''
          }
          ${
            rnc.photoUrl
              ? `<p><img src="${escapeHtml(resolvePublicAssetUrl(rnc.photoUrl) || rnc.photoUrl)}" alt="" style="max-width:100%;border-radius:10px;border:1px solid #ddd"></p>`
              : ''
          }
          <p style="margin:22px 0">
            <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">
              Abrir decisao da RNC
            </a>
          </p>
          <p style="margin-top:20px;color:#6b7280;font-size:12px">Se o botao nao abrir, copie este link: ${escapeHtml(input.link)}</p>
        </div>
      </div>
    </div>
  `;
}

function buildRncManagerReviewEmailText(input: {
  rnc: RncWithRelations;
  manager: { name: string; email?: string | null };
  link: string;
  recipientEmail: string;
  targetEmail: string;
}) {
  const testNotice =
    input.recipientEmail !== input.targetEmail
      ? `Modo teste: esta mensagem seria enviada para ${input.targetEmail}, mas foi encaminhada para ${input.recipientEmail}.`
      : '';
  const description =
    input.rnc.nonConformityDescription ||
    input.rnc.internalDescricao ||
    input.rnc.internalMotivo ||
    input.rnc.enquadramentoMotivo ||
    '';

  return [
    `RNC #${input.rnc.number} aguardando decisao do gestor`,
    '',
    `Ola, ${input.manager.name || input.targetEmail}.`,
    'Uma RNC esta aguardando sua decisao como gestor.',
    testNotice,
    '',
    `Tipo: ${getRncTypeLabel(String(input.rnc.type))}`,
    `Status: ${input.rnc.status}`,
    `Obra/Cliente: ${
      input.rnc.obraDescricao || input.rnc.obra || input.rnc.cliente || '-'
    }`,
    `Responsavel: ${input.rnc.responsavel || '-'}`,
    `Prazo: ${formatDateTime(input.rnc.dataLimiteRetorno)}`,
    '',
    description ? `Nao conformidade:\n${description}\n` : '',
    `Abrir decisao: ${input.link}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function buildRncAssignmentEmailHtml(input: {
  rnc: RncWithRelations;
  assignedTo: { name: string; email?: string | null };
  assignment: RncWithRelations['assignments'][number];
  link: string;
  recipientEmail: string;
  targetEmail: string;
}) {
  const rnc = input.rnc;
  const testNotice =
    input.recipientEmail !== input.targetEmail
      ? `<div style="margin:14px 0;border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:12px;color:#92400e;font-size:13px"><strong>Modo teste:</strong> esta mensagem seria enviada para ${escapeHtml(input.targetEmail)}, mas foi encaminhada para ${escapeHtml(input.recipientEmail)}.</div>`
      : '';

  return `
    <div style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;color:#111827">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#b91c1c;color:#fff;padding:18px 22px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase">JR Construcoes</div>
          <h1 style="margin:6px 0 0;font-size:22px">RNC #${rnc.number} direcionada para resposta</h1>
        </div>
        <div style="padding:22px">
          <p>Ola, ${escapeHtml(input.assignedTo.name || input.targetEmail)}.</p>
          <p>Uma RNC ficou sob sua responsabilidade para resposta. Clique no botao abaixo para abrir o formulario e registrar sua explicacao.</p>
          ${testNotice}
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0">
            <strong>RNC #${rnc.number}</strong><br>
            Tipo: ${escapeHtml(getRncTypeLabel(String(rnc.type)))}<br>
            Obra/Cliente: ${escapeHtml(rnc.obraDescricao || rnc.obra || rnc.cliente || '-')}<br>
            Etapa/Area: ${escapeHtml(rnc.ncArea || rnc.etapaObra || '-')}<br>
            Prazo: ${escapeHtml(formatDateTime(rnc.dataLimiteRetorno))}
          </div>
          <div style="border-left:4px solid #b91c1c;background:#fff7f7;padding:12px 14px;margin:16px 0">
            <div style="font-size:12px;font-weight:800;color:#991b1b;text-transform:uppercase">Motivo da solicitacao</div>
            <div style="margin-top:6px;white-space:pre-line">${escapeHtml(input.assignment.reason)}</div>
          </div>
          ${
            rnc.nonConformityDescription
              ? `<h2 style="font-size:16px;margin:20px 0 8px">Nao conformidade</h2><p style="white-space:pre-line">${escapeHtml(rnc.nonConformityDescription)}</p>`
              : ''
          }
          ${
            rnc.photoUrl
              ? `<p><img src="${escapeHtml(resolvePublicAssetUrl(rnc.photoUrl) || rnc.photoUrl)}" alt="" style="max-width:100%;border-radius:10px;border:1px solid #ddd"></p>`
              : ''
          }
          <p style="margin:22px 0">
            <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">
              Abrir e responder RNC
            </a>
          </p>
          <p style="margin-top:20px;color:#6b7280;font-size:12px">Se o botao nao abrir, copie este link: ${escapeHtml(input.link)}</p>
        </div>
      </div>
    </div>
  `;
}

function buildRncAssignmentEmailText(input: {
  rnc: RncWithRelations;
  assignedTo: { name: string; email?: string | null };
  assignment: RncWithRelations['assignments'][number];
  link: string;
  recipientEmail: string;
  targetEmail: string;
}) {
  const testNotice =
    input.recipientEmail !== input.targetEmail
      ? `Modo teste: esta mensagem seria enviada para ${input.targetEmail}, mas foi encaminhada para ${input.recipientEmail}.`
      : '';

  return [
    `RNC #${input.rnc.number} direcionada para resposta`,
    '',
    `Ola, ${input.assignedTo.name || input.targetEmail}.`,
    'Uma RNC ficou sob sua responsabilidade para resposta.',
    testNotice,
    '',
    `Tipo: ${getRncTypeLabel(String(input.rnc.type))}`,
    `Obra/Cliente: ${input.rnc.obraDescricao || input.rnc.obra || input.rnc.cliente || '-'}`,
    `Etapa/Area: ${input.rnc.ncArea || input.rnc.etapaObra || '-'}`,
    `Prazo: ${formatDateTime(input.rnc.dataLimiteRetorno)}`,
    '',
    'Motivo da solicitacao:',
    input.assignment.reason,
    '',
    input.rnc.nonConformityDescription
      ? `Nao conformidade:\n${input.rnc.nonConformityDescription}\n`
      : '',
    `Abrir e responder: ${input.link}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function getRncTypeLabel(type: string) {
  if (type === 'WORK') return 'RNC de Obra';
  if (type === 'INTERNAL') return 'RNC Interna';
  return 'RNC Externa';
}

function formatDateTime(value?: Date | string | null) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
