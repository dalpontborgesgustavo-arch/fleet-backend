import { Prisma, PrismaClient } from '@prisma/client';
import { INITIAL_USINA_BOM_ROWS } from './usina-bom-initial-data';
import {
  bomSnapshot,
  dateKey,
  normalizeBomComponents,
  parsePositiveInteger,
  parseRequiredText,
} from './usina-bom.rules';

interface SeedResult {
  structuresCreated: number;
  structuresUnchanged: number;
  componentsCreated: number;
  sourceStructures: number;
  sourceComponents: number;
}

function groupInitialRows() {
  const grouped = new Map<number, typeof INITIAL_USINA_BOM_ROWS>();
  for (const row of INITIAL_USINA_BOM_ROWS) {
    const productId = parsePositiveInteger(
      row['[ID_ITEM_ASFALTO]'],
      'ID_ITEM_ASFALTO',
    );
    const current = grouped.get(productId) || [];
    current.push(row);
    grouped.set(productId, current);
  }
  if (grouped.size !== 63 || INITIAL_USINA_BOM_ROWS.length !== 309) {
    throw new Error(
      `Carga BOM invalida: esperadas 63 estruturas/309 componentes; recebidos ${grouped.size}/${INITIAL_USINA_BOM_ROWS.length}`,
    );
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right);
}

function existingVersionMatches(
  version: any,
  traceName: string,
  components: any[],
) {
  if (!version || version.traceName !== traceName) return false;
  if (dateKey(version.validFrom) !== '2025-01-01') return false;
  if (version.components.length !== components.length) return false;
  const existing = [...version.components].sort(
    (left, right) => left.aethosMaterialId - right.aethosMaterialId,
  );
  const expected = [...components].sort(
    (left, right) => left.aethosMaterialId - right.aethosMaterialId,
  );
  return expected.every((component, index) => {
    const current = existing[index];
    return (
      current.aethosMaterialId === component.aethosMaterialId &&
      current.materialName === component.materialName &&
      current.consumptionPercent.equals(component.consumptionPercent)
    );
  });
}

export async function seedUsinaBom(prisma: PrismaClient): Promise<SeedResult> {
  const groups = groupInitialRows();
  const validFrom = new Date('2025-01-01T00:00:00.000Z');
  const result: SeedResult = {
    structuresCreated: 0,
    structuresUnchanged: 0,
    componentsCreated: 0,
    sourceStructures: groups.length,
    sourceComponents: INITIAL_USINA_BOM_ROWS.length,
  };

  for (const [aethosProductId, rows] of groups) {
    const traceNames = [...new Set(rows.map((row) => row['[TRACO]']))];
    if (traceNames.length !== 1) {
      throw new Error(
        `Produto ${aethosProductId} possui mais de uma descricao de traco na carga`,
      );
    }
    const traceName = parseRequiredText(traceNames[0], 'TRACO');
    const components = normalizeBomComponents(
      rows.map((row) => ({
        aethosMaterialId: row['[ID_ITEM_MP]'],
        materialName: row['[MP]'],
        consumptionPercent: row['[CONSUMO]'],
      })),
    );

    const action = await prisma.$transaction(
      async (tx) => {
        const lockKey = `GLOBAL|GLOBAL|${aethosProductId}`;
        await tx.$queryRaw(
          Prisma.sql`WITH acquired_lock AS (
            SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
          ) SELECT 1 AS "locked" FROM acquired_lock`,
        );
        const existing = await tx.usinaBomStructure.findFirst({
          where: {
            companyId: null,
            unitId: null,
            aethosProductId,
            deletedAt: null,
          },
          include: {
            versions: {
              where: { deletedAt: null },
              include: {
                components: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        });

        if (existing) {
          const initialVersion = existing.versions.find(
            (version) => version.version === 1,
          );
          if (!existingVersionMatches(initialVersion, traceName, components)) {
            throw new Error(
              `A estrutura existente do produto ${aethosProductId} diverge da carga inicial; nenhum dado foi sobrescrito`,
            );
          }
          return 'unchanged' as const;
        }

        const structure = await tx.usinaBomStructure.create({
          data: {
            companyId: null,
            unitId: null,
            aethosProductId,
            active: true,
            versions: {
              create: {
                version: 1,
                traceName,
                validFrom,
                validTo: null,
                active: true,
                components: { create: components },
              },
            },
          },
          include: { versions: true },
        });
        await tx.usinaBomAudit.create({
          data: {
            structureId: structure.id,
            versionId: structure.versions[0].id,
            action: 'SEED_IMPORTED',
            note: 'Carga inicial baseada nos tracos utilizados nos calculos de 2025; vigencia adotada em 01/01/2025.',
            snapshot: bomSnapshot({
              aethosProductId,
              traceName,
              version: 1,
              validFrom,
              components,
            }) as Prisma.InputJsonValue,
          },
        });
        return 'created' as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (action === 'created') {
      result.structuresCreated += 1;
      result.componentsCreated += components.length;
    } else {
      result.structuresUnchanged += 1;
    }
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await seedUsinaBom(prisma);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
