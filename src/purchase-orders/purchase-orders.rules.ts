import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'OPEN',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'COMPLETED',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const PURCHASE_ORDER_APPROVAL_STATUSES = [
  'APPROVED',
  'PENDING_APPROVAL',
  'REAPPROVAL_REQUIRED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'NOT_REQUIRED',
  'UNKNOWN',
] as const;
export type PurchaseOrderApprovalStatus =
  (typeof PURCHASE_ORDER_APPROVAL_STATUSES)[number];

export interface PurchaseOrderItemInput {
  sourceItemId: string;
  lineType: 'ITEM' | 'ADJUSTMENT';
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalAmount: number;
  accountCode: string | null;
  accountName: string | null;
  pendingAmount: number | null;
  approvedAmount: number | null;
  openCommitmentAmount: number | null;
  raw: Record<string, unknown> | null;
}
export interface PurchaseOrderApprovalCandidateInput {
  sourceUserId: string;
  sourceUserCompanyId: string;
  name: string;
}
export interface PurchaseOrderPendingApprovalInput {
  assignmentType: 'UNASSIGNED';
  stageCode: 'AETHOS_OC_VALUE_AUTHORIZATION';
  completionRule: 'ANY_ONE_VALID_SIGNATURE';
  candidateBasis: 'ACTIVE_COMPANY_LINK_AND_RECORDED_OC_AMOUNT_LIMIT';
  effectivePermissionVerified: false;
  candidateUsers: PurchaseOrderApprovalCandidateInput[];
}
export interface PurchaseOrderInput {
  sourceOrderId: string;
  number: string;
  companyCode: string;
  companyName: string | null;
  supplierName: string | null;
  issuedAt: string;
  competence: string;
  status: PurchaseOrderStatus;
  sourceStatus: string | null;
  approvalStatus: PurchaseOrderApprovalStatus;
  sourceApprovalStatus: string | null;
  requesterName: string | null;
  buyerName: string | null;
  pendingApproverName: string | null;
  pendingApproval: PurchaseOrderPendingApprovalInput | null;
  approvedByName: string | null;
  approvedAt: string | null;
  expectedDeliveryAt: string | null;
  totalAmount: number;
  notes: string | null;
  raw: Record<string, unknown> | null;
  sourceUpdatedAt: string | null;
  active: boolean;
  items: PurchaseOrderItemInput[];
}

function pendingApproval(
  value: unknown,
): PurchaseOrderPendingApprovalInput | null {
  if (value === undefined || value === null) return null;
  const context = record(value, 'pendingApproval');
  const exact = <T extends string>(field: string, expected: T): T => {
    if (context[field] !== expected) {
      throw new BadRequestException(`pendingApproval.${field}: valor invalido`);
    }
    return expected;
  };
  if (context.effectivePermissionVerified !== false) {
    throw new BadRequestException(
      'pendingApproval.effectivePermissionVerified deve ser false',
    );
  }
  if (
    !Array.isArray(context.candidateUsers) ||
    context.candidateUsers.length < 1 ||
    context.candidateUsers.length > 50
  ) {
    throw new BadRequestException(
      'pendingApproval.candidateUsers deve conter de 1 a 50 contas',
    );
  }
  const seen = new Set<string>();
  const candidateUsers = context.candidateUsers.map((value, index) => {
    const candidate = record(value, `pendingApproval.candidateUsers[${index}]`);
    const sourceUserId = text(
      candidate.sourceUserId,
      'pendingApproval.candidateUsers.sourceUserId',
      true,
      200,
    )!;
    const sourceUserCompanyId = text(
      candidate.sourceUserCompanyId,
      'pendingApproval.candidateUsers.sourceUserCompanyId',
      true,
      200,
    )!;
    const name = text(
      candidate.name,
      'pendingApproval.candidateUsers.name',
      true,
      300,
    )!;
    const key = JSON.stringify([sourceUserCompanyId, sourceUserId]);
    if (seen.has(key)) {
      throw new BadRequestException(
        'pendingApproval.candidateUsers contem vinculo duplicado',
      );
    }
    seen.add(key);
    return { sourceUserId, sourceUserCompanyId, name };
  });
  candidateUsers.sort(
    (left, right) =>
      left.sourceUserId.localeCompare(right.sourceUserId, 'pt-BR', {
        numeric: true,
      }) ||
      left.sourceUserCompanyId.localeCompare(
        right.sourceUserCompanyId,
        'pt-BR',
        { numeric: true },
      ) ||
      left.name.localeCompare(right.name, 'pt-BR'),
  );
  return {
    assignmentType: exact('assignmentType', 'UNASSIGNED'),
    stageCode: exact('stageCode', 'AETHOS_OC_VALUE_AUTHORIZATION'),
    completionRule: exact('completionRule', 'ANY_ONE_VALID_SIGNATURE'),
    candidateBasis: exact(
      'candidateBasis',
      'ACTIVE_COMPANY_LINK_AND_RECORDED_OC_AMOUNT_LIMIT',
    ),
    effectivePermissionVerified: false,
    candidateUsers,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label}: objeto invalido`);
  }
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  label: string,
  required = false,
  max = 300,
): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new BadRequestException(`${label}: campo obrigatorio`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max || !value.trim()) {
    throw new BadRequestException(`${label}: texto invalido`);
  }
  return value.trim();
}
function amount(
  value: unknown,
  label: string,
  required = false,
  scale = 3,
  signed = false,
): number | null {
  if (value === null || value === undefined) {
    if (required) throw new BadRequestException(`${label}: valor obrigatorio`);
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (!signed && value < 0) ||
    Math.abs(value) > 1e12 ||
    (scale === 6 && Math.abs(value) >= 1e12)
  ) {
    throw new BadRequestException(`${label}: numero nao negativo invalido`);
  }
  const multiplier = 10 ** scale;
  const rounded =
    Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  if (Math.abs(value - rounded) > 1e-7) {
    throw new BadRequestException(
      `${label}: maximo de ${scale} casas decimais`,
    );
  }
  return rounded;
}
function rawObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const raw = record(value, 'raw');
  let encoded: string;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    throw new BadRequestException('raw invalido');
  }
  if (Buffer.byteLength(encoded, 'utf8') > 20480)
    throw new BadRequestException('raw excede 20 KB');
  return JSON.parse(encoded);
}
function date(
  value: unknown,
  label: string,
  required = false,
  dateOnly = false,
): string | null {
  const result = text(value, label, required, 50);
  if (result === null) return null;
  const pattern = dateOnly
    ? /^\d{4}-\d{2}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  const parsed = new Date(dateOnly ? `${result}T00:00:00.000Z` : result);
  const calendarDate = new Date(`${result.slice(0, 10)}T00:00:00.000Z`);
  if (
    !pattern.test(result) ||
    !Number.isFinite(parsed.getTime()) ||
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== result.slice(0, 10) ||
    (dateOnly && parsed.toISOString().slice(0, 10) !== result)
  ) {
    throw new BadRequestException(`${label}: data invalida`);
  }
  return dateOnly ? result : parsed.toISOString();
}
export function competence(value: unknown, label = 'competencia'): string {
  if (typeof value !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) {
    throw new BadRequestException(`${label}: use AAAA-MM`);
  }
  return value;
}

export function validatePurchaseOrderSync(input: unknown) {
  const body = record(input, 'carga');
  const runId = text(body.runId, 'runId', true, 200)!;
  const extractedAt = date(body.extractedAt, 'extractedAt', true)!;
  if (!Array.isArray(body.orders) || body.orders.length > 200) {
    throw new BadRequestException(
      'orders deve ser uma lista com no maximo 200 ordens',
    );
  }
  if (
    body.orders.reduce(
      (sum, value) =>
        sum + (Array.isArray(value?.items) ? value.items.length : 0),
      0,
    ) > 5000
  ) {
    throw new BadRequestException('Limite de 5000 itens por carga');
  }
  const seen = new Set<string>();
  const orders: PurchaseOrderInput[] = body.orders.map((value, index) => {
    const row = record(value, `orders[${index}]`);
    const sourceOrderId = text(row.sourceOrderId, 'sourceOrderId', true, 200)!;
    const companyCode = text(row.companyCode, 'companyCode', true, 200)!;
    const sourceKey = JSON.stringify([companyCode, sourceOrderId]);
    if (seen.has(sourceKey))
      throw new BadRequestException(
        `Ordem duplicada na carga: ${sourceOrderId}`,
      );
    seen.add(sourceKey);
    const status = text(row.status, 'status', true)! as PurchaseOrderStatus;
    if (!PURCHASE_ORDER_STATUSES.includes(status))
      throw new BadRequestException('Status normalizado invalido');
    const approvalStatus = text(
      row.approvalStatus,
      'approvalStatus',
      true,
    )! as PurchaseOrderApprovalStatus;
    if (!PURCHASE_ORDER_APPROVAL_STATUSES.includes(approvalStatus))
      throw new BadRequestException('Status de aprovacao invalido');
    const pendingApproverName = text(
      row.pendingApproverName,
      'pendingApproverName',
    );
    const pendingApprovalContext = pendingApproval(row.pendingApproval);
    if (pendingApprovalContext && pendingApproverName) {
      throw new BadRequestException(
        'pendingApproval coletivo nao aceita pendingApproverName individual',
      );
    }
    if (pendingApprovalContext && !isPending(approvalStatus, status)) {
      throw new BadRequestException(
        'pendingApproval permitido somente em ordem realmente pendente',
      );
    }
    if (row.active !== undefined && typeof row.active !== 'boolean')
      throw new BadRequestException('active deve ser booleano');
    if (!Array.isArray(row.items))
      throw new BadRequestException('items deve ser uma lista');
    const itemIds = new Set<string>();
    const items = row.items
      .map((itemValue): PurchaseOrderItemInput => {
        const item = record(itemValue, 'item');
        const sourceItemId = text(
          item.sourceItemId,
          'sourceItemId',
          true,
          200,
        )!;
        if (itemIds.has(sourceItemId))
          throw new BadRequestException(
            `Item/rateio duplicado na ordem ${sourceOrderId}`,
          );
        itemIds.add(sourceItemId);
        const lineType = item.lineType === undefined ? 'ITEM' : item.lineType;
        if (!['ITEM', 'ADJUSTMENT'].includes(String(lineType)))
          throw new BadRequestException('lineType invalido');
        const signed = lineType === 'ADJUSTMENT';
        const totalAmount = amount(
          item.totalAmount,
          'item.totalAmount',
          true,
          3,
          signed,
        )!;
        const pendingAmount = amount(
          item.pendingAmount,
          'item.pendingAmount',
          false,
          3,
          signed,
        );
        const approvedAmount = amount(
          item.approvedAmount,
          'item.approvedAmount',
          false,
          3,
          signed,
        );
        const openCommitmentAmount = amount(
          item.openCommitmentAmount,
          'item.openCommitmentAmount',
          false,
          3,
          signed,
        );
        const effective = effectiveAmounts(
          { totalAmount, pendingAmount, approvedAmount, openCommitmentAmount },
          approvalStatus,
          status,
        );
        const knownApproved = effective.approved;
        const knownPending = effective.pending;
        if (
          status !== 'CANCELLED' &&
          ((approvalStatus === 'APPROVED' &&
            ((pendingAmount !== null && Math.abs(pendingAmount) > 0.001) ||
              (approvedAmount !== null &&
                Math.abs(approvedAmount - totalAmount) > 0.001))) ||
            (['OPEN', 'PARTIALLY_FULFILLED'].includes(status) &&
              ['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED'].includes(
                approvalStatus,
              ) &&
              ((approvedAmount !== null && Math.abs(approvedAmount) > 0.001) ||
                (pendingAmount !== null &&
                  Math.abs(pendingAmount - totalAmount) > 0.001))))
        ) {
          throw new BadRequestException(
            `Valores do item ${sourceItemId} contradizem o status da ordem`,
          );
        }
        if (
          [pendingAmount, approvedAmount, openCommitmentAmount].some(
            (value) =>
              value !== null &&
              (Math.abs(value) > Math.abs(totalAmount) + 0.001 ||
                (value !== 0 && Math.sign(value) !== Math.sign(totalAmount))),
          ) ||
          (knownPending !== null &&
            knownApproved !== null &&
            Math.abs(knownPending + knownApproved) >
              Math.abs(totalAmount) + 0.001) ||
          (openCommitmentAmount !== null &&
            knownApproved !== null &&
            Math.abs(openCommitmentAmount) > Math.abs(knownApproved) + 0.001)
        ) {
          throw new BadRequestException(
            `Valores de aprovacao excedem o item ${sourceItemId}`,
          );
        }
        return {
          sourceItemId,
          lineType: lineType as 'ITEM' | 'ADJUSTMENT',
          description: text(item.description, 'description', true, 2000)!,
          quantity: amount(item.quantity, 'quantity', false, 6, signed),
          unit: text(item.unit, 'unit', false, 50),
          unitPrice: amount(item.unitPrice, 'unitPrice', false, 6, signed),
          totalAmount,
          accountCode: text(item.accountCode, 'accountCode', false, 200),
          accountName: text(item.accountName, 'accountName', false, 1000),
          pendingAmount,
          approvedAmount,
          openCommitmentAmount,
          raw: rawObject(item.raw),
        };
      })
      .sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId));
    const totalAmount = amount(
      row.totalAmount,
      'totalAmount',
      true,
      3,
      status === 'CANCELLED',
    )!;
    const itemCents = items.reduce(
      (sum, item) => sum + Math.round(item.totalAmount * 1000),
      0,
    );
    if (Math.abs(itemCents - Math.round(totalAmount * 1000)) > 1) {
      throw new BadRequestException(
        `Total dos itens nao confere com a ordem ${sourceOrderId}`,
      );
    }
    if (row.active !== false && items.length === 0 && totalAmount !== 0) {
      throw new BadRequestException(`Ordem ${sourceOrderId} sem detalhamento`);
    }
    return {
      sourceOrderId,
      number: text(row.number, 'number', true, 200)!,
      companyCode,
      companyName: text(row.companyName, 'companyName', false, 1000),
      supplierName: text(row.supplierName, 'supplierName', false, 1000),
      issuedAt: date(row.issuedAt, 'issuedAt', true, true)!,
      competence: competence(row.competence),
      status,
      sourceStatus: text(row.sourceStatus, 'sourceStatus'),
      approvalStatus,
      sourceApprovalStatus: text(
        row.sourceApprovalStatus,
        'sourceApprovalStatus',
      ),
      requesterName: text(row.requesterName, 'requesterName'),
      buyerName: text(row.buyerName, 'buyerName'),
      pendingApproverName,
      pendingApproval: pendingApprovalContext,
      approvedByName: text(row.approvedByName, 'approvedByName'),
      approvedAt: date(row.approvedAt, 'approvedAt'),
      expectedDeliveryAt: date(
        row.expectedDeliveryAt,
        'expectedDeliveryAt',
        false,
        true,
      ),
      totalAmount,
      notes: text(row.notes, 'notes', false, 10000),
      raw: rawObject(row.raw),
      sourceUpdatedAt: date(row.sourceUpdatedAt, 'sourceUpdatedAt'),
      active: row.active !== false,
      items,
    };
  });
  orders.sort(
    (a, b) =>
      a.companyCode.localeCompare(b.companyCode) ||
      a.sourceOrderId.localeCompare(b.sourceOrderId),
  );
  return { runId, extractedAt, orders };
}

export function purchaseOrderHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function ensurePurchaseOrderAccess(role?: string) {
  if (
    !['admin', 'compras', 'gestor', 'ceo'].includes(
      (role || '').toLowerCase(),
    )
  ) {
    throw new ForbiddenException(
      'Ordens de compra disponiveis para Compras, Administrador, Gestor e CEO',
    );
  }
}
export function money(value: any): number {
  return Number(
    new Prisma.Decimal(value ?? 0).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    ),
  );
}
export function nullableMoney(value: any): number | null {
  return value === null || value === undefined ? null : money(value);
}
export function sourceMoney(value: any): number {
  return Number(
    new Prisma.Decimal(value ?? 0).toDecimalPlaces(
      3,
      Prisma.Decimal.ROUND_HALF_UP,
    ),
  );
}
export function addSourceMoney(left: number, right: any): number {
  return Number(new Prisma.Decimal(left).plus(right ?? 0));
}
export function isPending(status: string, lifecycle = 'OPEN') {
  return (
    ['OPEN', 'PARTIALLY_FULFILLED'].includes(lifecycle) &&
    ['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'PARTIALLY_APPROVED'].includes(
      status,
    )
  );
}
export function isApproved(status: string) {
  return ['APPROVED', 'PARTIALLY_APPROVED'].includes(status);
}
export function effectiveAmounts(
  item: {
    totalAmount: any;
    pendingAmount: any;
    approvedAmount: any;
    openCommitmentAmount?: any;
  },
  status: string,
  lifecycle = 'OPEN',
) {
  const total = sourceMoney(item.totalAmount);
  const pending =
    item.pendingAmount == null ? null : sourceMoney(item.pendingAmount);
  const approved =
    item.approvedAmount == null ? null : sourceMoney(item.approvedAmount);
  if (lifecycle === 'CANCELLED')
    return {
      pending: 0,
      approved: 0,
      open:
        item.openCommitmentAmount == null
          ? null
          : sourceMoney(item.openCommitmentAmount),
    };
  const allPending =
    ['OPEN', 'PARTIALLY_FULFILLED'].includes(lifecycle) &&
    ['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED'].includes(status);
  return {
    pending: pending ?? (allPending ? total : status === 'APPROVED' ? 0 : null),
    approved:
      approved ?? (status === 'APPROVED' ? total : allPending ? 0 : null),
    open:
      item.openCommitmentAmount == null
        ? null
        : sourceMoney(item.openCommitmentAmount),
  };
}
export function monthRange(from: string, to: string) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const count = (ty - fy) * 12 + tm - fm + 1;
  if (count < 1 || count > 12)
    throw new BadRequestException('Selecione um periodo de ate 12 meses');
  return Array.from({ length: count }, (_, index) => {
    const dt = new Date(Date.UTC(fy, fm - 1 + index, 1));
    return {
      competence: dt.toISOString().slice(0, 7),
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
    };
  });
}
