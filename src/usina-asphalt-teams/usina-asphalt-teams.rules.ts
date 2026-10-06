import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const USINA_ASPHALT_TEAM_CONTEXT = {
  companyId: 'JR_CONSTRUCOES',
  companyName: 'JR Construções',
  unitId: 'USINA_ASFALTO_ICARA',
  unitName: 'Usina de Asfalto de Içara',
} as const;

const FULL_ACCESS_ROLES = new Set([
  'licitacao_gestor',
  'admin',
  'administrador',
  'gestor',
  'ceo',
]);
const SETTINGS_ACCESS_ROLES = new Set([
  'licitacao_gestor',
  'admin',
  'administrador',
  'licitacao',
]);

function normalizeRole(role?: string | null) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

export function canAccessUsinaAsphaltTeams(role?: string | null) {
  return FULL_ACCESS_ROLES.has(normalizeRole(role));
}

export function canAccessUsinaAsphaltTeamSettings(role?: string | null) {
  return SETTINGS_ACCESS_ROLES.has(normalizeRole(role));
}

export function dateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function parseDate(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateKey(date) !== text) {
    throw new BadRequestException(`${field} invalida`);
  }
  return date;
}

export function parseOptionalDate(value: unknown, field: string) {
  if (value === null || value === undefined || String(value).trim() === '')
    return null;
  return parseDate(value, field);
}

export function requiredText(value: unknown, field: string, max: number) {
  const text = String(value ?? '').trim();
  if (!text) throw new BadRequestException(`${field} e obrigatorio`);
  if (text.length > max) {
    throw new BadRequestException(
      `${field} deve ter no maximo ${max} caracteres`,
    );
  }
  return text;
}

export function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new BadRequestException(`Texto deve ter no maximo ${max} caracteres`);
  }
  return text;
}

export function parsePositiveInteger(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException(`${field} deve ser um inteiro positivo`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} deve ser maior que zero`);
  }
  return parsed;
}

export function normalizeTeamInput(body: any) {
  const validFrom = parseDate(body?.validFrom, 'Inicio de vigencia');
  const validTo = parseOptionalDate(body?.validTo, 'Fim de vigencia');
  if (validTo && validTo < validFrom) {
    throw new BadRequestException(
      'Fim de vigencia nao pode ser anterior ao inicio',
    );
  }
  return {
    businessCode: requiredText(
      body?.businessCode,
      'Codigo da equipe',
      30,
    ).toUpperCase(),
    displayName: requiredText(body?.displayName, 'Nome da equipe', 120),
    responsibleName: optionalText(body?.responsibleName, 120),
    validFrom,
    validTo,
    changeReason: optionalText(body?.changeReason, 500),
  };
}

export function normalizeAssignmentInput(body: any) {
  const validFrom = parseDate(body?.validFrom, 'Inicio de vigencia');
  const validTo = parseOptionalDate(body?.validTo, 'Fim de vigencia');
  if (validTo && validTo < validFrom) {
    throw new BadRequestException(
      'Fim de vigencia nao pode ser anterior ao inicio',
    );
  }
  return {
    aethosProductId: parsePositiveInteger(
      body?.aethosProductId,
      'ID_ITEM Aethos',
    ),
    validFrom,
    validTo,
    changeReason: optionalText(body?.changeReason, 500),
  };
}

type DateRangeEntity = {
  validFrom: Date | string;
  validTo?: Date | string | null;
  deletedAt?: Date | string | null;
};

export function containsDate(entity: DateRangeEntity, target: string) {
  if (entity.deletedAt) return false;
  const from = dateKey(entity.validFrom);
  const to = entity.validTo ? dateKey(entity.validTo) : null;
  return from <= target && (!to || to >= target);
}

function overlapsMonth(
  entity: DateRangeEntity,
  monthStart: string,
  monthEnd: string,
) {
  if (entity.deletedAt) return false;
  const from = dateKey(entity.validFrom);
  const to = entity.validTo ? dateKey(entity.validTo) : null;
  return from <= monthEnd && (!to || to >= monthStart);
}

export type ReconciliationFact = {
  id?: string;
  source?: string;
  sourceRecordId: string;
  weighingId: string;
  aethosProductId: number;
  productDescription: string;
  occurredDate: Date | string;
  competence: Date | string;
  quantityTon: Prisma.Decimal | string | number;
  active?: boolean;
  contentHash?: string;
};

export type ReconciliationTeam = DateRangeEntity & {
  id: string;
};

export type ReconciliationVersion = DateRangeEntity & {
  id: string;
  teamId: string;
  version: number;
  businessCode: string;
  displayName: string;
  responsibleName?: string | null;
};

export type ReconciliationAssignment = DateRangeEntity & {
  id: string;
  teamId: string;
  aethosProductId: number;
  version: number;
};

type Bucket = {
  tickets: number;
  tons: Prisma.Decimal;
  itemIds: Set<number>;
  facts: Array<Record<string, unknown>>;
};

function emptyBucket(): Bucket {
  return {
    tickets: 0,
    tons: new Prisma.Decimal(0),
    itemIds: new Set(),
    facts: [],
  };
}

function addFact(
  bucket: Bucket,
  fact: ReconciliationFact,
  extra: Record<string, unknown> = {},
  includeFact = true,
) {
  const quantity = new Prisma.Decimal(fact.quantityTon);
  bucket.tickets += 1;
  bucket.tons = bucket.tons.plus(quantity);
  bucket.itemIds.add(fact.aethosProductId);
  if (!includeFact) return;
  bucket.facts.push({
    sourceRecordId: fact.sourceRecordId,
    weighingId: fact.weighingId,
    aethosProductId: fact.aethosProductId,
    productDescription: fact.productDescription,
    occurredDate: dateKey(fact.occurredDate),
    quantityTon: quantity.toFixed(6),
    contentHash: fact.contentHash || null,
    ...extra,
  });
}

function serializeBucket(
  bucket: Bucket,
  covered: boolean,
  includeFacts = false,
) {
  return {
    tickets: covered ? bucket.tickets : null,
    totalTon: covered ? bucket.tons.toFixed(6) : null,
    itemIds: [...bucket.itemIds].sort((a, b) => a - b),
    ...(includeFacts ? { facts: bucket.facts } : {}),
  };
}

export function reconcileUsinaAsphaltTeams(input: {
  year: number;
  facts: ReconciliationFact[];
  teams: ReconciliationTeam[];
  versions: ReconciliationVersion[];
  assignments: ReconciliationAssignment[];
  coveredCompetences?: Iterable<string>;
  includeFacts?: boolean;
}) {
  const { year } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const teams = input.teams.filter(
    (team) => !team.deletedAt && overlapsMonth(team, yearStart, yearEnd),
  );
  const versions = input.versions.filter((item) => !item.deletedAt);
  const assignments = input.assignments.filter((item) => !item.deletedAt);
  const covered = new Set(input.coveredCompetences || []);

  const duplicateFactKeys: string[] = [];
  const factsByKey = new Map<string, ReconciliationFact>();
  for (const fact of input.facts) {
    if (fact.active === false) continue;
    const occurred = dateKey(fact.occurredDate);
    if (occurred < yearStart || occurred > yearEnd) continue;
    if (factsByKey.has(fact.sourceRecordId)) {
      duplicateFactKeys.push(fact.sourceRecordId);
      continue;
    }
    factsByKey.set(fact.sourceRecordId, fact);
    covered.add(`${occurred.slice(0, 7)}-01`);
  }

  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const competence = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
    const monthEnd = new Date(nextMonth.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const isCovered = covered.has(competence);
    const eligible = emptyBucket();
    const pending = emptyBucket();
    const pendingReasons = new Map<string, Bucket>();
    const teamBuckets = new Map<string, Bucket>();

    for (const team of teams) {
      if (overlapsMonth(team, competence, monthEnd))
        teamBuckets.set(team.id, emptyBucket());
    }

    for (const fact of factsByKey.values()) {
      const occurred = dateKey(fact.occurredDate);
      if (occurred < competence || occurred > monthEnd) continue;
      addFact(eligible, fact, {}, Boolean(input.includeFacts));

      const matches = assignments.filter(
        (assignment) =>
          assignment.aethosProductId === fact.aethosProductId &&
          containsDate(assignment, occurred),
      );
      let reason: string | null = null;
      let assignment: ReconciliationAssignment | null = null;
      if (matches.length === 0) reason = 'PENDENTE_NAO_ATRIBUIDO';
      else if (matches.length > 1) reason = 'ATRIBUICAO_AMBIGUA';
      else assignment = matches[0];

      const team = assignment
        ? teams.find((item) => item.id === assignment!.teamId)
        : null;
      if (!reason && (!team || !containsDate(team, occurred)))
        reason = 'EQUIPE_FORA_DA_VIGENCIA';

      const profileMatches = assignment
        ? versions.filter(
            (version) =>
              version.teamId === assignment!.teamId &&
              containsDate(version, occurred),
          )
        : [];
      if (!reason && profileMatches.length === 0)
        reason = 'VERSAO_DA_EQUIPE_AUSENTE';
      else if (!reason && profileMatches.length > 1)
        reason = 'VERSAO_DA_EQUIPE_AMBIGUA';

      if (reason) {
        addFact(
          pending,
          fact,
          { pendingReason: reason },
          Boolean(input.includeFacts),
        );
        const reasonBucket = pendingReasons.get(reason) || emptyBucket();
        addFact(
          reasonBucket,
          fact,
          { pendingReason: reason },
          Boolean(input.includeFacts),
        );
        pendingReasons.set(reason, reasonBucket);
        continue;
      }

      const profile = profileMatches[0];
      const bucket = teamBuckets.get(profile.teamId) || emptyBucket();
      addFact(
        bucket,
        fact,
        {
          teamId: profile.teamId,
          teamVersionId: profile.id,
          assignmentId: assignment!.id,
          assignmentVersion: assignment!.version,
          businessCode: profile.businessCode,
          displayName: profile.displayName,
        },
        Boolean(input.includeFacts),
      );
      teamBuckets.set(profile.teamId, bucket);
    }

    const teamRows = [...teamBuckets.entries()]
      .map(([teamId, bucket]) => {
        const monthProfiles = versions.filter(
          (version) =>
            version.teamId === teamId &&
            overlapsMonth(version, competence, monthEnd),
        );
        const lastProfile = [...monthProfiles]
          .sort((a, b) =>
            dateKey(a.validFrom).localeCompare(dateKey(b.validFrom)),
          )
          .at(-1);
        return {
          teamId,
          businessCode: lastProfile?.businessCode || null,
          displayName: lastProfile?.displayName || null,
          responsibleName: lastProfile?.responsibleName || null,
          profiles: monthProfiles.map((profile) => ({
            version: profile.version,
            businessCode: profile.businessCode,
            displayName: profile.displayName,
            responsibleName: profile.responsibleName || null,
            validFrom: dateKey(profile.validFrom),
            validTo: profile.validTo ? dateKey(profile.validTo) : null,
          })),
          ...serializeBucket(bucket, isCovered, input.includeFacts),
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

    const assignedTons = teamRows.reduce(
      (sum, row) => sum.plus(row.totalTon || 0),
      new Prisma.Decimal(0),
    );
    const closureDelta = isCovered
      ? eligible.tons.minus(assignedTons).minus(pending.tons).toFixed(6)
      : null;

    return {
      competence,
      covered: isCovered,
      eligible: serializeBucket(eligible, isCovered, input.includeFacts),
      teams: teamRows,
      pending: {
        ...serializeBucket(pending, isCovered, input.includeFacts),
        reasons: [...pendingReasons.entries()]
          .map(([reason, bucket]) => ({
            reason,
            ...serializeBucket(bucket, isCovered, input.includeFacts),
          }))
          .sort((a, b) => a.reason.localeCompare(b.reason)),
      },
      closure: {
        formula: 'soma_equipes + pendencias = producao_total_elegivel',
        deltaTon: closureDelta,
        closed:
          closureDelta === null ? null : new Prisma.Decimal(closureDelta).eq(0),
      },
    };
  });

  return {
    year,
    dynamicTeamCount: teams.length,
    teams: teams.map((team) => ({
      id: team.id,
      validFrom: dateKey(team.validFrom),
      validTo: team.validTo ? dateKey(team.validTo) : null,
      versions: versions
        .filter((version) => version.teamId === team.id)
        .sort((a, b) => a.version - b.version)
        .map((version) => ({
          id: version.id,
          version: version.version,
          businessCode: version.businessCode,
          displayName: version.displayName,
          responsibleName: version.responsibleName || null,
          validFrom: dateKey(version.validFrom),
          validTo: version.validTo ? dateKey(version.validTo) : null,
        })),
    })),
    months,
    integrity: {
      duplicateFactKeys: [...new Set(duplicateFactKeys)].sort(),
      duplicateFactCount: new Set(duplicateFactKeys).size,
      everyMonthClosed: months.every((month) => month.closure.closed !== false),
      classificationSource: 'PERSISTED_ID_ITEM_TEAM_VALIDITY',
      descriptionParsingUsed: false,
    },
  };
}
