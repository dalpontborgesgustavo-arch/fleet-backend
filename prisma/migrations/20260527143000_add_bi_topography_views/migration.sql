CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."topografia_chegadas" AS
WITH arrivals AS (
  SELECT
    t.*,
    (t."arrivalAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS "arrivalAtBrasilia"
  FROM "TopographyArrival" t
)
SELECT
  a."id",
  a."userId" AS "usuario_id",
  u."name" AS "usuario_nome",
  u."email" AS "usuario_email",
  u."role" AS "usuario_perfil",
  a."obra",
  a."city" AS "cidade",
  a."workDate" AS "data_texto",
  a."workDate"::date AS "data",
  a."arrivalAt" AS "chegada_em_utc",
  a."arrivalAtBrasilia" AS "chegada_em_brasilia",
  TO_CHAR(a."arrivalAtBrasilia", 'HH24:MI') AS "hora_chegada",
  a."arrivalAtBrasilia"::time AS "hora_chegada_time",
  (a."arrivalAtBrasilia"::time > TIME '08:00') AS "chegada_atrasada",
  GREATEST(
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          a."arrivalAtBrasilia" - (
            DATE_TRUNC('day', a."arrivalAtBrasilia") + INTERVAL '8 hours'
          )
        )
      ) / 60
    )::integer,
    0
  ) AS "minutos_atraso",
  a."justification" AS "justificativa",
  (NULLIF(TRIM(COALESCE(a."justification", '')), '') IS NOT NULL) AS "tem_justificativa",
  a."locationLatitude" AS "latitude",
  a."locationLongitude" AS "longitude",
  a."locationUrl" AS "localizacao_url",
  CASE
    WHEN NULLIF(TRIM(COALESCE(a."locationUrl", '')), '') IS NOT NULL THEN a."locationUrl"
    WHEN a."locationLatitude" IS NOT NULL AND a."locationLongitude" IS NOT NULL THEN
      CONCAT('https://www.google.com/maps?q=', a."locationLatitude", ',', a."locationLongitude")
    ELSE NULL
  END AS "mapa_url",
  a."photoUrl" AS "foto_url",
  CASE
    WHEN NULLIF(TRIM(COALESCE(a."photoUrl", '')), '') IS NULL THEN NULL
    WHEN a."photoUrl" ILIKE 'http%' THEN a."photoUrl"
    ELSE CONCAT('https://api.jrconstrucoes.net.br', a."photoUrl")
  END AS "foto_url_absoluta",
  (NULLIF(TRIM(COALESCE(a."photoUrl", '')), '') IS NOT NULL) AS "tem_foto",
  a."createdAt" AS "criado_em",
  a."updatedAt" AS "atualizado_em"
FROM arrivals a
LEFT JOIN "User" u ON u."id" = a."userId";

CREATE OR REPLACE VIEW "bi"."topografia_resumo_mensal" AS
WITH arrivals AS (
  SELECT
    t.*,
    u."name" AS "usuario_nome",
    u."email" AS "usuario_email",
    u."role" AS "usuario_perfil",
    (t."arrivalAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS "arrivalAtBrasilia"
  FROM "TopographyArrival" t
  LEFT JOIN "User" u ON u."id" = t."userId"
),
classified AS (
  SELECT
    *,
    ("arrivalAtBrasilia"::time > TIME '08:00') AS "chegada_atrasada",
    GREATEST(
      FLOOR(
        EXTRACT(
          EPOCH FROM (
            "arrivalAtBrasilia" - (
              DATE_TRUNC('day', "arrivalAtBrasilia") + INTERVAL '8 hours'
            )
          )
        ) / 60
      )::integer,
      0
    ) AS "minutos_atraso",
    (NULLIF(TRIM(COALESCE("justification", '')), '') IS NOT NULL) AS "tem_justificativa",
    (NULLIF(TRIM(COALESCE("photoUrl", '')), '') IS NOT NULL) AS "tem_foto",
    (
      NULLIF(TRIM(COALESCE("locationUrl", '')), '') IS NOT NULL
      OR ("locationLatitude" IS NOT NULL AND "locationLongitude" IS NOT NULL)
    ) AS "tem_localizacao"
  FROM arrivals
)
SELECT
  "userId" AS "usuario_id",
  "usuario_nome",
  "usuario_email",
  "usuario_perfil",
  EXTRACT(YEAR FROM "workDate"::date)::integer AS "ano",
  EXTRACT(MONTH FROM "workDate"::date)::integer AS "mes",
  TO_CHAR("workDate"::date, 'YYYY-MM') AS "ano_mes",
  COUNT(*)::integer AS "registros",
  COUNT(*) FILTER (WHERE NOT "chegada_atrasada")::integer AS "chegadas_no_prazo",
  COUNT(*) FILTER (WHERE "chegada_atrasada")::integer AS "chegadas_atrasadas",
  COUNT(*) FILTER (WHERE "tem_justificativa")::integer AS "registros_com_justificativa",
  COUNT(*) FILTER (WHERE "tem_foto")::integer AS "registros_com_foto",
  COUNT(*) FILTER (WHERE "tem_localizacao")::integer AS "registros_com_localizacao",
  ROUND(
    (COUNT(*) FILTER (WHERE NOT "chegada_atrasada")::numeric / NULLIF(COUNT(*), 0)) * 100,
    2
  ) AS "percentual_no_prazo",
  ROUND(AVG("minutos_atraso")::numeric, 2) AS "media_minutos_atraso",
  MAX("arrivalAtBrasilia") AS "ultima_chegada_em_brasilia"
FROM classified
GROUP BY
  "userId",
  "usuario_nome",
  "usuario_email",
  "usuario_perfil",
  EXTRACT(YEAR FROM "workDate"::date),
  EXTRACT(MONTH FROM "workDate"::date),
  TO_CHAR("workDate"::date, 'YYYY-MM');
