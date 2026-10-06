import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  USINA_FORECAST_CONTEXT,
  USINA_FORECAST_INDICATORS,
  USINA_FORECAST_MATERIALS,
} from './usina-forecasts.service';

const SOURCE_NOTE =
  'Carga inicial da reconciliação com a planilha original da Usina 2025';

export const USINA_FORECAST_2025_INITIAL_VALUES = [
  ['PO_DE_PEDRA', '54.30', 80],
  ['PO_DE_PEDRA_POR_TON_PRODUZIDA', '26.23', 82],
  ['PEDRISCO', '55.18', 85],
  ['PEDRISCO_POR_TON_PRODUZIDA', '18.66', 87],
  ['BRITA_3_4', '52.26', 90],
  ['BRITA_3_4_POR_TON_PRODUZIDA', '8.34', 92],
  ['OLEO_RESIVALE', '20.00', 95],
  ['DIESEL', '6.00', 99],
  ['CAL_CH1', '12.47', 103],
  ['DOP', '0.00', 107],
  ['MAO_DE_OBRA', '5.10', 111],
  ['CARREGADEIRA', '5.17', 115],
  ['ENERGIA_ELETRICA', '1.46', 119],
  ['MANUTENCAO', '4.50', 123],
] as const;

const MATERIAL_BY_CODE = new Map(
  USINA_FORECAST_MATERIALS.map((material) => [material.code, material]),
);

export async function seedUsinaForecasts2025(prisma: PrismaClient) {
  const result = { created: 0, updated: 0, unchanged: 0, history: 0 };
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('USINA_FORECAST_2025_RECONCILIATION', 0))::text AS lock_result`,
      );
      for (let month = 1; month <= 12; month += 1) {
        const competence = new Date(Date.UTC(2025, month - 1, 1));
        for (const [
          materialCode,
          rawValue,
          sourceRow,
        ] of USINA_FORECAST_2025_INITIAL_VALUES) {
          const material = MATERIAL_BY_CODE.get(materialCode);
          if (!material)
            throw new Error(`Rubrica não cadastrada: ${materialCode}`);
          const forecastValue = new Prisma.Decimal(rawValue);
          const observation = `${SOURCE_NOTE}; linha ${sourceRow}; valor literal repetido de BD a BO.`;
          const where = {
            companyId_unitId_competence_materialCode_indicatorCode: {
              companyId: USINA_FORECAST_CONTEXT.companyId,
              unitId: USINA_FORECAST_CONTEXT.unitId,
              competence,
              materialCode,
              indicatorCode: material.indicatorCode,
            },
          };
          const existing = await tx.usinaForecast.findUnique({ where });
          if (
            existing?.active &&
            existing.forecastValue?.equals(forecastValue) &&
            existing.observation === observation
          ) {
            result.unchanged += 1;
            continue;
          }
          const record = existing
            ? await tx.usinaForecast.update({
                where: { id: existing.id },
                data: {
                  materialName: material.name,
                  indicatorName:
                    USINA_FORECAST_INDICATORS[material.indicatorCode],
                  forecastValue,
                  observation,
                  active: true,
                  updatedById: null,
                },
              })
            : await tx.usinaForecast.create({
                data: {
                  ...USINA_FORECAST_CONTEXT,
                  competence,
                  materialCode,
                  materialName: material.name,
                  indicatorCode: material.indicatorCode,
                  indicatorName:
                    USINA_FORECAST_INDICATORS[material.indicatorCode],
                  forecastValue,
                  observation,
                  active: true,
                  updatedById: null,
                },
              });
          await tx.usinaForecastHistory.create({
            data: {
              forecastId: record.id,
              companyId: record.companyId,
              unitId: record.unitId,
              competence: record.competence,
              materialCode: record.materialCode,
              indicatorCode: record.indicatorCode,
              action: existing
                ? 'RECONCILIATION_2025_UPDATED'
                : 'RECONCILIATION_2025_CREATED',
              previousValue: existing?.forecastValue ?? null,
              newValue: forecastValue,
              previousObservation: existing?.observation ?? null,
              newObservation: observation,
              actorId: null,
            },
          });
          if (existing) result.updated += 1;
          else result.created += 1;
          result.history += 1;
        }
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return { ...result, expected: 168 };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    process.stdout.write(
      `${JSON.stringify(await seedUsinaForecasts2025(prisma))}\n`,
    );
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
