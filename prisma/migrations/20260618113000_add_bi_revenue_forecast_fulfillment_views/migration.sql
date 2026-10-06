CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."previsao_cumprimento_mensal";
DROP VIEW IF EXISTS "bi"."previsao_cumprimento_detalhe";

CREATE VIEW "bi"."previsao_cumprimento_detalhe" AS
WITH base AS (
  SELECT
    rf."id",
    rf."obra",
    rf."valorPrevisto",
    rf."mes",
    rf."ano",
    rf."status",
    GREATEST(COALESCE(rf."postponements", 0), 0) AS "postponements",
    rf."createdById",
    rf."createdAt",
    rf."updatedAt",
    make_date(rf."ano", rf."mes", 1) AS "periodo_atual",
    (
      make_date(rf."ano", rf."mes", 1)
      - make_interval(months => GREATEST(COALESCE(rf."postponements", 0), 0))
    )::date AS "periodo_original"
  FROM "RevenueForecast" rf
),
expandido AS (
  SELECT
    b.*,
    gs."step" AS "sequencia_programacao",
    (b."periodo_original" + make_interval(months => gs."step"))::date AS "periodo_programado",
    (gs."step" = b."postponements") AS "eh_periodo_atual"
  FROM base b
  CROSS JOIN LATERAL generate_series(0, b."postponements") AS gs("step")
)
SELECT
  e."id" AS "previsao_id",
  e."obra" AS "obra",
  e."valorPrevisto"::numeric(14, 2) AS "valor_previsto",
  e."periodo_original" AS "periodo_original",
  EXTRACT(YEAR FROM e."periodo_original")::integer AS "ano_original",
  EXTRACT(MONTH FROM e."periodo_original")::integer AS "mes_original_numero",
  to_char(e."periodo_original", 'YYYY-MM') AS "ano_mes_original",
  e."periodo_atual" AS "periodo_atual",
  EXTRACT(YEAR FROM e."periodo_atual")::integer AS "ano_atual",
  EXTRACT(MONTH FROM e."periodo_atual")::integer AS "mes_atual_numero",
  to_char(e."periodo_atual", 'YYYY-MM') AS "ano_mes_atual",
  e."periodo_programado" AS "periodo",
  EXTRACT(YEAR FROM e."periodo_programado")::integer AS "ano",
  EXTRACT(MONTH FROM e."periodo_programado")::integer AS "mes_numero",
  CASE EXTRACT(MONTH FROM e."periodo_programado")::integer
    WHEN 1 THEN 'Janeiro'
    WHEN 2 THEN 'Fevereiro'
    WHEN 3 THEN 'Marco'
    WHEN 4 THEN 'Abril'
    WHEN 5 THEN 'Maio'
    WHEN 6 THEN 'Junho'
    WHEN 7 THEN 'Julho'
    WHEN 8 THEN 'Agosto'
    WHEN 9 THEN 'Setembro'
    WHEN 10 THEN 'Outubro'
    WHEN 11 THEN 'Novembro'
    WHEN 12 THEN 'Dezembro'
    ELSE 'Mes invalido'
  END AS "mes_nome",
  to_char(e."periodo_programado", 'YYYY-MM') AS "ano_mes",
  CASE
    WHEN e."periodo_programado" < date_trunc('month', CURRENT_DATE)::date THEN 'Vencido'
    WHEN e."periodo_programado" = date_trunc('month', CURRENT_DATE)::date THEN 'Mes atual'
    ELSE 'Futuro'
  END AS "situacao_temporal",
  e."sequencia_programacao" AS "sequencia_programacao",
  e."postponements" AS "qtd_postergacoes_total",
  e."eh_periodo_atual" AS "eh_periodo_atual",
  e."status" AS "status_atual",
  CASE
    WHEN e."eh_periodo_atual" AND e."status" = 'Recebido' THEN 'Recebido'
    WHEN e."eh_periodo_atual" THEN e."status"
    ELSE 'Postergado'
  END AS "status_no_periodo",
  e."valorPrevisto"::numeric(14, 2) AS "valor_programado",
  CASE
    WHEN e."eh_periodo_atual" AND e."status" = 'Recebido'
      THEN e."valorPrevisto"::numeric(14, 2)
    ELSE 0::numeric
  END AS "valor_recebido",
  CASE
    WHEN NOT e."eh_periodo_atual"
      THEN e."valorPrevisto"::numeric(14, 2)
    ELSE 0::numeric
  END AS "valor_postergado",
  CASE
    WHEN e."eh_periodo_atual" AND e."status" <> 'Recebido'
      THEN e."valorPrevisto"::numeric(14, 2)
    ELSE 0::numeric
  END AS "valor_pendente_atual",
  CASE
    WHEN e."eh_periodo_atual" AND e."status" = 'Recebido'
      THEN 0::numeric
    ELSE e."valorPrevisto"::numeric(14, 2)
  END AS "valor_nao_cumprido",
  CASE WHEN e."postponements" > 0 THEN true ELSE false END AS "teve_postergacao",
  CASE WHEN e."postponements" > 1 THEN true ELSE false END AS "teve_mais_de_uma_postergacao",
  e."createdAt" AS "criado_em",
  e."updatedAt" AS "atualizado_em",
  e."createdById" AS "criado_por_id",
  u."name" AS "criado_por_nome",
  u."email" AS "criado_por_email",
  u."role" AS "criado_por_perfil"
FROM expandido e
LEFT JOIN "User" u ON u."id" = e."createdById";

CREATE VIEW "bi"."previsao_cumprimento_mensal" AS
SELECT
  d."periodo" AS "periodo",
  d."ano" AS "ano",
  d."mes_numero" AS "mes_numero",
  d."mes_nome" AS "mes_nome",
  d."ano_mes" AS "ano_mes",
  COUNT(*)::integer AS "qtd_lancamentos_programados",
  COUNT(DISTINCT d."obra")::integer AS "qtd_obras",
  COUNT(*) FILTER (WHERE d."status_no_periodo" = 'Recebido')::integer AS "qtd_recebidos",
  COUNT(*) FILTER (WHERE d."status_no_periodo" = 'Postergado')::integer AS "qtd_postergados_no_mes",
  COUNT(*) FILTER (
    WHERE d."eh_periodo_atual" = true
      AND d."status_no_periodo" <> 'Recebido'
  )::integer AS "qtd_pendentes_atuais",
  COUNT(*) FILTER (WHERE d."teve_mais_de_uma_postergacao" = true)::integer AS "qtd_com_mais_de_uma_postergacao",
  MAX(d."qtd_postergacoes_total")::integer AS "maior_qtd_postergacoes",
  SUM(d."valor_programado")::numeric(14, 2) AS "valor_programado",
  SUM(d."valor_recebido")::numeric(14, 2) AS "valor_recebido",
  SUM(d."valor_postergado")::numeric(14, 2) AS "valor_postergado",
  SUM(d."valor_pendente_atual")::numeric(14, 2) AS "valor_pendente_atual",
  SUM(d."valor_nao_cumprido")::numeric(14, 2) AS "valor_nao_cumprido",
  ROUND(
    CASE
      WHEN SUM(d."valor_programado") = 0 THEN 0
      ELSE SUM(d."valor_recebido") / SUM(d."valor_programado") * 100
    END,
    2
  ) AS "percentual_cumprimento",
  ROUND(
    CASE
      WHEN SUM(d."valor_programado") = 0 THEN 0
      ELSE SUM(d."valor_postergado") / SUM(d."valor_programado") * 100
    END,
    2
  ) AS "percentual_postergado",
  CASE
    WHEN SUM(d."valor_programado") = 0 THEN 'Sem previsao'
    WHEN SUM(d."valor_recebido") >= SUM(d."valor_programado") THEN 'Cumprido'
    WHEN SUM(d."valor_recebido") > 0 THEN 'Parcial'
    ELSE 'Nao cumprido'
  END AS "status_cumprimento"
FROM "bi"."previsao_cumprimento_detalhe" d
GROUP BY d."periodo", d."ano", d."mes_numero", d."mes_nome", d."ano_mes";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
