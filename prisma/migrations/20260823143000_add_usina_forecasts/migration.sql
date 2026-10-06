CREATE TABLE "UsinaForecast" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "unitName" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "materialCode" TEXT NOT NULL,
  "materialName" TEXT NOT NULL,
  "indicatorCode" TEXT NOT NULL,
  "indicatorName" TEXT NOT NULL,
  "forecastValue" DECIMAL(18,4),
  "observation" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaForecast_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaForecast_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaForecastHistory" (
  "id" TEXT NOT NULL,
  "forecastId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "materialCode" TEXT NOT NULL,
  "indicatorCode" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousValue" DECIMAL(18,4),
  "newValue" DECIMAL(18,4),
  "previousObservation" TEXT,
  "newObservation" TEXT,
  "actorId" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaForecastHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaForecastHistory_forecastId_fkey"
    FOREIGN KEY ("forecastId") REFERENCES "UsinaForecast"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UsinaForecastHistory_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaForecast_companyId_unitId_competence_materialCode_indicatorCode_key"
  ON "UsinaForecast"("companyId", "unitId", "competence", "materialCode", "indicatorCode");
CREATE INDEX "UsinaForecast_competence_idx" ON "UsinaForecast"("competence");
CREATE INDEX "UsinaForecast_active_idx" ON "UsinaForecast"("active");
CREATE INDEX "UsinaForecast_materialCode_indicatorCode_idx" ON "UsinaForecast"("materialCode", "indicatorCode");
CREATE INDEX "UsinaForecast_updatedById_idx" ON "UsinaForecast"("updatedById");
CREATE INDEX "UsinaForecastHistory_forecastId_changedAt_idx" ON "UsinaForecastHistory"("forecastId", "changedAt");
CREATE INDEX "UsinaForecastHistory_competence_idx" ON "UsinaForecastHistory"("competence");
CREATE INDEX "UsinaForecastHistory_actorId_idx" ON "UsinaForecastHistory"("actorId");

CREATE SCHEMA IF NOT EXISTS bi;

CREATE OR REPLACE VIEW "bi"."usina_previsao_mensal" AS
SELECT
  f."id" AS previsao_id,
  f."companyId" AS empresa_id,
  f."companyName" AS empresa,
  f."unitId" AS filial_id,
  f."unitName" AS filial,
  f."competence" AS competencia,
  f."materialCode" AS material_codigo,
  f."materialName" AS material_descricao,
  f."indicatorCode" AS indicador_codigo,
  f."indicatorName" AS indicador_descricao,
  f."forecastValue" AS valor_previsto,
  f."observation" AS observacao,
  f."active" AS ativo,
  f."updatedById" AS usuario_alteracao_id,
  u."name" AS usuario_alteracao,
  f."updatedAt" AS dt_alteracao
FROM "UsinaForecast" f
LEFT JOIN "User" u ON u."id" = f."updatedById"
WHERE f."active" = TRUE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."usina_previsao_mensal" TO powerbi_reader';
  END IF;
END $$;
