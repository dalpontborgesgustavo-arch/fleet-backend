CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Vehicle"
ADD COLUMN "veiculo_manutencao" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VehicleMaintenanceHistory" (
  "id" BIGSERIAL NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "veiculo_manutencao" BOOLEAN NOT NULL,
  "dt_inicio" TIMESTAMPTZ(6) NOT NULL,
  "dt_fim" TIMESTAMPTZ(6),
  "usuario_alteracao" TEXT,
  "dt_alteracao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VehicleMaintenanceHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VehicleMaintenanceHistory_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VehicleMaintenanceHistory_valid_period_check"
    CHECK ("dt_fim" IS NULL OR "dt_fim" > "dt_inicio")
);

CREATE INDEX "VehicleMaintenanceHistory_vehicle_id_dt_inicio_idx"
ON "VehicleMaintenanceHistory"("vehicle_id", "dt_inicio");

CREATE INDEX "VehicleMaintenanceHistory_dt_inicio_dt_fim_idx"
ON "VehicleMaintenanceHistory"("dt_inicio", "dt_fim");

CREATE UNIQUE INDEX "VehicleMaintenanceHistory_one_current_status_idx"
ON "VehicleMaintenanceHistory"("vehicle_id")
WHERE "dt_fim" IS NULL;

ALTER TABLE "VehicleMaintenanceHistory"
ADD CONSTRAINT "VehicleMaintenanceHistory_no_overlapping_periods"
EXCLUDE USING gist (
  "vehicle_id" WITH =,
  tstzrange(
    "dt_inicio",
    COALESCE("dt_fim", 'infinity'::timestamptz),
    '[)'
  ) WITH &&
);

-- Estado inicial: todos os veiculos existentes partem como nao pertencentes
-- a manutencao desde o cadastro. Alteracoes futuras ficam historizadas.
INSERT INTO "VehicleMaintenanceHistory" (
  "vehicle_id",
  "veiculo_manutencao",
  "dt_inicio",
  "dt_alteracao"
)
SELECT
  vehicle."id",
  vehicle."veiculo_manutencao",
  vehicle."createdAt" AT TIME ZONE 'UTC',
  CURRENT_TIMESTAMP
FROM "Vehicle" vehicle;

CREATE OR REPLACE FUNCTION "track_vehicle_maintenance_status"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  effective_at TIMESTAMPTZ(6);
  current_start TIMESTAMPTZ(6);
  actor TEXT;
BEGIN
  actor := NULLIF(current_setting('app.user_email', true), '');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO "VehicleMaintenanceHistory" (
      "vehicle_id",
      "veiculo_manutencao",
      "dt_inicio",
      "usuario_alteracao"
    )
    VALUES (
      NEW."id",
      NEW."veiculo_manutencao",
      COALESCE(NEW."createdAt" AT TIME ZONE 'UTC', clock_timestamp()),
      actor
    );
    RETURN NEW;
  END IF;

  IF NEW."veiculo_manutencao" IS DISTINCT FROM OLD."veiculo_manutencao" THEN
    SELECT history."dt_inicio"
      INTO current_start
    FROM "VehicleMaintenanceHistory" history
    WHERE history."vehicle_id" = NEW."id"
      AND history."dt_fim" IS NULL
    FOR UPDATE;

    effective_at := clock_timestamp();
    IF current_start IS NOT NULL THEN
      effective_at := GREATEST(
        effective_at,
        current_start + INTERVAL '1 microsecond'
      );

      UPDATE "VehicleMaintenanceHistory"
      SET
        "dt_fim" = effective_at,
        "dt_alteracao" = effective_at
      WHERE "vehicle_id" = NEW."id"
        AND "dt_fim" IS NULL;
    END IF;

    INSERT INTO "VehicleMaintenanceHistory" (
      "vehicle_id",
      "veiculo_manutencao",
      "dt_inicio",
      "usuario_alteracao",
      "dt_alteracao"
    )
    VALUES (
      NEW."id",
      NEW."veiculo_manutencao",
      effective_at,
      actor,
      effective_at
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Vehicle_maintenance_history_trigger"
AFTER INSERT OR UPDATE OF "veiculo_manutencao" ON "Vehicle"
FOR EACH ROW
EXECUTE FUNCTION "track_vehicle_maintenance_status"();

-- Preserva a view bi.veiculos e apenas acrescenta a classificacao atual ao final.
CREATE OR REPLACE VIEW "bi"."veiculos" AS
SELECT
  vehicle."id" AS veiculo_id,
  vehicle."fleet" AS frota,
  vehicle."plate" AS placa,
  vehicle."name" AS veiculo_nome,
  vehicle."model" AS modelo,
  vehicle."group" AS grupo,
  vehicle."subgroup" AS subgrupo,
  vehicle."company" AS empresa,
  vehicle."tipoFrota" AS tipo_frota,
  vehicle."vehicleType" AS tipo_veiculo,
  vehicle."type" AS subtipo_veiculo,
  vehicle."filial"::text AS filial_codigo,
  CASE vehicle."filial"::text
    WHEN 'NORTE' THEN 'Filial Norte'
    ELSE 'Matriz'
  END AS filial,
  vehicle."active" AS ativo,
  vehicle."hasTimeClockDevice" AS possui_dispositivo_ponto,
  vehicle."responsibleName" AS responsavel_veiculo_nome,
  vehicle."responsibleEmail" AS responsavel_veiculo_email,
  vehicle."photoUrl" AS foto_url,
  CASE
    WHEN NULLIF(BTRIM(COALESCE(vehicle."photoUrl", '')), '') IS NULL THEN NULL
    WHEN vehicle."photoUrl" ILIKE 'http%' THEN vehicle."photoUrl"
    ELSE CONCAT('https://api.jrconstrucoes.net.br', vehicle."photoUrl")
  END AS foto_url_absoluta,
  (NULLIF(BTRIM(COALESCE(vehicle."photoUrl", '')), '') IS NOT NULL) AS tem_foto,
  (
    NULLIF(BTRIM(COALESCE(vehicle."group", '')), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(vehicle."subgroup", '')), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(vehicle."company", '')), '') IS NOT NULL
  ) AS classificacao_completa,
  vehicle."createdAt" AS cadastrado_em,
  vehicle."veiculo_manutencao" AS veiculo_manutencao
FROM "Vehicle" vehicle;

COMMENT ON VIEW "bi"."veiculos" IS
  'Dimensao atual de veiculos para Power BI, incluindo classificacao, filial e indicador atual de manutencao.';

CREATE OR REPLACE VIEW "bi"."veiculos_manutencao_historico" AS
SELECT
  history."id" AS historico_id,
  vehicle."id" AS id_veiculo,
  vehicle."fleet" AS frota,
  NULLIF(
    REGEXP_REPLACE(
      UPPER(BTRIM(COALESCE(vehicle."fleet", ''))),
      '^FROTA[[:space:]-]*',
      '',
      'i'
    ),
    ''
  ) AS frota_chave,
  vehicle."plate" AS placa,
  NULLIF(
    REGEXP_REPLACE(
      UPPER(BTRIM(COALESCE(vehicle."plate", ''))),
      '[^A-Z0-9]',
      '',
      'g'
    ),
    ''
  ) AS placa_chave,
  vehicle."name" AS veiculo_nome,
  vehicle."model" AS modelo,
  vehicle."tipoFrota" AS tipo_frota,
  vehicle."filial"::text AS filial_codigo,
  CASE vehicle."filial"::text
    WHEN 'NORTE' THEN 'Filial Norte'
    ELSE 'Matriz'
  END AS filial,
  vehicle."company" AS empresa,
  vehicle."active" AS ativo_atual,
  history."veiculo_manutencao",
  history."dt_inicio",
  history."dt_fim",
  history."usuario_alteracao",
  history."dt_alteracao",
  (history."dt_fim" IS NULL) AS status_atual
FROM "VehicleMaintenanceHistory" history
INNER JOIN "Vehicle" vehicle
  ON vehicle."id" = history."vehicle_id";

COMMENT ON VIEW "bi"."veiculos_manutencao_historico" IS
  'Historico temporal do indicador de veiculo da manutencao. Intervalos seguem [dt_inicio, dt_fim); para uma competencia use dt_inicio < inicio_mes_seguinte e COALESCE(dt_fim, infinity) > inicio_mes.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."veiculos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."veiculos_manutencao_historico" TO powerbi_reader';
  END IF;
END
$$;
