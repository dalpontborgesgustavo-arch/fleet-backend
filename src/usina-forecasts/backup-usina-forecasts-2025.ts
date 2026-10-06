import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { USINA_FORECAST_CONTEXT } from './usina-forecasts.service';

async function main() {
  const prisma = new PrismaClient();
  try {
    const records = await prisma.usinaForecast.findMany({
      where: {
        companyId: USINA_FORECAST_CONTEXT.companyId,
        unitId: USINA_FORECAST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(2025, 0, 1)),
          lt: new Date(Date.UTC(2026, 0, 1)),
        },
      },
      include: { history: { orderBy: { changedAt: 'asc' } } },
      orderBy: [{ competence: 'asc' }, { materialCode: 'asc' }],
    });
    const backupDirectory = join(process.cwd(), 'backups');
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(
      backupDirectory,
      `usina-forecasts-2025-before-reconciliation-${stamp}.json`,
    );
    await writeFile(
      file,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          scope: USINA_FORECAST_CONTEXT,
          year: 2025,
          records,
        },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
      'utf8',
    );
    process.stdout.write(
      `${JSON.stringify({ file, records: records.length })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
