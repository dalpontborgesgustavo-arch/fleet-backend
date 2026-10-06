ALTER TABLE "RevenueForecast"
ADD COLUMN IF NOT EXISTS "postponements" integer NOT NULL DEFAULT 0;

DROP VIEW IF EXISTS "bi"."previsao_indicadores_mensais";
DROP VIEW IF EXISTS "bi"."previsao_resumo_mensal_status";
DROP VIEW IF EXISTS "bi"."previsao_lancamentos";

CREATE VIEW "bi"."previsao_lancamentos" AS
SELECT
  rf."id" AS "previsao_id",
  rf."obra" AS "obra",
  rf."valorPrevisto"::numeric(14, 2) AS "valor_previsto",
  rf."mes" AS "mes_numero",
  CASE rf."mes"
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
  rf."ano" AS "ano",
  make_date(rf."ano", rf."mes", 1) AS "periodo",
  to_char(make_date(rf."ano", rf."mes", 1), 'YYYY-MM') AS "ano_mes",
  rf."status" AS "status",
  CASE rf."status"
    WHEN 'Sem NF' THEN '01 - Sem NF'
    WHEN 'Com NF' THEN '02 - Com NF'
    WHEN 'Recebido' THEN '03 - Recebido'
    ELSE '99 - Outros'
  END AS "status_ordem",
  CASE WHEN rf."status" = 'Sem NF' THEN rf."valorPrevisto"::numeric(14, 2) ELSE 0::numeric END AS "valor_sem_nf",
  CASE WHEN rf."status" = 'Com NF' THEN rf."valorPrevisto"::numeric(14, 2) ELSE 0::numeric END AS "valor_com_nf",
  CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto"::numeric(14, 2) ELSE 0::numeric END AS "valor_recebido",
  CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto"::numeric(14, 2) ELSE 0::numeric END AS "valor_faturado",
  rf."postponements" AS "qtd_postergacoes",
  rf."createdAt" AS "criado_em",
  rf."updatedAt" AS "atualizado_em",
  rf."createdById" AS "criado_por_id",
  u."name" AS "criado_por_nome",
  u."email" AS "criado_por_email",
  u."role" AS "criado_por_perfil"
FROM "RevenueForecast" rf
LEFT JOIN "User" u ON u."id" = rf."createdById";

CREATE VIEW "bi"."previsao_resumo_mensal_status" AS
SELECT
  make_date(rf."ano", rf."mes", 1) AS "periodo",
  to_char(make_date(rf."ano", rf."mes", 1), 'YYYY-MM') AS "ano_mes",
  rf."ano" AS "ano",
  rf."mes" AS "mes_numero",
  CASE rf."mes"
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
  rf."status" AS "status",
  COUNT(*)::integer AS "qtd_lancamentos",
  COUNT(DISTINCT rf."obra")::integer AS "qtd_obras",
  SUM(rf."postponements")::integer AS "qtd_postergacoes",
  SUM(rf."valorPrevisto")::numeric(14, 2) AS "valor_previsto"
FROM "RevenueForecast" rf
GROUP BY rf."ano", rf."mes", rf."status";

CREATE VIEW "bi"."previsao_indicadores_mensais" AS
SELECT
  make_date(rf."ano", rf."mes", 1) AS "periodo",
  to_char(make_date(rf."ano", rf."mes", 1), 'YYYY-MM') AS "ano_mes",
  rf."ano" AS "ano",
  rf."mes" AS "mes_numero",
  CASE rf."mes"
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
  COUNT(*)::integer AS "qtd_lancamentos",
  COUNT(DISTINCT rf."obra")::integer AS "qtd_obras",
  SUM(rf."postponements")::integer AS "qtd_postergacoes",
  SUM(rf."valorPrevisto")::numeric(14, 2) AS "total_previsto",
  SUM(CASE WHEN rf."status" = 'Sem NF' THEN rf."valorPrevisto" ELSE 0 END)::numeric(14, 2) AS "total_sem_nf",
  SUM(CASE WHEN rf."status" = 'Com NF' THEN rf."valorPrevisto" ELSE 0 END)::numeric(14, 2) AS "total_com_nf",
  SUM(CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto" ELSE 0 END)::numeric(14, 2) AS "total_recebido",
  SUM(CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto" ELSE 0 END)::numeric(14, 2) AS "total_faturado",
  ROUND(
    CASE
      WHEN SUM(rf."valorPrevisto") = 0 THEN 0
      ELSE SUM(CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto" ELSE 0 END) / SUM(rf."valorPrevisto") * 100
    END,
    2
  ) AS "percentual_recebido",
  ROUND(
    CASE
      WHEN SUM(rf."valorPrevisto") = 0 THEN 0
      ELSE SUM(CASE WHEN rf."status" = 'Recebido' THEN rf."valorPrevisto" ELSE 0 END) / SUM(rf."valorPrevisto") * 100
    END,
    2
  ) AS "percentual_faturado",
  ROUND(
    CASE
      WHEN SUM(rf."valorPrevisto") = 0 THEN 0
      ELSE SUM(CASE WHEN rf."status" IN ('Com NF', 'Recebido') THEN rf."valorPrevisto" ELSE 0 END) / SUM(rf."valorPrevisto") * 100
    END,
    2
  ) AS "percentual_com_nf_ou_recebido",
  ROUND(
    CASE
      WHEN SUM(rf."valorPrevisto") = 0 THEN 0
      ELSE SUM(CASE WHEN rf."status" IN ('Com NF', 'Recebido') THEN rf."valorPrevisto" ELSE 0 END) / SUM(rf."valorPrevisto") * 100
    END,
    2
  ) AS "percentual_com_nf_ou_faturado"
FROM "RevenueForecast" rf
GROUP BY rf."ano", rf."mes";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
