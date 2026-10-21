import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface RowFilters {
  page?: string;
  pageSize?: string;
  classification?: string;
  serviceMonth?: string;
  q?: string;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new BadRequestException('Paginação inválida');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException('Paginação inválida');
  }
  return parsed;
}

@Injectable()
export class DudaBdGeralService {
  constructor(private readonly prisma: PrismaService) {}

  async listImports() {
    return this.prisma.dudaBdGeralImport.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceWorkbookSha256: true,
        sourceLabel: true,
        capturedAt: true,
        physicalRowCount: true,
        detailCandidateCount: true,
        status: true,
        createdAt: true,
        // No source workstation path or raw company data in the list.
      },
    });
  }

  async listRows(importId: string, filters: RowFilters) {
    const batch = await this.prisma.dudaBdGeralImport.findUnique({
      where: { id: importId },
      select: {
        id: true,
        status: true,
        sourceLabel: true,
        physicalRowCount: true,
      },
    });
    if (!batch) throw new NotFoundException('Importação não encontrada');

    const page = positiveInteger(filters.page, 1, 100000);
    const pageSize = positiveInteger(filters.pageSize, 50, 100);
    const classification = filters.classification?.trim();
    const serviceMonth = filters.serviceMonth?.trim();
    const q = filters.q?.trim();
    if (classification && !/^[a-z_]{1,50}$/.test(classification)) {
      throw new BadRequestException('Classificação inválida');
    }
    if (serviceMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(serviceMonth)) {
      throw new BadRequestException('Mês inválido');
    }
    if (q && q.length > 120) throw new BadRequestException('Busca muito longa');

    const where: Prisma.DudaBdGeralRowWhereInput = {
      importId,
      ...(classification ? { classification } : {}),
      ...(serviceMonth ? { serviceMonth } : {}),
      ...(q
        ? {
            OR: [
              { legacyItem: { contains: q, mode: 'insensitive' } },
              { engineer: { contains: q, mode: 'insensitive' } },
              { contractNumber: { contains: q, mode: 'insensitive' } },
              { clientName: { contains: q, mode: 'insensitive' } },
              { municipality: { contains: q, mode: 'insensitive' } },
              { workName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dudaBdGeralRow.count({ where }),
      this.prisma.dudaBdGeralRow.findMany({
        where,
        orderBy: { excelRow: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          excelRow: true,
          classification: true,
          hiddenByFilter: true,
          legacyItem: true,
          serviceMonth: true,
          engineer: true,
          contractNumber: true,
          clientName: true,
          municipality: true,
          workName: true,
          billingMonth: true,
          expectedReceiptMonth: true,
          receivedMonthText: true,
          issues: true,
        },
      }),
    ]);
    return { batch, page, pageSize, total, rows };
  }

  async getRow(importId: string, rowId: string) {
    const row = await this.prisma.dudaBdGeralRow.findFirst({
      where: { id: rowId, importId },
    });
    if (!row) throw new NotFoundException('Linha não encontrada');
    return row;
  }
}
