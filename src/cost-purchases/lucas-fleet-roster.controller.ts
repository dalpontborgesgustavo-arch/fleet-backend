import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

const READ_ROLES = new Set([
  'admin',
  'administrador',
  'licitacao_gestor',
  'licitacao',
  'gestor',
  'ceo',
]);

type AppliedStatusEvent = {
  previousStatus: string;
  currentStatus: string;
  changedAt: Date;
  effectiveEndAt: Date | null;
  source: string | null;
};

const RECORDED_ESTIMATE_SOURCE = 'HISTORICO_RECORDED_ESTIMATE';

function effectiveStatusAt(
  events: AppliedStatusEvent[],
  nextMonth: Date,
  nextMonthInSaoPaulo: Date,
): {
  active: boolean;
  changedAt: Date;
  estimated: boolean;
  inferredBeforeFirstEvent: boolean;
} | null {
  const effective = events
    .map((event) => ({
      event,
      date:
        event.currentStatus === 'N' && event.effectiveEndAt
          ? event.effectiveEndAt
          : event.changedAt,
    }))
    .filter(
      ({ event, date }) =>
        date <
          (event.source === RECORDED_ESTIMATE_SOURCE
            ? nextMonthInSaoPaulo
            : nextMonth) &&
        ['S', 'N'].includes(event.currentStatus),
    )
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0];
  if (effective) {
    return {
      active: effective.event.currentStatus === 'S',
      changedAt: effective.date,
      estimated: effective.event.source === RECORDED_ESTIMATE_SOURCE,
      inferredBeforeFirstEvent: false,
    };
  }

  // A typed S->N (or N->S) audit transition can inform an earlier month,
  // but only as an estimate: its timestamp is when Aethos recorded the change.
  const firstRecorded = events
    .filter(
      (event) =>
        event.source === RECORDED_ESTIMATE_SOURCE &&
        event.changedAt >= nextMonthInSaoPaulo &&
        ['S', 'N'].includes(event.previousStatus),
    )
    .sort((left, right) => left.changedAt.getTime() - right.changedAt.getTime())[0];
  if (firstRecorded) {
    return {
      active: firstRecorded.previousStatus === 'S',
      changedAt: firstRecorded.changedAt,
      estimated: true,
      inferredBeforeFirstEvent: true,
    };
  }
  return null;
}

@UseGuards(JwtGuard)
@Controller('lucas-fleet-results/roster')
export class LucasFleetRosterController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findMonth(@Req() req: any, @Query('competence') competence?: string) {
    if (
      !READ_ROLES.has(
        String(req.user?.role ?? '')
          .trim()
          .toLowerCase(),
      )
    ) {
      throw new ForbiddenException(
        'Sem permissao para acessar os resultados da frota.',
      );
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(competence ?? ''))) {
      throw new BadRequestException(
        'Competencia deve estar no formato AAAA-MM.',
      );
    }

    return getLucasFleetRosterMonth(this.prisma, competence!);
  }
}

export async function getLucasFleetRosterMonth(prisma: PrismaService, competence: string) {
  const month = new Date(`${competence}-01T00:00:00.000Z`);
  const nextMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
  );
  // The imported HISTORICO timestamps are local Aethos audit times. For
  // 2025/2026 Sao Paulo is UTC-03; do not shift late-month events into the
  // next competence merely because UTC has crossed midnight.
  const nextMonthInSaoPaulo = new Date(nextMonth.getTime() + 3 * 60 * 60 * 1000);
  const vehicles = await prisma.vehicle.findMany({
    select: {
      id: true,
      fleet: true,
      name: true,
      plate: true,
      subgroup: true,
      rollerType: true,
      active: true,
      aethosManaged: true,
      createdAt: true,
      costPurchaseProfiles: {
        where: { effectiveFrom: { lte: month } },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
        select: { subgroup: true, effectiveFrom: true, provenance: true },
      },
      aethosStatusHistory: {
        where: {
          applicationStatus: 'APPLIED',
          OR: [
            { changedAt: { lt: nextMonth } },
            { source: RECORDED_ESTIMATE_SOURCE },
          ],
        },
        orderBy: { changedAt: 'desc' },
        select: {
          previousStatus: true,
          currentStatus: true,
          changedAt: true,
          effectiveEndAt: true,
          source: true,
        },
      },
    },
    orderBy: [{ fleet: 'asc' }, { id: 'asc' }],
  });

  const rows = vehicles.map((vehicle) => {
    const profile = vehicle.costPurchaseProfiles[0];
    const status = effectiveStatusAt(
      vehicle.aethosStatusHistory,
      nextMonth,
      nextMonthInSaoPaulo,
    );
    const localNotYetRegistered =
      !vehicle.aethosManaged && vehicle.createdAt >= nextMonth && !profile;
    const active = status
      ? status.active
      : localNotYetRegistered
        ? false
        : vehicle.active;
    const activeSource = status
      ? status.estimated
        ? 'AETHOS_RECORDED_STATUS_ESTIMATE'
        : 'AETHOS_STATUS_EVENT'
      : localNotYetRegistered
        ? 'LOCAL_REGISTRATION_DATE'
        : 'CURRENT_VEHICLE_FALLBACK';
    return {
      id: vehicle.id,
      fleet: vehicle.fleet,
      name: vehicle.name,
      plate: vehicle.plate,
      subgroup: profile ? profile.subgroup : vehicle.subgroup,
      rollerType: vehicle.rollerType,
      active,
      provenance: {
        subgroup: profile
          ? profile.provenance === 'INFERRED_CURRENT_BASELINE'
            ? 'INFERRED_CURRENT_BASELINE'
            : 'COST_PURCHASE_PROFILE'
          : 'CURRENT_VEHICLE',
        subgroupEffectiveFrom: profile
          ? profile.effectiveFrom.toISOString().slice(0, 10)
          : null,
        rollerType: 'CURRENT_VEHICLE',
        active: activeSource,
        activeEventAt: status ? status.changedAt.toISOString() : null,
        activeInferredBeforeFirstEvent: status
          ? status.inferredBeforeFirstEvent
          : false,
        name: 'CURRENT_VEHICLE',
      },
    };
  });

  return {
    competence,
    rows,
    summary: {
      total: rows.length,
      currentSubgroupFallbackCount: rows.filter(
        (row) => row.provenance.subgroup === 'CURRENT_VEHICLE',
      ).length,
      inferredSubgroupCount: rows.filter(
        (row) => row.provenance.subgroup === 'INFERRED_CURRENT_BASELINE',
      ).length,
      currentActiveFallbackCount: rows.filter(
        (row) => row.provenance.active === 'CURRENT_VEHICLE_FALLBACK',
      ).length,
      estimatedActiveStatusCount: rows.filter(
        (row) => row.provenance.active === 'AETHOS_RECORDED_STATUS_ESTIMATE',
      ).length,
    },
    limitations: [
      'Subgrupo sem perfil vigente usa o cadastro atual; isso nao comprova o grupo historico.',
      'Perfis retroativos inferidos reproduzem o cadastro atual; nao comprovam a classificacao original da epoca.',
      'Antes do cadastro local, um perfil retroativo permite estimar a situacao pelo estado atual; isso nao comprova a situacao historica.',
      'Tipo de rolo e Nome / Apelido nao possuem historico de competencia e usam o cadastro atual.',
      'Situacao sem evento Aethos aplicado usa o estado atual; contagens de meses anteriores podem ser estimadas.',
      'Eventos de inativacao/reativacao extraidos do HISTORICO Aethos usam a data de registro como estimativa, nao a data efetiva operacional comprovada. Antes do primeiro evento, o estado anterior informado no evento tambem e uma inferencia.',
    ],
  };
}
