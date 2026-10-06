import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_ROLES = new Set(['admin', 'vendas']);
const ALLOWED_STATUS = new Set(['Sem NF', 'Com NF', 'Recebido']);

const includeForecastRelations = {
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

type RevenueForecastWithUser = Prisma.RevenueForecastGetPayload<{
  include: typeof includeForecastRelations;
}>;

function normalizeRole(role?: string | null) {
  return (role || '').toLowerCase();
}

function coerceText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).trim();
  return '';
}

function parseMoney(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new BadRequestException('Valor previsto invalido');
    return value;
  }

  const text = coerceText(value).replace(/[^\d,.-]/g, '');
  if (!text) throw new BadRequestException('Valor previsto e obrigatorio');

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);

  const normalized =
    decimalIndex === -1
      ? text.replace(/\D/g, '')
      : `${text.slice(0, decimalIndex).replace(/\D/g, '')}.${text
          .slice(decimalIndex + 1)
          .replace(/\D/g, '')
          .slice(0, 2)
          .padEnd(2, '0')}`;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestException('Valor previsto invalido');
  }

  return amount;
}

function parseInteger(value: unknown, fieldName: string) {
  const text = coerceText(value);
  const parsed = Number.parseInt(text, 10);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException(`${fieldName} invalido`);
  }
  return parsed;
}

function nextPeriod(mes: number, ano: number) {
  return mes === 12 ? { mes: 1, ano: ano + 1 } : { mes: mes + 1, ano };
}

@Injectable()
export class RevenueForecastsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAccess(role?: string | null) {
    if (!ALLOWED_ROLES.has(normalizeRole(role))) {
      throw new ForbiddenException('Sem permissao para acessar previsoes');
    }
  }

  async findAll(actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const records = await this.prisma.revenueForecast.findMany({
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }],
      include: includeForecastRelations,
    });

    return records.map((record) => this.serialize(record));
  }

  async create(data: any, actorRole?: string | null, actorId?: string | null) {
    this.ensureAccess(actorRole);

    const obra = coerceText(data?.obra);
    if (!obra) {
      throw new BadRequestException('Obra e obrigatoria');
    }

    const mes = parseInteger(data?.mes, 'Mes');
    if (mes < 1 || mes > 12) {
      throw new BadRequestException('Mes invalido');
    }

    const ano = parseInteger(data?.ano, 'Ano');
    if (ano < 2000 || ano > 2100) {
      throw new BadRequestException('Ano invalido');
    }

    const created = await this.prisma.revenueForecast.create({
      data: {
        obra,
        valorPrevisto: new Prisma.Decimal(parseMoney(data?.valorPrevisto)),
        mes,
        ano,
        status: 'Sem NF',
        createdById: actorId || null,
      },
      include: includeForecastRelations,
    });

    return this.serialize(created);
  }

  async postponePending(
    mesValue: unknown,
    anoValue: unknown,
    actorRole?: string | null,
  ) {
    this.ensureAccess(actorRole);

    const mes = parseInteger(mesValue, 'Mes');
    if (mes < 1 || mes > 12) {
      throw new BadRequestException('Mes invalido');
    }

    const ano = parseInteger(anoValue, 'Ano');
    if (ano < 2000 || ano > 2100) {
      throw new BadRequestException('Ano invalido');
    }

    const next = nextPeriod(mes, ano);

    const result = await this.prisma.revenueForecast.updateMany({
      where: {
        mes,
        ano,
        status: {
          not: 'Recebido',
        },
      },
      data: {
        mes: next.mes,
        ano: next.ano,
        postponements: {
          increment: 1,
        },
      },
    });

    const records = await this.prisma.revenueForecast.findMany({
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }],
      include: includeForecastRelations,
    });

    return {
      moved: result.count,
      nextMes: next.mes,
      nextAno: next.ano,
      records: records.map((record) => this.serialize(record)),
    };
  }

  async updateStatus(id: string, status: unknown, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const nextStatus =
      coerceText(status) === 'Faturado' ? 'Recebido' : coerceText(status);
    if (!ALLOWED_STATUS.has(nextStatus)) {
      throw new BadRequestException('Status invalido');
    }

    const existing = await this.prisma.revenueForecast.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Previsao nao encontrada');
    }

    const updated = await this.prisma.revenueForecast.update({
      where: { id },
      data: { status: nextStatus },
      include: includeForecastRelations,
    });

    return this.serialize(updated);
  }

  async remove(id: string, actorRole?: string | null) {
    this.ensureAccess(actorRole);

    const existing = await this.prisma.revenueForecast.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Previsao nao encontrada');
    }

    await this.prisma.revenueForecast.delete({
      where: { id },
    });

    return { ok: true };
  }

  private serialize(record: RevenueForecastWithUser) {
    return {
      id: record.id,
      obra: record.obra,
      valorPrevisto: Number(record.valorPrevisto),
      mes: record.mes,
      ano: record.ano,
      status: record.status === 'Faturado' ? 'Recebido' : record.status,
      postponements: record.postponements ?? 0,
      createdById: record.createdById,
      createdByName: record.createdBy?.name ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
