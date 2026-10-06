BEGIN;

DROP VIEW IF EXISTS "bi"."usina_previsao_mensal";

ALTER TABLE "UsinaForecast"
  ALTER COLUMN "forecastValue" TYPE DECIMAL(18,6);
ALTER TABLE "UsinaForecastHistory"
  ALTER COLUMN "previousValue" TYPE DECIMAL(18,6),
  ALTER COLUMN "newValue" TYPE DECIMAL(18,6);

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD COLUMN "reportingFamily" TEXT;

UPDATE "UsinaMaterialReceiptFact"
SET "reportingFamily" = CASE
  WHEN "aethosMaterialId" = 1813 THEN 'CAP_50_70'
  WHEN "aethosMaterialId" = 5525 THEN 'CAP_BORRACHA'
  WHEN "aethosMaterialId" IN (5643, 11734, 13861) THEN 'CAP_POLIMERO'
  ELSE NULL
END
WHERE "dataset" = 'CAP_MOVEMENTS';

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_reporting_family_check" CHECK (
    "reportingFamily" IS NULL OR
    "reportingFamily" IN ('CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO')
  );

ALTER TABLE "UsinaMaterialStockValuation"
  DROP CONSTRAINT "UsinaMaterialStockValuation_item_check",
  DROP CONSTRAINT "UsinaMaterialStockValuation_unit_check";

ALTER TABLE "UsinaMaterialStockValuation"
  ADD CONSTRAINT "UsinaMaterialStockValuation_item_check" CHECK (
    "aethosItemId" IN (968, 1813, 5525, 5643, 11734, 13861)
  ),
  ADD CONSTRAINT "UsinaMaterialStockValuation_unit_check" CHECK (
    ("aethosItemId" = 968 AND "quantityUnit" = 'M3') OR
    ("aethosItemId" IN (1813, 5525, 5643, 11734, 13861) AND "quantityUnit" = 'TN')
  );

DO $$
DECLARE
  seed_actor_id TEXT;
  seed_row RECORD;
  existing_forecast RECORD;
  forecast_id TEXT;
  previous_value NUMERIC(18,6);
  previous_observation TEXT;
  history_action TEXT;
  seed_observation CONSTANT TEXT :=
    'Carga inicial das premissas históricas de 2025 validada pela referência da Usina em 26/08/2026';
BEGIN
  SELECT "id" INTO seed_actor_id
  FROM "User"
  WHERE "active" = TRUE
    AND LOWER(BTRIM("role")) IN ('admin', 'administrador')
  ORDER BY "createdAt", "id"
  LIMIT 1;

  IF seed_actor_id IS NULL THEN
    RAISE EXCEPTION 'Carga inicial das previsoes CAP exige um Administrador ativo existente';
  END IF;

  FOR seed_row IN
    SELECT
      competence,
      material_code,
      material_name,
      CASE
        WHEN material_code = 'CAP_50_70' THEN 152.010000::NUMERIC(18,6)
        WHEN material_code = 'CAP_BORRACHA' THEN 294.420000::NUMERIC(18,6)
        WHEN competence <= DATE '2025-08-01' THEN 335.610000::NUMERIC(18,6)
        WHEN competence = DATE '2025-09-01' THEN 336.610000::NUMERIC(18,6)
        WHEN competence = DATE '2025-10-01' THEN 336.276667::NUMERIC(18,6)
        WHEN competence = DATE '2025-11-01' THEN 336.419524::NUMERIC(18,6)
        ELSE 336.562381::NUMERIC(18,6)
      END AS forecast_value
    FROM generate_series(
      DATE '2025-01-01',
      DATE '2025-12-01',
      INTERVAL '1 month'
    ) AS month_series(competence)
    CROSS JOIN (VALUES
      ('CAP_50_70', 'CAP 50/70'),
      ('CAP_BORRACHA', 'CAP Borracha'),
      ('CAP_POLIMERO', 'CAP Polímero')
    ) AS material(material_code, material_name)
  LOOP
    SELECT * INTO existing_forecast
    FROM "UsinaForecast"
    WHERE "companyId" = 'JR_CONSTRUCOES'
      AND "unitId" = 'USINA_ASFALTO_ICARA'
      AND "competence" = seed_row.competence
      AND "materialCode" = seed_row.material_code
      AND "indicatorCode" = 'PREVISTO_R_T';

    IF NOT FOUND THEN
      forecast_id := md5(
        'usina-forecast-cap-seed|' || seed_row.competence::TEXT || '|' ||
        seed_row.material_code
      );
      previous_value := NULL;
      previous_observation := NULL;
      history_action := 'INITIAL_LOAD';

      INSERT INTO "UsinaForecast" (
        "id", "companyId", "companyName", "unitId", "unitName",
        "competence", "materialCode", "materialName", "indicatorCode",
        "indicatorName", "forecastValue", "observation", "active",
        "updatedById", "createdAt", "updatedAt"
      ) VALUES (
        forecast_id, 'JR_CONSTRUCOES', 'JR Construções',
        'USINA_ASFALTO_ICARA', 'Usina de Asfalto de Içara',
        seed_row.competence, seed_row.material_code, seed_row.material_name,
        'PREVISTO_R_T', 'Previsto (R$/t)', seed_row.forecast_value,
        seed_observation, TRUE, seed_actor_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    ELSE
      forecast_id := existing_forecast."id";
      previous_value := existing_forecast."forecastValue";
      previous_observation := existing_forecast."observation";
      history_action := CASE
        WHEN existing_forecast."forecastValue" IS NOT DISTINCT FROM seed_row.forecast_value
          AND existing_forecast."observation" IS NOT DISTINCT FROM seed_observation
          AND existing_forecast."active" = TRUE
        THEN 'INITIAL_LOAD_VALIDATED'
        ELSE 'INITIAL_LOAD_UPDATED'
      END;

      UPDATE "UsinaForecast"
      SET "materialName" = seed_row.material_name,
          "indicatorName" = 'Previsto (R$/t)',
          "forecastValue" = seed_row.forecast_value,
          "observation" = seed_observation,
          "active" = TRUE,
          "updatedById" = seed_actor_id,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = forecast_id;
    END IF;

    INSERT INTO "UsinaForecastHistory" (
      "id", "forecastId", "companyId", "unitId", "competence",
      "materialCode", "indicatorCode", "action", "previousValue",
      "newValue", "previousObservation", "newObservation", "actorId",
      "changedAt"
    ) VALUES (
      md5(forecast_id || '|cap-seed-2025-20260826'), forecast_id,
      'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', seed_row.competence,
      seed_row.material_code, 'PREVISTO_R_T', history_action,
      previous_value, seed_row.forecast_value, previous_observation,
      seed_observation, seed_actor_id, CURRENT_TIMESTAMP
    ) ON CONFLICT ("id") DO NOTHING;
  END LOOP;
END $$;

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

COMMIT;
