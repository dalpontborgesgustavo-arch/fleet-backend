CREATE OR REPLACE VIEW "bi"."obras_medicoes" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
),
raw AS (
  SELECT
    m.*,
    CASE LOWER(m."mesReferencia")
      WHEN 'janeiro' THEN 1
      WHEN 'fevereiro' THEN 2
      WHEN 'marco' THEN 3
      WHEN 'março' THEN 3
      WHEN 'marÃ§o' THEN 3
      WHEN 'abril' THEN 4
      WHEN 'maio' THEN 5
      WHEN 'junho' THEN 6
      WHEN 'julho' THEN 7
      WHEN 'agosto' THEN 8
      WHEN 'setembro' THEN 9
      WHEN 'outubro' THEN 10
      WHEN 'novembro' THEN 11
      WHEN 'dezembro' THEN 12
      ELSE NULL
    END AS mes_numero
  FROM state
  CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'measurements', '[]'::jsonb)) AS m(
    id text,
    "workId" text,
    descricao text,
    "valorContratadoTotal" text,
    "executadoMes" text,
    "valorRealizadoAditivo" text,
    "mesReferencia" text,
    "anoReferencia" text,
    "dataDe" text,
    "dataAte" text
  )
)
SELECT
  m.id AS "medicao_id",
  m."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  m.descricao AS "etapa",
  CASE WHEN m."valorContratadoTotal" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorContratadoTotal"::numeric ELSE 0 END AS "valor_contratado_total",
  CASE WHEN m."executadoMes" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."executadoMes"::numeric ELSE 0 END AS "executado_mes",
  CASE WHEN m."valorRealizadoAditivo" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorRealizadoAditivo"::numeric ELSE 0 END AS "valor_realizado_aditivo",
  CASE WHEN m."executadoMes" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."executadoMes"::numeric ELSE 0 END
    + CASE WHEN m."valorRealizadoAditivo" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorRealizadoAditivo"::numeric ELSE 0 END AS "realizado_total_mes",
  m."mesReferencia" AS "mes_referencia_nome",
  CASE
    WHEN m."anoReferencia" ~ '^[0-9]+$' AND m."anoReferencia"::integer BETWEEN 1900 AND 2100
      THEN m."anoReferencia"::integer
    ELSE NULL
  END AS "ano_referencia",
  CASE
    WHEN m."dataAte" ~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN DATE_TRUNC('month', m."dataAte"::date)::date
    WHEN m."dataDe" ~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN DATE_TRUNC('month', m."dataDe"::date)::date
    WHEN m."anoReferencia" ~ '^[0-9]+$'
      AND m."anoReferencia"::integer BETWEEN 1900 AND 2100
      AND m.mes_numero BETWEEN 1 AND 12
      THEN make_date(m."anoReferencia"::integer, m.mes_numero, 1)
    ELSE NULL
  END AS "mes_referencia",
  CASE WHEN m."dataDe" ~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN m."dataDe"::date ELSE NULL END AS "data_medicao_de",
  CASE WHEN m."dataAte" ~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN m."dataAte"::date ELSE NULL END AS "data_medicao_ate"
FROM raw m
LEFT JOIN "bi"."obras" o ON o."obra_id" = m."workId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
