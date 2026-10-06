import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  dateKey,
  optionalText,
  parseDate,
  parsePositiveInteger,
} from './usina-asphalt-teams.rules';

export const USINA_ASPHALT_FLEET_FREIGHT_DATASET =
  'ASPHALT_TEAM_FLEET_FREIGHT' as const;

export const USINA_ASPHALT_FLEET_CATEGORIES = [
  'VIBROACABADORA',
  'ROLO_LISO',
  'ROLO_PNEUS',
  'MICROONIBUS',
  'VEICULO_APOIO',
] as const;

export type UsinaAsphaltFleetCategory =
  (typeof USINA_ASPHALT_FLEET_CATEGORIES)[number];

export const USINA_ASPHALT_FLEET_CATEGORY_LABELS: Record<
  UsinaAsphaltFleetCategory,
  string
> = {
  VIBROACABADORA: 'Vibroacabadora',
  ROLO_LISO: 'Rolo liso',
  ROLO_PNEUS: 'Rolo pneus',
  MICROONIBUS: 'Microonibus',
  VEICULO_APOIO: 'Veiculo apoio',
};

export function monthEnd(value: Date | string) {
  const date = new Date(`${dateKey(value).slice(0, 7)}-01T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function normalizeCompetence(value: unknown) {
  const competence = parseDate(value, 'Competencia');
  if (competence.getUTCDate() !== 1) {
    throw new BadRequestException('Competencia deve ser o primeiro dia do mes');
  }
  return competence;
}

export function normalizeFleetCategory(value: unknown) {
  const category = String(value || '')
    .trim()
    .toUpperCase();
  if (
    !USINA_ASPHALT_FLEET_CATEGORIES.includes(
      category as UsinaAsphaltFleetCategory,
    )
  ) {
    throw new BadRequestException('Categoria de frota invalida');
  }
  return category as UsinaAsphaltFleetCategory;
}

export function normalizeFleetAssignmentInput(body: any) {
  const competence = normalizeCompetence(body?.competence);
  const validFrom = parseDate(body?.validFrom || dateKey(competence), 'Inicio');
  const validTo = parseDate(
    body?.validTo || dateKey(monthEnd(competence)),
    'Fim',
  );
  if (validFrom > validTo) {
    throw new BadRequestException('Fim nao pode ser anterior ao inicio');
  }
  if (
    dateKey(validFrom).slice(0, 7) !== dateKey(competence).slice(0, 7) ||
    dateKey(validTo).slice(0, 7) !== dateKey(competence).slice(0, 7)
  ) {
    throw new BadRequestException(
      'O periodo deve estar contido na competencia',
    );
  }
  return {
    competence,
    aethosVehicleId: parsePositiveInteger(
      body?.aethosVehicleId,
      'ID_VEICULO Aethos',
    ),
    fleetNumber: optionalText(body?.fleetNumber, 40),
    plate: optionalText(body?.plate, 20)?.toUpperCase() || null,
    category: normalizeFleetCategory(body?.category),
    validFrom,
    validTo,
    observation: optionalText(body?.observation, 500),
  };
}

type FleetFact = {
  id?: string;
  sourceRecordId: string;
  sourceKind: string;
  sourceDocumentId: string;
  sourceInstallmentId?: string | null;
  occurredDate: Date | string;
  competence: Date | string;
  aethosVehicleId: number;
  fleetNumber?: string | null;
  plate?: string | null;
  freightTypeId: number;
  freightTypeDescription?: string | null;
  quantity?: Prisma.Decimal | string | number | null;
  unit?: string | null;
  amount: Prisma.Decimal | string | number;
  active?: boolean;
};

type FleetAssignment = {
  id: string;
  teamId: string;
  aethosVehicleId: number;
  fleetNumber?: string | null;
  plate?: string | null;
  category: string;
  validFrom: Date | string;
  validTo: Date | string;
  deletedAt?: Date | string | null;
};

type TeamProfile = {
  id: string;
  teamId: string;
  businessCode: string;
  displayName: string;
  responsibleName?: string | null;
  validFrom: Date | string;
  validTo?: Date | string | null;
  deletedAt?: Date | string | null;
};

function containsDate(
  entity: {
    validFrom: Date | string;
    validTo?: Date | string | null;
    deletedAt?: unknown;
  },
  target: string,
) {
  return (
    !entity.deletedAt &&
    dateKey(entity.validFrom) <= target &&
    (!entity.validTo || dateKey(entity.validTo) >= target)
  );
}

type FreightBucket = {
  count: number;
  amount: Prisma.Decimal;
  facts: Array<Record<string, unknown>>;
};

function emptyBucket(): FreightBucket {
  return { count: 0, amount: new Prisma.Decimal(0), facts: [] };
}

function addFact(
  bucket: FreightBucket,
  fact: FleetFact,
  extra: Record<string, unknown> = {},
  includeFact = true,
) {
  bucket.count += 1;
  bucket.amount = bucket.amount.plus(fact.amount);
  if (!includeFact) return;
  bucket.facts.push({
    sourceRecordId: fact.sourceRecordId,
    sourceKind: fact.sourceKind,
    sourceDocumentId: fact.sourceDocumentId,
    sourceInstallmentId: fact.sourceInstallmentId || null,
    occurredDate: dateKey(fact.occurredDate),
    aethosVehicleId: fact.aethosVehicleId,
    fleetNumber: fact.fleetNumber || null,
    plate: fact.plate || null,
    freightTypeId: fact.freightTypeId,
    freightTypeDescription: fact.freightTypeDescription || null,
    quantity:
      fact.quantity === null || fact.quantity === undefined
        ? null
        : new Prisma.Decimal(fact.quantity).toFixed(6),
    unit: fact.unit || null,
    amount: new Prisma.Decimal(fact.amount).toFixed(6),
    ...extra,
  });
}

function serializeBucket(
  bucket: FreightBucket,
  covered: boolean,
  includeFacts: boolean,
) {
  return {
    documents: covered ? bucket.count : null,
    amount: covered ? bucket.amount.toFixed(6) : null,
    ...(includeFacts ? { facts: bucket.facts } : {}),
  };
}

export function reconcileUsinaAsphaltFleetFreights(input: {
  year: number;
  facts: FleetFact[];
  assignments: FleetAssignment[];
  teamProfiles: TeamProfile[];
  coveredCompetences?: Iterable<string>;
  includeFacts?: boolean;
}) {
  const covered = new Set(input.coveredCompetences || []);
  const factKeys = new Set<string>();
  const duplicateFactKeys = new Set<string>();
  const facts = input.facts.filter((fact) => {
    if (fact.active === false) return false;
    if (factKeys.has(fact.sourceRecordId)) {
      duplicateFactKeys.add(fact.sourceRecordId);
      return false;
    }
    factKeys.add(fact.sourceRecordId);
    covered.add(`${dateKey(fact.occurredDate).slice(0, 7)}-01`);
    return true;
  });

  const months = Array.from({ length: 12 }, (_, index) => {
    const competence = `${input.year}-${String(index + 1).padStart(2, '0')}-01`;
    const end = dateKey(monthEnd(competence));
    const isCovered = covered.has(competence);
    const eligible = emptyBucket();
    const pending = emptyBucket();
    const pendingReasons = new Map<string, FreightBucket>();
    const byTeam = new Map<
      string,
      Map<UsinaAsphaltFleetCategory, FreightBucket>
    >();

    for (const profile of input.teamProfiles) {
      if (
        !profile.deletedAt &&
        dateKey(profile.validFrom) <= end &&
        (!profile.validTo || dateKey(profile.validTo) >= competence)
      ) {
        if (!byTeam.has(profile.teamId)) byTeam.set(profile.teamId, new Map());
      }
    }

    for (const fact of facts) {
      const occurred = dateKey(fact.occurredDate);
      if (occurred < competence || occurred > end) continue;
      addFact(eligible, fact, {}, Boolean(input.includeFacts));
      const matches = input.assignments.filter(
        (item) =>
          item.aethosVehicleId === fact.aethosVehicleId &&
          containsDate(item, occurred),
      );
      let reason: string | null = null;
      if (!matches.length) reason = 'FROTA_SEM_CADASTRO_MENSAL';
      else if (matches.length > 1) reason = 'CONFLITO_DE_VIGENCIA';
      const assignment = matches.length === 1 ? matches[0] : null;
      const profiles = assignment
        ? input.teamProfiles.filter(
            (profile) =>
              profile.teamId === assignment.teamId &&
              containsDate(profile, occurred),
          )
        : [];
      if (!reason && profiles.length !== 1) {
        reason = profiles.length
          ? 'VERSAO_DA_EQUIPE_AMBIGUA'
          : 'VERSAO_DA_EQUIPE_AUSENTE';
      }
      const category = assignment
        ? normalizeFleetCategory(assignment.category)
        : null;
      if (reason || !assignment || !category) {
        const code = reason || 'CATEGORIA_AUSENTE';
        addFact(
          pending,
          fact,
          { pendingReason: code },
          Boolean(input.includeFacts),
        );
        const bucket = pendingReasons.get(code) || emptyBucket();
        addFact(
          bucket,
          fact,
          { pendingReason: code },
          Boolean(input.includeFacts),
        );
        pendingReasons.set(code, bucket);
        continue;
      }
      const categories = byTeam.get(assignment.teamId) || new Map();
      const bucket = categories.get(category) || emptyBucket();
      addFact(
        bucket,
        fact,
        {
          teamId: assignment.teamId,
          assignmentId: assignment.id,
          category,
        },
        Boolean(input.includeFacts),
      );
      categories.set(category, bucket);
      byTeam.set(assignment.teamId, categories);
    }

    const teams = [...byTeam.entries()]
      .map(([teamId, categories]) => {
        const profile = input.teamProfiles
          .filter(
            (item) =>
              item.teamId === teamId &&
              !item.deletedAt &&
              dateKey(item.validFrom) <= end &&
              (!item.validTo || dateKey(item.validTo) >= competence),
          )
          .sort((a, b) =>
            dateKey(a.validFrom).localeCompare(dateKey(b.validFrom)),
          )
          .at(-1);
        return {
          teamId,
          businessCode: profile?.businessCode || null,
          displayName: profile?.displayName || null,
          responsibleName: profile?.responsibleName || null,
          categories: USINA_ASPHALT_FLEET_CATEGORIES.map((category) => ({
            category,
            label: USINA_ASPHALT_FLEET_CATEGORY_LABELS[category],
            ...serializeBucket(
              categories.get(category) || emptyBucket(),
              isCovered,
              Boolean(input.includeFacts),
            ),
          })),
        };
      })
      .sort((a, b) =>
        String(a.businessCode || '').localeCompare(
          String(b.businessCode || ''),
          'pt-BR',
          {
            numeric: true,
          },
        ),
      );
    const assigned = teams.reduce(
      (sum, team) =>
        team.categories.reduce(
          (inner, row) => inner.plus(row.amount || 0),
          sum,
        ),
      new Prisma.Decimal(0),
    );
    const delta = isCovered
      ? eligible.amount.minus(assigned).minus(pending.amount).toFixed(6)
      : null;
    return {
      competence,
      covered: isCovered,
      eligible: serializeBucket(
        eligible,
        isCovered,
        Boolean(input.includeFacts),
      ),
      teams,
      pending: {
        ...serializeBucket(pending, isCovered, Boolean(input.includeFacts)),
        reasons: [...pendingReasons.entries()].map(([reason, bucket]) => ({
          reason,
          ...serializeBucket(bucket, isCovered, Boolean(input.includeFacts)),
        })),
      },
      closure: {
        formula: 'soma_equipes + pendencias = faturamento_elegivel',
        deltaAmount: delta,
        closed: delta === null ? null : new Prisma.Decimal(delta).eq(0),
      },
    };
  });

  return {
    year: input.year,
    categories: USINA_ASPHALT_FLEET_CATEGORIES.map((category) => ({
      category,
      label: USINA_ASPHALT_FLEET_CATEGORY_LABELS[category],
    })),
    months,
    integrity: {
      duplicateFactKeys: [...duplicateFactKeys].sort(),
      duplicateFactCount: duplicateFactKeys.size,
      everyMonthClosed: months.every((month) => month.closure.closed !== false),
      assignmentSource: 'JR_MANUAL_MONTHLY',
    },
  };
}
