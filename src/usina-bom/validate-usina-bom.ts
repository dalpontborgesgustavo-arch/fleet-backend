import { PrismaClient } from '@prisma/client';

function numeric(value: unknown) {
  return Number(String(value));
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [counts, invalidTotals, duplicates, grants] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`
        SELECT
          (SELECT COUNT(*) FROM "UsinaBomStructure" WHERE "deletedAt" IS NULL) AS structures,
          (SELECT COUNT(*) FROM "UsinaBomComponent" WHERE "deletedAt" IS NULL) AS components,
          (SELECT COUNT(*) FROM bi.usina_bom_estrutura) AS view_rows
      `),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT v."structureId", v."version", SUM(c."consumptionPercent") AS total
        FROM "UsinaBomVersion" v
        JOIN "UsinaBomComponent" c ON c."versionId" = v."id" AND c."deletedAt" IS NULL
        WHERE v."deletedAt" IS NULL
        GROUP BY v."structureId", v."version"
        HAVING SUM(c."consumptionPercent") <> 100.000000
      `),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT id_estrutura, versao, id_item_mp, COUNT(*) AS quantity
        FROM bi.usina_bom_estrutura
        GROUP BY id_estrutura, versao, id_item_mp
        HAVING COUNT(*) > 1
      `),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT
          has_schema_privilege('powerbi_reader', 'bi', 'USAGE') AS schema_usage,
          has_table_privilege('powerbi_reader', 'bi.usina_bom_estrutura', 'SELECT') AS view_select
      `),
    ]);

    const powerBiRows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE powerbi_reader');
      return tx.$queryRawUnsafe<any[]>(
        'SELECT COUNT(*) AS rows FROM bi.usina_bom_estrutura',
      );
    });

    const result = {
      structures: numeric(counts[0]?.structures),
      components: numeric(counts[0]?.components),
      viewRows: numeric(counts[0]?.view_rows),
      invalidTotals: invalidTotals.length,
      duplicateViewRows: duplicates.length,
      powerBiSchemaUsage: grants[0]?.schema_usage === true,
      powerBiViewSelect: grants[0]?.view_select === true,
      powerBiSelectRows: numeric(powerBiRows[0]?.rows),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (
      result.structures !== 63 ||
      result.components !== 309 ||
      result.viewRows !== 309 ||
      result.invalidTotals !== 0 ||
      result.duplicateViewRows !== 0 ||
      !result.powerBiSchemaUsage ||
      !result.powerBiViewSelect ||
      result.powerBiSelectRows !== 309
    ) {
      process.exitCode = 1;
    }
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
