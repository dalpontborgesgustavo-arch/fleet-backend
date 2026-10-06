import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsinaMonthlyResultService } from '../usina-monthly-result/usina-monthly-result.service';
import { USINA_FORECAST_2025_INITIAL_VALUES } from './seed-usina-forecasts-2025';
import { USINA_FORECAST_CONTEXT } from './usina-forecasts.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const expectedByCode = new Map<string, string>(
      USINA_FORECAST_2025_INITIAL_VALUES.map(([code, value]) => [code, value]),
    );
    const records = await prisma.usinaForecast.findMany({
      where: {
        companyId: USINA_FORECAST_CONTEXT.companyId,
        unitId: USINA_FORECAST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(2025, 0, 1)),
          lt: new Date(Date.UTC(2026, 0, 1)),
        },
        materialCode: { in: [...expectedByCode.keys()] },
        active: true,
      },
      select: {
        competence: true,
        materialCode: true,
        indicatorCode: true,
        forecastValue: true,
      },
      orderBy: [{ competence: 'asc' }, { materialCode: 'asc' }],
    });
    const counts = new Map<string, number>();
    const byCode = new Map<string, number>();
    const mismatches: string[] = [];
    for (const record of records) {
      const key = `${record.competence.toISOString().slice(0, 10)}|${record.materialCode}|${record.indicatorCode}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      byCode.set(
        record.materialCode,
        (byCode.get(record.materialCode) || 0) + 1,
      );
      const expected = expectedByCode.get(record.materialCode);
      if (!expected || !record.forecastValue?.equals(expected)) {
        mismatches.push(`${key}:${record.forecastValue?.toString() ?? 'NULL'}`);
      }
    }
    const duplicateKeys = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
    const missingCodes = [...expectedByCode.keys()].filter(
      (code) => byCode.get(code) !== 12,
    );
    const reconciliationHistory = await prisma.usinaForecastHistory.count({
      where: {
        companyId: USINA_FORECAST_CONTEXT.companyId,
        unitId: USINA_FORECAST_CONTEXT.unitId,
        competence: {
          gte: new Date(Date.UTC(2025, 0, 1)),
          lt: new Date(Date.UTC(2026, 0, 1)),
        },
        action: {
          in: ['RECONCILIATION_2025_CREATED', 'RECONCILIATION_2025_UPDATED'],
        },
      },
    });
    const annual = await new UsinaMonthlyResultService(prisma).findAnnual(
      2025,
      'admin',
    );
    const invalidComparisonMonths = annual.months
      .filter(
        (month) =>
          month.comparison.length !==
            USINA_FORECAST_2025_INITIAL_VALUES.length ||
          month.comparison.some((row) => row.forecast === null),
      )
      .map((month) => month.competence);
    const january = annual.months[0];
    const result = {
      forecastRecords: records.length,
      expectedForecastRecords: 168,
      byCode: Object.fromEntries([...byCode.entries()].sort()),
      duplicates: duplicateKeys.length,
      mismatches: mismatches.length,
      missingCodes,
      reconciliationHistory,
      months: annual.months.length,
      comparisonRowsPerMonth: annual.months.map(
        (month) => month.comparison.length,
      ),
      invalidComparisonMonths,
      zeroIsPreserved: annual.months.every(
        (month) => month.forecast.values.DOP === 0,
      ),
      obsoleteRows: annual.auditBasis.legacyObsoleteRows.length,
      maintenanceJanuaryCumulative:
        january.indicators?.maintenancePerTon.cumulative ?? null,
      capAccountingCompleteMonths: annual.months.filter((month) =>
        ['CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_ALTO_MODULO'].every(
          (code) =>
            month.financial?.costs.values[
              code as keyof typeof month.financial.costs.values
            ] !== null,
        ),
      ).length,
      financialTotalMonths: annual.months.filter(
        (month) => month.financial?.costs.total !== null,
      ).length,
      revenueClassificationFactCount: annual.months.reduce(
        (sum, month) =>
          sum +
          (month.revenue.internal
            ? Object.values(month.revenue.internal.byClassification).reduce(
                (monthSum, category) => monthSum + category.factCount,
                0,
              )
            : 0) +
          (month.revenue.external
            ? Object.values(month.revenue.external.byClassification).reduce(
                (monthSum, category) => monthSum + category.factCount,
                0,
              )
            : 0),
        0,
      ),
    };
    const valid =
      result.forecastRecords === result.expectedForecastRecords &&
      result.duplicates === 0 &&
      result.mismatches === 0 &&
      result.missingCodes.length === 0 &&
      result.months === 12 &&
      result.invalidComparisonMonths.length === 0 &&
      result.zeroIsPreserved &&
      result.obsoleteRows === 4;
    process.stdout.write(`${JSON.stringify({ valid, ...result })}\n`);
    if (!valid) process.exitCode = 1;
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
