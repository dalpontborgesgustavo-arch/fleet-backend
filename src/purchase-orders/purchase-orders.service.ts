import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  competence,
  effectiveAmounts,
  ensurePurchaseOrderAccess,
  isApproved,
  isPending,
  money,
  monthRange,
  sourceMoney,
  addSourceMoney,
  purchaseOrderHash,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_APPROVAL_STATUSES,
  validatePurchaseOrderSync,
} from './purchase-orders.rules';

type Item = {
  totalAmount: any;
  pendingAmount: any;
  approvedAmount: any;
  openCommitmentAmount: any;
  accountCode: string | null;
  accountName: string | null;
};
type AmountBucket = {
  pending: number;
  approved: number;
  open: number;
  unknownPending: number;
  unknownApproved: number;
  unknownOpen: number;
  unknownItems: number;
};
type ItemAggregate = {
  status: string;
  approvalStatus: string;
  competence: string;
  pendingApproverName: string | null;
  accountCode: string | null;
  accountName: string | null;
  itemCount: number;
  pending: any;
  approved: any;
  open: any;
  unknownPending: number;
  unknownApproved: number;
  unknownOpen: number;
  unknownItems: number;
};
type ApprovalCandidate = {
  sourceUserId: string;
  sourceUserCompanyId: string;
  name: string;
};
type PendingApproval = {
  assignmentType: 'UNASSIGNED';
  stageCode: 'AETHOS_OC_VALUE_AUTHORIZATION';
  completionRule: 'ANY_ONE_VALID_SIGNATURE';
  candidateBasis: 'ACTIVE_COMPANY_LINK_AND_RECORDED_OC_AMOUNT_LIMIT';
  effectivePermissionVerified: false;
  candidateUsers: ApprovalCandidate[];
};
function bucket(): AmountBucket {
  return {
    pending: 0,
    approved: 0,
    open: 0,
    unknownPending: 0,
    unknownApproved: 0,
    unknownOpen: 0,
    unknownItems: 0,
  };
}
function addAggregate(target: AmountBucket, row: ItemAggregate) {
  target.pending = addSourceMoney(target.pending, row.pending);
  target.approved = addSourceMoney(target.approved, row.approved);
  target.open = addSourceMoney(target.open, row.open);
  target.unknownPending += row.unknownPending;
  target.unknownApproved += row.unknownApproved;
  target.unknownOpen += row.unknownOpen;
  target.unknownItems += row.unknownItems;
}
function addItem(
  target: AmountBucket,
  item: Item,
  status: string,
  lifecycle: string,
) {
  const amounts = effectiveAmounts(item, status, lifecycle);
  const pendingRelevant = isPending(status, lifecycle) || status === 'UNKNOWN';
  const closedUnconfirmed =
    !['OPEN', 'PARTIALLY_FULFILLED'].includes(lifecycle) &&
    ['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED'].includes(status);
  const approvedRelevant =
    isApproved(status) || status === 'UNKNOWN' || closedUnconfirmed;
  let incomplete = false;
  if (pendingRelevant) {
    if (amounts.pending === null) {
      target.unknownPending++;
      incomplete = true;
    } else target.pending = addSourceMoney(target.pending, amounts.pending);
  }
  if (approvedRelevant) {
    if (amounts.approved === null) {
      target.unknownApproved++;
      incomplete = true;
    } else target.approved = addSourceMoney(target.approved, amounts.approved);
    if (amounts.approved === null || amounts.approved !== 0) {
      if (amounts.open === null) target.unknownOpen++;
      else target.open = addSourceMoney(target.open, amounts.open);
    }
  }
  if (incomplete) target.unknownItems++;
}
function amountSummary(value: AmountBucket) {
  return {
    pendingAmount: value.unknownPending ? null : money(value.pending),
    approvedAmount: value.unknownApproved ? null : money(value.approved),
    knownPendingAmount: money(value.pending),
    knownApprovedAmount: money(value.approved),
    unknownAmountItems: value.unknownItems,
  };
}
function iso(value: Date | null | undefined) {
  return value?.toISOString() || null;
}
function integer(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
    throw new BadRequestException('Paginacao invalida');
  return parsed;
}
function cleanFilter(value: unknown, max = 300) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException('Filtro invalido');
  return value.trim();
}
function pendingApprovalValue(value: unknown): PendingApproval | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidateUsers = (value as any).candidateUsers;
  if (!Array.isArray(candidateUsers)) return null;
  return value as PendingApproval;
}
function approvalCandidateFilter(value: unknown): string {
  return cleanFilter(value, 300);
}
function serializeOrder(order: any) {
  const totals = bucket();
  if (order.status !== 'CANCELLED')
    (order.items || []).forEach((item: Item) =>
      addItem(totals, item, order.approvalStatus, order.status),
    );
  return {
    id: order.id,
    sourceOrderId: order.sourceOrderId,
    number: order.number,
    companyCode: order.companyCode,
    companyName: order.companyName,
    supplierName: order.supplierName,
    issuedAt: iso(order.issuedAt)?.slice(0, 10),
    competence: order.competence,
    status: order.status,
    sourceStatus: order.sourceStatus,
    approvalStatus: order.approvalStatus,
    sourceApprovalStatus: order.sourceApprovalStatus,
    requesterName: order.requesterName,
    buyerName: order.buyerName,
    pendingApproverName: order.pendingApproverName,
    pendingApproval: pendingApprovalValue(order.pendingApproval),
    approvedByName: order.approvedByName,
    approvedAt: iso(order.approvedAt),
    expectedDeliveryAt: iso(order.expectedDeliveryAt)?.slice(0, 10) || null,
    totalAmount: sourceMoney(order.totalAmount),
    notes: order.notes,
    active: order.active,
    sourceUpdatedAt: iso(order.sourceUpdatedAt),
    extractedAt: iso(order.extractedAt),
    syncedAt: iso(order.syncedAt),
    itemCount: order.items?.length || 0,
    ageDays: isPending(order.approvalStatus, order.status)
      ? Math.max(
          0,
          Math.floor((Date.now() - order.issuedAt.getTime()) / 86400000),
        )
      : null,
    ...amountSummary(totals),
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(body: unknown) {
    const normalized = validatePurchaseOrderSync(body);
    const payloadHash = purchaseOrderHash(normalized);
    const extractedAt = new Date(normalized.extractedAt);
    return this.prisma.$transaction(
      async (tx) => {
        // Serializes source snapshots, including distinct run IDs that contain the same order.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('JR_AETHOS_PURCHASE_ORDER_SYNC'))::text`;
        const previousRun = await tx.aethosPurchaseOrderSyncRun.findUnique({
          where: { runId: normalized.runId },
        });
        if (previousRun) {
          if (previousRun.payloadHash !== payloadHash)
            throw new ConflictException(
              'runId ja utilizado com outro conteudo',
            );
          return {
            runId: previousRun.runId,
            received: previousRun.receivedCount,
            upserted: previousRun.appliedCount,
            skippedStale: previousRun.staleCount,
            unchanged: previousRun.unchangedCount,
            idempotent: true,
          };
        }
        let upserted = 0;
        let skippedStale = 0;
        let unchanged = 0;
        for (const order of normalized.orders) {
          const key = {
            companyCode: order.companyCode,
            sourceOrderId: order.sourceOrderId,
          };
          const current = await tx.aethosPurchaseOrder.findUnique({
            where: { companyCode_sourceOrderId: key },
          });
          const contentHash = purchaseOrderHash(order);
          const sourceUpdatedAt = order.sourceUpdatedAt
            ? new Date(order.sourceUpdatedAt)
            : null;
          if (
            current &&
            (current.extractedAt > extractedAt ||
              (current.sourceUpdatedAt &&
                sourceUpdatedAt &&
                current.sourceUpdatedAt > sourceUpdatedAt))
          ) {
            skippedStale++;
            continue;
          }
          if (
            current &&
            current.extractedAt.getTime() === extractedAt.getTime() &&
            current.contentHash !== contentHash
          ) {
            throw new ConflictException(
              `Conteudos diferentes para a mesma extracao da ordem ${order.number}`,
            );
          }
          if (current?.contentHash === contentHash) {
            await tx.aethosPurchaseOrder.update({
              where: { id: current.id },
              data: {
                extractedAt,
                syncedAt: new Date(),
                lastRunId: normalized.runId,
              },
            });
            unchanged++;
            continue;
          }
          const {
            items,
            issuedAt,
            approvedAt,
            expectedDeliveryAt,
            sourceUpdatedAt: _sourceTime,
            ...header
          } = order;
          const data = {
            ...header,
            issuedAt: new Date(`${issuedAt}T00:00:00.000Z`),
            approvedAt: approvedAt ? new Date(approvedAt) : null,
            expectedDeliveryAt: expectedDeliveryAt
              ? new Date(`${expectedDeliveryAt}T00:00:00.000Z`)
              : null,
            sourceUpdatedAt,
            totalAmount: new Prisma.Decimal(order.totalAmount),
            raw: (order.raw as Prisma.InputJsonValue) ?? Prisma.DbNull,
            pendingApproval:
              (order.pendingApproval as unknown as Prisma.InputJsonValue) ??
              Prisma.DbNull,
            extractedAt,
            contentHash,
            lastRunId: normalized.runId,
            syncedAt: new Date(),
          };
          const saved = await tx.aethosPurchaseOrder.upsert({
            where: { companyCode_sourceOrderId: key },
            create: data,
            update: data,
          });
          // A complete order snapshot replaces its active allocations; historical allocations are retained.
          await tx.aethosPurchaseOrderItem.updateMany({
            where: { orderId: saved.id, active: true },
            data: { active: false },
          });
          for (const item of items) {
            const itemData = {
              ...item,
              active: order.active,
              raw: (item.raw as Prisma.InputJsonValue) ?? Prisma.DbNull,
            };
            await tx.aethosPurchaseOrderItem.upsert({
              where: {
                orderId_sourceItemId: {
                  orderId: saved.id,
                  sourceItemId: item.sourceItemId,
                },
              },
              create: { ...itemData, orderId: saved.id },
              update: itemData,
            });
          }
          await tx.aethosPurchaseOrderHistory.create({
            data: {
              orderId: saved.id,
              runId: normalized.runId,
              status: order.status,
              sourceStatus: order.sourceStatus,
              totalAmount: order.totalAmount,
              active: order.active,
              approvalStatus: order.approvalStatus,
              sourceApprovalStatus: order.sourceApprovalStatus,
              pendingApproverName: order.pendingApproverName,
              pendingApproval:
                (order.pendingApproval as unknown as Prisma.InputJsonValue) ??
                Prisma.DbNull,
              contentHash,
              extractedAt,
              snapshot: order as unknown as Prisma.InputJsonValue,
            },
          });
          upserted++;
        }
        await tx.aethosPurchaseOrderSyncRun.create({
          data: {
            runId: normalized.runId,
            payloadHash,
            extractedAt,
            receivedCount: normalized.orders.length,
            appliedCount: upserted,
            staleCount: skippedStale,
            unchangedCount: unchanged,
          },
        });
        return {
          runId: normalized.runId,
          received: normalized.orders.length,
          upserted,
          skippedStale,
          unchanged,
          idempotent: false,
        };
      },
      { maxWait: 15000, timeout: 120000 },
    );
  }

  async overview(query: Record<string, unknown>, role?: string) {
    ensurePurchaseOrderAccess(role);
    return this.prisma.$transaction(
      (database) => this.overviewSnapshot(query, database),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 15000,
        timeout: 60000,
      },
    );
  }

  private async overviewSnapshot(
    query: Record<string, unknown>,
    database: Prisma.TransactionClient,
  ) {
    const now = new Date();
    const current = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(now);
    const fallback = /^\d{4}-\d{2}$/.test(current)
      ? current
      : now.toISOString().slice(0, 7);
    const competenceFrom = competence(
      query.competenceFrom || fallback,
      'competenceFrom',
    );
    const competenceTo = competence(
      query.competenceTo || competenceFrom,
      'competenceTo',
    );
    const months = monthRange(competenceFrom, competenceTo);
    const status = cleanFilter(query.status);
    if (
      status &&
      !(PURCHASE_ORDER_STATUSES as readonly string[]).includes(status)
    )
      throw new BadRequestException('Status de filtro invalido');
    const approvalStatus = cleanFilter(query.approvalStatus);
    if (
      approvalStatus &&
      !(PURCHASE_ORDER_APPROVAL_STATUSES as readonly string[]).includes(
        approvalStatus,
      )
    )
      throw new BadRequestException('Filtro de aprovacao invalido');
    const responsible = cleanFilter(query.responsible);
    const approvalCandidate = approvalCandidateFilter(query.approvalCandidate);
    const search = cleanFilter(query.search);
    const company = cleanFilter(query.company);
    const page = integer(query.page, 1, 100000);
    const pageSize = integer(query.pageSize, 25, 100);
    const baseWhere: Prisma.AethosPurchaseOrderWhereInput = {
      active: true,
      competence: { gte: competenceFrom, lte: competenceTo },
    };
    const where: Prisma.AethosPurchaseOrderWhereInput = { ...baseWhere };
    if (status) where.status = status;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (company) where.companyCode = company;
    if (responsible) {
      where.pendingApproverName =
        responsible === 'Aprovador não identificado' ? null : responsible;
      where.AND = [
        {
          status: { in: ['OPEN', 'PARTIALLY_FULFILLED'] },
          approvalStatus: {
            in: [
              'PENDING_APPROVAL',
              'REAPPROVAL_REQUIRED',
              'PARTIALLY_APPROVED',
            ],
          },
        },
      ];
    }
    if (approvalCandidate) {
      where.pendingApproval = {
        path: ['candidateUsers'],
        array_contains: [
          {
            name: approvalCandidate,
          },
        ],
      } as any;
      where.AND = [
        ...((Array.isArray(where.AND)
          ? where.AND
          : []) as Prisma.AethosPurchaseOrderWhereInput[]),
        {
          status: { in: ['OPEN', 'PARTIALLY_FULFILLED'] },
          approvalStatus: {
            in: [
              'PENDING_APPROVAL',
              'REAPPROVAL_REQUIRED',
              'PARTIALLY_APPROVED',
            ],
          },
        },
      ];
    }
    const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
    if (search)
      where.OR = [
        { number: { contains: escapedSearch, mode: 'insensitive' } },
        { supplierName: { contains: escapedSearch, mode: 'insensitive' } },
        { requesterName: { contains: escapedSearch, mode: 'insensitive' } },
        { buyerName: { contains: escapedSearch, mode: 'insensitive' } },
        {
          items: {
            some: {
              active: true,
              OR: [
                {
                  description: { contains: escapedSearch, mode: 'insensitive' },
                },
                {
                  accountCode: { contains: escapedSearch, mode: 'insensitive' },
                },
                {
                  accountName: { contains: escapedSearch, mode: 'insensitive' },
                },
              ],
            },
          },
        },
      ];
    const [
      orders,
      orderGroups,
      itemGroups,
      optionRows,
      candidateRows,
      lastSync,
      orderCount,
      budgetData,
    ] = await Promise.all([
      database.aethosPurchaseOrder.findMany({
        where,
        include: {
          items: {
            where: { active: true },
            select: {
              totalAmount: true,
              pendingAmount: true,
              approvedAmount: true,
              openCommitmentAmount: true,
              accountCode: true,
              accountName: true,
            },
          },
        },
        orderBy: [{ issuedAt: 'desc' }, { number: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      database.aethosPurchaseOrder.groupBy({
        by: ['status', 'approvalStatus', 'pendingApproverName'],
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.aggregateItems(
        {
          competenceFrom,
          competenceTo,
          status,
          approvalStatus,
          responsible,
          approvalCandidate,
          search,
          company,
        },
        database,
      ),
      database.aethosPurchaseOrder.findMany({
        where: baseWhere,
        distinct: [
          'status',
          'approvalStatus',
          'companyCode',
          'companyName',
          'pendingApproverName',
        ],
        select: {
          status: true,
          approvalStatus: true,
          companyCode: true,
          companyName: true,
          pendingApproverName: true,
        },
      }),
      database.aethosPurchaseOrder.findMany({
        where: {
          ...baseWhere,
          status: { in: ['OPEN', 'PARTIALLY_FULFILLED'] },
          approvalStatus: {
            in: [
              'PENDING_APPROVAL',
              'REAPPROVAL_REQUIRED',
              'PARTIALLY_APPROVED',
            ],
          },
          pendingApproval: { not: Prisma.DbNull },
        },
        select: { pendingApproval: true },
      }),
      database.aethosPurchaseOrderSyncRun.findFirst({
        orderBy: { createdAt: 'desc' },
      }),
      database.aethosPurchaseOrder.count({ where: { active: true } }),
      this.budgetComparison(months, database),
    ]);
    const totals = bucket();
    const byResponsible = new Map<
      string,
      { count: number; amounts: AmountBucket }
    >();
    const monthly = new Map(
      months.map((month) => [month.competence, bucket()]),
    );
    const accounts = budgetData.accounts;
    const pendingFallback = candidateRows.length
      ? 'Alçada coletiva do Aethos'
      : 'Aprovador não identificado';
    let totalAmount = 0;
    let totalOrders = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let unmappedItems = 0;
    for (const groupRow of orderGroups) {
      totalAmount = addSourceMoney(totalAmount, groupRow._sum.totalAmount);
      totalOrders += groupRow._count._all;
      if (
        groupRow.status !== 'CANCELLED' &&
        isApproved(groupRow.approvalStatus)
      )
        approvedCount += groupRow._count._all;
      if (
        groupRow.status !== 'CANCELLED' &&
        isPending(groupRow.approvalStatus, groupRow.status)
      ) {
        pendingCount += groupRow._count._all;
        const pendingName = groupRow.pendingApproverName || pendingFallback;
        const group = byResponsible.get(pendingName) || {
          count: 0,
          amounts: bucket(),
        };
        group.count += groupRow._count._all;
        byResponsible.set(pendingName, group);
      }
    }
    for (const item of itemGroups) {
      addAggregate(totals, item);
      addAggregate(monthly.get(item.competence)!, item);
      if (isPending(item.approvalStatus, item.status)) {
        const entry = byResponsible.get(
          item.pendingApproverName || pendingFallback,
        );
        if (entry) addAggregate(entry.amounts, item);
      }
      if (!item.accountCode) {
        unmappedItems += item.itemCount;
        continue;
      }
      const account = accounts.get(item.accountCode) || {
        code: item.accountCode,
        name: item.accountName || item.accountCode,
        budget: 0,
        budgetMonths: new Set<string>(),
        actual: 0,
        amounts: bucket(),
      };
      addAggregate(account.amounts, item);
      accounts.set(item.accountCode, account);
    }
    const accountRows = Array.from(accounts.values())
      .map((account) => {
        const budget =
          account.budgetMonths.size === months.length
            ? money(account.budget)
            : null;
        const values = amountSummary(account.amounts);
        const openCommitment = account.amounts.unknownOpen
          ? null
          : money(account.amounts.open);
        const balance =
          budget === null
            ? null
            : money(new Prisma.Decimal(account.budget).minus(account.actual));
        return {
          code: account.code,
          name: account.name,
          budget,
          actual: money(account.actual),
          approved: values.approvedAmount,
          pending: values.pendingAmount,
          knownApprovedAmount: values.knownApprovedAmount,
          knownPendingAmount: values.knownPendingAmount,
          openCommitment,
          balance,
          projectedBalance:
            balance === null || openCommitment === null
              ? null
              : money(
                  new Prisma.Decimal(account.budget)
                    .minus(account.actual)
                    .minus(account.amounts.open),
                ),
          unknownAmountItems: values.unknownAmountItems,
        };
      })
      .sort(
        (a, b) =>
          (b.pending || 0) +
            (b.approved || 0) -
            (a.pending || 0) -
            (a.approved || 0) || a.name.localeCompare(b.name),
      );
    const companyOptions = new Map<string, string>();
    optionRows.forEach((row) =>
      companyOptions.set(row.companyCode, row.companyName || row.companyCode),
    );
    const approvalCandidates = new Set<string>();
    candidateRows.forEach((row) => {
      const context = pendingApprovalValue(row.pendingApproval);
      context?.candidateUsers.forEach((candidate) => {
        approvalCandidates.add(candidate.name);
      });
    });
    return {
      filters: {
        competenceFrom,
        competenceTo,
        status: status || null,
        approvalStatus: approvalStatus || null,
        responsible: responsible || null,
        approvalCandidate: approvalCandidate || null,
        search: search || null,
        company: company || null,
      },
      summary: {
        ordersCount: totalOrders,
        totalAmount: money(totalAmount),
        pendingCount,
        approvedCount,
        unmappedItems,
        ...amountSummary(totals),
      },
      orders: orders.map(serializeOrder),
      pagination: {
        page,
        pageSize,
        total: totalOrders,
        pages: Math.ceil(totalOrders / pageSize),
      },
      byResponsible: Array.from(byResponsible.entries())
        .map(([name, entry]) => ({
          name,
          count: entry.count,
          amount: entry.amounts.unknownPending
            ? null
            : money(entry.amounts.pending),
          knownAmount: money(entry.amounts.pending),
          unknownAmountItems: entry.amounts.unknownItems,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      monthly: Array.from(monthly.entries()).map(([competence, values]) => ({
        competence,
        ...amountSummary(values),
      })),
      accounts: accountRows,
      options: {
        statuses: [...PURCHASE_ORDER_STATUSES],
        approvalStatuses: [...PURCHASE_ORDER_APPROVAL_STATUSES],
        companies: Array.from(companyOptions.entries())
          .map(([code, name]) => ({ code, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        responsibles: Array.from(
          new Set(
            optionRows
              .filter((row) => isPending(row.approvalStatus, row.status))
              .map((row) => row.pendingApproverName || pendingFallback),
          ),
        ).sort(),
        approvalCandidates: Array.from(approvalCandidates).sort((left, right) =>
          left.localeCompare(right, 'pt-BR'),
        ),
      },
      sync: {
        lastSyncAt: iso(lastSync?.createdAt),
        extractedAt: iso(lastSync?.extractedAt),
        orderCount,
        approvalAvailable: false,
      },
      budgetScope: 'CONSOLIDATED',
      scopeNote:
        'Orcamento e realizado consideram todos os lancamentos do periodo. Filtros de empresa, situacao, pessoa e busca afetam somente as ordens de compra. O saldo projetado usa apenas compromissos em aberto informados pelo Aethos.',
      missingBudgetCompetences: budgetData.missingCompetences,
    };
  }

  private async aggregateItems(
    filters: {
      competenceFrom: string;
      competenceTo: string;
      status: string;
      approvalStatus: string;
      responsible: string;
      approvalCandidate: string;
      search: string;
      company: string;
    },
    database: Prisma.TransactionClient,
  ) {
    const conditions = [
      Prisma.sql`o."active" = true`,
      Prisma.sql`o."competence" >= ${filters.competenceFrom}`,
      Prisma.sql`o."competence" <= ${filters.competenceTo}`,
    ];
    if (filters.status)
      conditions.push(Prisma.sql`o."status" = ${filters.status}`);
    if (filters.approvalStatus)
      conditions.push(
        Prisma.sql`o."approvalStatus" = ${filters.approvalStatus}`,
      );
    if (filters.company)
      conditions.push(Prisma.sql`o."companyCode" = ${filters.company}`);
    if (filters.responsible) {
      conditions.push(
        filters.responsible === 'Aprovador não identificado'
          ? Prisma.sql`o."pendingApproverName" IS NULL`
          : Prisma.sql`o."pendingApproverName" = ${filters.responsible}`,
        Prisma.sql`o."status" IN ('OPEN','PARTIALLY_FULFILLED')`,
        Prisma.sql`o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED','PARTIALLY_APPROVED')`,
      );
    }
    if (filters.approvalCandidate) {
      conditions.push(
        Prisma.sql`o."pendingApproval"->'candidateUsers' @> ${JSON.stringify([
          {
            name: filters.approvalCandidate,
          },
        ])}::jsonb`,
        Prisma.sql`o."status" IN ('OPEN','PARTIALLY_FULFILLED')`,
        Prisma.sql`o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED','PARTIALLY_APPROVED')`,
      );
    }
    if (filters.search) {
      const pattern = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        Prisma.sql`(o."number" ILIKE ${pattern} OR o."supplierName" ILIKE ${pattern} OR o."requesterName" ILIKE ${pattern} OR o."buyerName" ILIKE ${pattern} OR EXISTS (SELECT 1 FROM "AethosPurchaseOrderItem" s WHERE s."orderId"=o."id" AND s."active"=true AND (s."description" ILIKE ${pattern} OR s."accountCode" ILIKE ${pattern} OR s."accountName" ILIKE ${pattern})))`,
      );
    }
    return database.$queryRaw<ItemAggregate[]>(Prisma.sql`
      WITH effective AS (
        SELECT o."status", o."approvalStatus", o."competence", o."pendingApproverName", i."accountCode", i."accountName", i."openCommitmentAmount",
          COALESCE(i."pendingAmount", CASE WHEN o."status" IN ('OPEN','PARTIALLY_FULFILLED') AND o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED') THEN i."totalAmount" WHEN o."approvalStatus"='APPROVED' THEN 0 ELSE NULL END) AS pending,
          COALESCE(i."approvedAmount", CASE WHEN o."approvalStatus"='APPROVED' THEN i."totalAmount" WHEN o."status" IN ('OPEN','PARTIALLY_FULFILLED') AND o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED') THEN 0 ELSE NULL END) AS approved,
          (o."status"<>'CANCELLED' AND ((o."status" IN ('OPEN','PARTIALLY_FULFILLED') AND o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED','PARTIALLY_APPROVED')) OR o."approvalStatus"='UNKNOWN')) AS pending_relevant,
          (o."status"<>'CANCELLED' AND (o."approvalStatus" IN ('APPROVED','PARTIALLY_APPROVED','UNKNOWN') OR (o."status" NOT IN ('OPEN','PARTIALLY_FULFILLED') AND o."approvalStatus" IN ('PENDING_APPROVAL','REAPPROVAL_REQUIRED')))) AS approved_relevant
        FROM "AethosPurchaseOrder" o JOIN "AethosPurchaseOrderItem" i ON i."orderId"=o."id" AND i."active"=true
        WHERE ${Prisma.join(conditions, ' AND ')}
      )
      SELECT "status", "approvalStatus", "competence", "pendingApproverName", "accountCode", MAX("accountName") AS "accountName", COUNT(*)::int AS "itemCount",
        COALESCE(SUM(CASE WHEN pending_relevant THEN pending ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN approved_relevant THEN approved ELSE 0 END),0) AS approved,
        COALESCE(SUM(CASE WHEN approved_relevant AND (approved IS NULL OR approved<>0) THEN "openCommitmentAmount" ELSE 0 END),0) AS open,
        COUNT(*) FILTER (WHERE pending_relevant AND pending IS NULL)::int AS "unknownPending",
        COUNT(*) FILTER (WHERE approved_relevant AND approved IS NULL)::int AS "unknownApproved",
        COUNT(*) FILTER (WHERE approved_relevant AND (approved IS NULL OR approved<>0) AND "openCommitmentAmount" IS NULL)::int AS "unknownOpen",
        COUNT(*) FILTER (WHERE (pending_relevant AND pending IS NULL) OR (approved_relevant AND approved IS NULL))::int AS "unknownItems"
      FROM effective GROUP BY "status", "approvalStatus", "competence", "pendingApproverName", "accountCode"
    `);
  }

  private async budgetComparison(
    months: ReturnType<typeof monthRange>,
    database: Prisma.TransactionClient,
  ) {
    const years = Array.from(new Set(months.map((month) => month.year)));
    const [versions, actuals] = await Promise.all([
      database.budgetVersion.findMany({
        where: { year: { in: years }, active: true },
        orderBy: { importedAt: 'desc' },
        include: {
          lines: {
            where: { active: true },
            include: {
              monthlyBudgets: {
                where: {
                  OR: months.map(({ year, month }) => ({ year, month })),
                },
              },
            },
          },
        },
      }),
      database.aethosPlanoContaCost.groupBy({
        by: ['codigoPlanoConta'],
        where: {
          active: true,
          competencia: { in: months.map((month) => month.competence) },
          OR: [{ status: null }, { status: { not: 'APR' } }],
        },
        _sum: { valorCusto: true },
        _max: { nomePlanoConta: true },
      }),
    ]);
    const latest = new Map<number, (typeof versions)[number]>();
    for (const version of versions)
      if (!latest.has(version.year)) latest.set(version.year, version);
    const accounts = new Map<
      string,
      {
        code: string;
        name: string;
        budget: number;
        budgetMonths: Set<string>;
        actual: number;
        amounts: AmountBucket;
      }
    >();
    for (const month of months) {
      const version = latest.get(month.year);
      if (!version) continue;
      for (const line of version.lines) {
        const entry = accounts.get(line.idSubgrupo) || {
          code: line.idSubgrupo,
          name: line.descricao,
          budget: 0,
          budgetMonths: new Set<string>(),
          actual: 0,
          amounts: bucket(),
        };
        const monthly = line.monthlyBudgets.find(
          (value) => value.year === month.year && value.month === month.month,
        );
        entry.budget = addSourceMoney(
          entry.budget,
          monthly?.amount ?? line.monthlyCost,
        );
        entry.budgetMonths.add(month.competence);
        accounts.set(line.idSubgrupo, entry);
      }
    }
    for (const actual of actuals) {
      const entry = accounts.get(actual.codigoPlanoConta) || {
        code: actual.codigoPlanoConta,
        name: actual._max.nomePlanoConta || actual.codigoPlanoConta,
        budget: 0,
        budgetMonths: new Set<string>(),
        actual: 0,
        amounts: bucket(),
      };
      entry.actual = Number(actual._sum.valorCusto || 0);
      accounts.set(entry.code, entry);
    }
    return {
      accounts,
      missingCompetences: months
        .filter((month) => !latest.has(month.year))
        .map((month) => month.competence),
    };
  }

  async detail(id: string, role?: string) {
    ensurePurchaseOrderAccess(role);
    const order = await this.prisma.aethosPurchaseOrder.findUnique({
      where: { id },
      include: {
        items: { where: { active: true }, orderBy: { sourceItemId: 'asc' } },
        history: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!order) throw new NotFoundException('Ordem de compra nao encontrada');
    return {
      order: serializeOrder(order),
      items: order.items.map((item) => ({
        id: item.id,
        sourceItemId: item.sourceItemId,
        lineType: item.lineType,
        description: item.description,
        quantity: item.quantity === null ? null : Number(item.quantity),
        unit: item.unit,
        unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
        totalAmount: sourceMoney(item.totalAmount),
        accountCode: item.accountCode,
        accountName: item.accountName,
        pendingAmount: effectiveAmounts(
          item,
          order.approvalStatus,
          order.status,
        ).pending,
        approvedAmount: effectiveAmounts(
          item,
          order.approvalStatus,
          order.status,
        ).approved,
        openCommitmentAmount:
          item.openCommitmentAmount === null
            ? null
            : sourceMoney(item.openCommitmentAmount),
      })),
      history: order.history.map((entry) => ({
        id: entry.id,
        runId: entry.runId,
        status: entry.status,
        sourceStatus: entry.sourceStatus,
        approvalStatus: entry.approvalStatus,
        sourceApprovalStatus: entry.sourceApprovalStatus,
        totalAmount: sourceMoney(entry.totalAmount),
        active: entry.active,
        pendingApproverName: entry.pendingApproverName,
        pendingApproval: pendingApprovalValue(entry.pendingApproval),
        extractedAt: iso(entry.extractedAt),
        createdAt: iso(entry.createdAt),
      })),
    };
  }
}
