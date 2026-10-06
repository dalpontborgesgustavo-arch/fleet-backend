CREATE SCHEMA IF NOT EXISTS "bi";

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
  vehicle."createdAt" AS cadastrado_em
FROM "Vehicle" vehicle;

COMMENT ON VIEW "bi"."veiculos" IS
  'Dimensao de veiculos para Power BI, incluindo grupo, subgrupo, empresa e filial.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."veiculos" TO powerbi_reader';
  END IF;
END
$$;

