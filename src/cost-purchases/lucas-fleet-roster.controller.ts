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
  currentStatus: string;
  changedAt: Date;
  effectiveEndAt: Date | null;
};

function effectiveStatusAt(
  events: AppliedStatusEvent[],
  nextMonth: Date,
): { active: boolean; changedAt: Date } | null {
  const effective = events
    .map((event) => ({
      event,
      date:
        event.currentStatus === 'N' && event.effectiveEndAt
          ? event.effectiveEndAt
          : event.changedAt,
    }))
    .filter(({ date }) => date < nextMonth)
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0];
  if (!effective) return null;
  if (effective.event.currentStatus === 'S') {
    return { active: true, changedAt: effective.date };
  }
  if (effective.event.currentStatus === 'N') {
    return { active: false, changedAt: effective.date };
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

    const month = new Date(`${competence}-01T00:00:00.000Z`);
    const nextMonth = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    );
    const vehicles = await this.prisma.vehicle.findMany({
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
            changedAt: { lt: nextMonth },
          },
          orderBy: { changedAt: 'desc' },
          select: {
            currentStatus: true,
            changedAt: true,
            effectiveEndAt: true,
          },
        },
      },
      orderBy: [{ fleet: 'asc' }, { id: 'asc' }],
    });

    const rows = vehicles.map((vehicle) => {
      const profile = vehicle.costPurchaseProfiles[0];
      const status = effectiveStatusAt(vehicle.aethosStatusHistory, nextMonth);
      const localNotYetRegistered =
        !vehicle.aethosManaged && vehicle.createdAt >= nextMonth;
      const active = status
        ? status.active
        : localNotYetRegistered
          ? false
          : vehicle.active;
      const activeSource = status
        ? 'AETHOS_STATUS_EVENT'
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
      },
      limitations: [
        'Subgrupo sem perfil vigente usa o cadastro atual; isso nao comprova o grupo historico.',
        'Perfis retroativos inferidos reproduzem o cadastro atual; nao comprovam a classificacao original da epoca.',
        'Tipo de rolo e Nome / Apelido nao possuem historico de competencia e usam o cadastro atual.',
        'Situacao sem evento Aethos aplicado usa o estado atual; contagens de meses anteriores podem ser estimadas.',
      ],
    };
  }
}
