BEGIN;

-- Congela o valor efetivo que era exibido no momento do corte e, em seguida,
-- remove a dependência operacional do Aethos do módulo de impostos.
CREATE TEMP TABLE "_TaxForecastManualCutover" ON COMMIT DROP AS
SELECT
  COALESCE(previsao."id", gen_random_uuid()::text) AS "targetId",
  impostos."empresa_codigo" AS "company",
  impostos."imposto" AS "taxType",
  impostos."ano" AS "year",
  impostos."mes" AS "month",
  COALESCE(previsao."forecastAmount", 0)::numeric(18, 2) AS "forecastAmount",
  impostos."valor_realizado"::numeric(18, 2) AS "actualAmount",
  previsao."id" AS "previousId",
  previsao."actualAmount"::numeric(18, 2) AS "previousActualAmount"
FROM "bi"."contabilidade_impostos" impostos
LEFT JOIN "TaxForecast" previsao
  ON previsao."company" = impostos."empresa_codigo"
 AND previsao."taxType" = impostos."imposto"
 AND previsao."year" = impostos."ano"
 AND previsao."month" = impostos."mes"
WHERE impostos."valor_realizado" <> 0;

INSERT INTO "TaxForecastAudit" (
  "id",
  "taxForecastId",
  "company",
  "taxType",
  "year",
  "month",
  "action",
  "source",
  "previousData",
  "nextData",
  "changedById",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  corte."targetId",
  corte."company",
  corte."taxType",
  corte."year",
  corte."month",
  CASE WHEN corte."previousId" IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
  'MIGRACAO_CORTE_MANUAL',
  CASE
    WHEN corte."previousId" IS NULL THEN NULL
    ELSE jsonb_build_object(
      'forecastAmount', corte."forecastAmount",
      'actualAmountManual', corte."previousActualAmount"
    )
  END,
  jsonb_build_object(
    'forecastAmount', corte."forecastAmount",
    'actualAmountManual', corte."actualAmount"
  ),
  NULL,
  CURRENT_TIMESTAMP
FROM "_TaxForecastManualCutover" corte
WHERE corte."previousId" IS NULL
   OR corte."previousActualAmount" IS DISTINCT FROM corte."actualAmount";

INSERT INTO "TaxForecast" (
  "id",
  "company",
  "taxType",
  "year",
  "month",
  "forecastAmount",
  "actualAmount",
  "updatedById",
  "createdAt",
  "updatedAt"
)
SELECT
  corte."targetId",
  corte."company",
  corte."taxType",
  corte."year",
  corte."month",
  corte."forecastAmount",
  corte."actualAmount",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_TaxForecastManualCutover" corte
ON CONFLICT ("company", "taxType", "year", "month") DO UPDATE
SET
  "actualAmount" = EXCLUDED."actualAmount",
  "updatedAt" = CASE
    WHEN "TaxForecast"."actualAmount" IS DISTINCT FROM EXCLUDED."actualAmount"
      THEN CURRENT_TIMESTAMP
    ELSE "TaxForecast"."updatedAt"
  END;

-- O conjunto e a ordem das colunas ficam preservados para não exigir mudança
-- no Power BI. A partir daqui, valor_realizado vem somente de TaxForecast.
CREATE OR REPLACE VIEW "bi"."contabilidade_impostos" AS
WITH anos_fonte AS (
  SELECT
    previsao."company" AS "empresa_codigo",
    previsao."year" AS ano
  FROM "TaxForecast" previsao
),
limites_empresa AS (
  SELECT
    empresa."empresa_codigo",
    COALESCE(MIN(anos_fonte.ano), EXTRACT(YEAR FROM CURRENT_DATE)::integer) AS ano_inicial,
    GREATEST(
      COALESCE(MAX(anos_fonte.ano), EXTRACT(YEAR FROM CURRENT_DATE)::integer),
      EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ) AS ano_final
  FROM (
    SELECT DISTINCT "empresa_codigo"
    FROM "bi"."contabilidade_impostos_configuracao"
  ) empresa
  LEFT JOIN anos_fonte
    ON anos_fonte."empresa_codigo" = empresa."empresa_codigo"
  GROUP BY empresa."empresa_codigo"
),
grade_competencias AS (
  SELECT
    configuracao.*,
    competencia::date AS competencia_data,
    TO_CHAR(competencia, 'YYYY-MM') AS competencia
  FROM "bi"."contabilidade_impostos_configuracao" configuracao
  INNER JOIN limites_empresa
    ON limites_empresa."empresa_codigo" = configuracao."empresa_codigo"
  CROSS JOIN LATERAL GENERATE_SERIES(
    MAKE_DATE(limites_empresa.ano_inicial, 1, 1),
    MAKE_DATE(limites_empresa.ano_final, 12, 1),
    INTERVAL '1 month'
  ) competencia
),
previsao AS (
  SELECT
    previsao."company" AS empresa_codigo,
    previsao."taxType" AS imposto,
    TO_CHAR(MAKE_DATE(previsao."year", previsao."month", 1), 'YYYY-MM') AS competencia,
    SUM(COALESCE(previsao."forecastAmount", 0))::numeric(18, 2) AS valor_previsto,
    SUM(COALESCE(previsao."actualAmount", 0))::numeric(18, 2) AS valor_realizado,
    MAX(previsao."updatedAt") AS previsao_atualizada_em,
    MAX(usuario."name") AS previsao_atualizada_por
  FROM "TaxForecast" previsao
  LEFT JOIN "User" usuario
    ON usuario."id" = previsao."updatedById"
  GROUP BY
    previsao."company",
    previsao."taxType",
    previsao."year",
    previsao."month"
)
SELECT
  CONCAT(grade."empresa_codigo", ':', grade."imposto", ':', grade.competencia) AS chave,
  grade."empresa_codigo",
  grade."empresa_nome",
  grade."empresa_ordem",
  grade."imposto",
  grade."imposto_ordem",
  grade."aethos_empresa_codigo",
  grade."aethos_plano_conta_codigo",
  grade."aethos_plano_conta_nome",
  grade."deslocamento_competencia_meses",
  'MANUAL_USUARIO'::text AS base_realizado,
  grade.competencia,
  grade.competencia AS competencia_fiscal,
  grade.competencia_data,
  EXTRACT(YEAR FROM grade.competencia_data)::integer AS ano,
  EXTRACT(MONTH FROM grade.competencia_data)::integer AS mes,
  TO_CHAR(grade.competencia_data, 'YYYY-MM') AS ano_mes,
  CASE EXTRACT(MONTH FROM grade.competencia_data)::integer
    WHEN 1 THEN 'Janeiro'
    WHEN 2 THEN 'Fevereiro'
    WHEN 3 THEN 'Março'
    WHEN 4 THEN 'Abril'
    WHEN 5 THEN 'Maio'
    WHEN 6 THEN 'Junho'
    WHEN 7 THEN 'Julho'
    WHEN 8 THEN 'Agosto'
    WHEN 9 THEN 'Setembro'
    WHEN 10 THEN 'Outubro'
    WHEN 11 THEN 'Novembro'
    WHEN 12 THEN 'Dezembro'
  END AS mes_nome,
  COALESCE(previsao.valor_previsto, 0)::numeric(18, 2) AS valor_previsto,
  COALESCE(previsao.valor_realizado, 0)::numeric(18, 2) AS valor_realizado,
  COALESCE(previsao.valor_realizado, 0)::numeric(18, 2) AS valor_pago,
  0::numeric(18, 2) AS valor_saldo,
  NULL::text AS competencias_aethos,
  COALESCE(previsao.valor_realizado, 0)::numeric(18, 2) AS realizado_manual_legado,
  (
    COALESCE(previsao.valor_realizado, 0)
    - COALESCE(previsao.valor_previsto, 0)
  )::numeric(18, 2) AS variacao_realizado_previsto,
  CASE
    WHEN COALESCE(previsao.valor_previsto, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(previsao.valor_realizado, 0)
      / NULLIF(previsao.valor_previsto, 0)
      * 100,
      2
    )
  END::numeric(18, 2) AS percentual_execucao,
  (COALESCE(previsao.valor_previsto, 0) <> 0) AS tem_previsao,
  (COALESCE(previsao.valor_realizado, 0) <> 0) AS tem_realizado,
  CASE
    WHEN grade.competencia_data > DATE_TRUNC('month', CURRENT_DATE)::date
      THEN 'Competência futura'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(previsao.valor_realizado, 0) = 0
      THEN 'Sem previsão e sem realizado'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(previsao.valor_realizado, 0) <> 0
      THEN 'Realizado sem previsão'
    WHEN COALESCE(previsao.valor_realizado, 0) > COALESCE(previsao.valor_previsto, 0)
      THEN 'Acima do previsto'
    WHEN COALESCE(previsao.valor_realizado, 0) = COALESCE(previsao.valor_previsto, 0)
      THEN 'No previsto'
    ELSE 'Abaixo do previsto'
  END AS situacao,
  CASE WHEN COALESCE(previsao.valor_realizado, 0) <> 0 THEN 1 ELSE 0 END::integer AS qtd_lancamentos,
  0::integer AS qtd_lancamentos_com_nf,
  0::integer AS qtd_notas_fiscais,
  NULL::timestamp without time zone AS primeiro_lancamento_em,
  NULL::timestamp without time zone AS ultimo_lancamento_em,
  NULL::timestamp without time zone AS ultimo_sync_aethos,
  previsao.previsao_atualizada_em,
  previsao.previsao_atualizada_por
FROM grade_competencias grade
LEFT JOIN previsao
  ON previsao.empresa_codigo = grade."empresa_codigo"
 AND previsao.imposto = grade."imposto"
 AND previsao.competencia = grade.competencia;

-- O detalhamento deixa de apontar para a tabela sincronizada e passa a expor
-- somente o estado manual atual, preservando os nomes das colunas do contrato.
DROP VIEW IF EXISTS "bi"."contabilidade_impostos_lancamentos";
CREATE VIEW "bi"."contabilidade_impostos_lancamentos" AS
SELECT
  previsao."id",
  previsao."id" AS chave_integracao,
  configuracao."empresa_codigo",
  configuracao."empresa_nome",
  configuracao."empresa_ordem",
  configuracao."imposto",
  configuracao."imposto_ordem",
  configuracao."aethos_empresa_codigo",
  configuracao."aethos_plano_conta_codigo",
  configuracao."aethos_plano_conta_nome",
  configuracao."deslocamento_competencia_meses",
  TO_CHAR(MAKE_DATE(previsao."year", previsao."month", 1), 'YYYY-MM') AS competencia,
  TO_CHAR(MAKE_DATE(previsao."year", previsao."month", 1), 'YYYY-MM') AS competencia_fiscal,
  NULL::text AS competencia_aethos,
  MAKE_DATE(previsao."year", previsao."month", 1)::timestamp without time zone AS competencia_data,
  previsao."year" AS ano,
  previsao."month" AS mes,
  previsao."id" AS id_lancamento,
  'SISTEMA_JR_MANUAL'::text AS origem,
  previsao."updatedAt" AS data_base_lancamento,
  previsao."updatedAt" AS data_lancamento,
  NULL::timestamp without time zone AS data_vencimento,
  false AS tem_nota_fiscal,
  NULL::text AS id_nota_fiscal,
  NULL::text AS numero_nota_fiscal,
  NULL::timestamp without time zone AS data_emissao_nota_fiscal,
  'Valor informado manualmente no Sistema JR'::text AS observacao_lancamento,
  NULL::text AS observacao_nota_fiscal,
  previsao."actualAmount"::numeric(18, 2) AS valor_realizado,
  previsao."actualAmount"::numeric(18, 2) AS valor_pago,
  0::numeric(18, 2) AS valor_saldo,
  'MANUAL'::text AS status,
  'Informado manualmente'::text AS status_descricao,
  'MANUAL'::text AS tipo_documento,
  'Lançamento manual'::text AS tipo_documento_descricao,
  NULL::timestamp without time zone AS sincronizado_em,
  previsao."createdAt" AS criado_em,
  previsao."updatedAt" AS atualizado_em
FROM "TaxForecast" previsao
INNER JOIN "bi"."contabilidade_impostos_configuracao" configuracao
  ON configuracao."empresa_codigo" = previsao."company"
 AND configuracao."imposto" = previsao."taxType";

COMMENT ON VIEW "bi"."contabilidade_impostos" IS
  'Contrato BI preservado. Previsão e realizado são informados manualmente no Sistema JR, sem sobrescrita do Aethos.';

COMMENT ON VIEW "bi"."contabilidade_impostos_lancamentos" IS
  'Detalhamento do estado manual atual dos impostos, sem dependência da sincronização do Aethos.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos_lancamentos" TO powerbi_reader';
  END IF;
END
$$;

COMMIT;
