CREATE TABLE "TaxForecastAudit" (
  "id" TEXT NOT NULL,
  "taxForecastId" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "taxType" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "previousData" JSONB,
  "nextData" JSONB NOT NULL,
  "changedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaxForecastAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxForecastAudit_taxForecastId_createdAt_idx"
  ON "TaxForecastAudit"("taxForecastId", "createdAt");

CREATE INDEX "TaxForecastAudit_company_taxType_year_month_createdAt_idx"
  ON "TaxForecastAudit"("company", "taxType", "year", "month", "createdAt");

CREATE INDEX "TaxForecastAudit_changedById_idx"
  ON "TaxForecastAudit"("changedById");

-- O contrato da view permanece idêntico. Somente a regra interna do mesmo
-- campo valor_realizado passa a usar o manual quando o Aethos estiver zerado.
CREATE OR REPLACE VIEW "bi"."contabilidade_impostos" AS
WITH anos_fonte AS (
  SELECT
    configuracao."empresa_codigo",
    EXTRACT(
      YEAR FROM (
        TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
        - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses")
      )
    )::integer AS ano
  FROM "bi"."contabilidade_impostos_configuracao" configuracao
  INNER JOIN "AethosPlanoContaCost" custo
    ON custo."codigoEmpresa" = configuracao."aethos_empresa_codigo"
   AND custo."codigoPlanoConta" = configuracao."aethos_plano_conta_codigo"
   AND custo."active" = true
   AND custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$'

  UNION

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
realizado AS (
  SELECT
    configuracao."empresa_codigo",
    configuracao."imposto",
    TO_CHAR(
      TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
      - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses"),
      'YYYY-MM'
    ) AS competencia,
    STRING_AGG(DISTINCT custo."competencia", ', ' ORDER BY custo."competencia") AS competencias_aethos,
    COUNT(*)::integer AS qtd_lancamentos,
    COUNT(*) FILTER (WHERE custo."temNotaFiscal")::integer AS qtd_lancamentos_com_nf,
    COUNT(DISTINCT NULLIF(custo."numeroNotaFiscal", ''))::integer AS qtd_notas_fiscais,
    SUM(COALESCE(custo."valorCusto", 0))::numeric(18, 2) AS valor_realizado,
    SUM(COALESCE(custo."valorPago", 0))::numeric(18, 2) AS valor_pago,
    SUM(COALESCE(custo."valorSaldo", 0))::numeric(18, 2) AS valor_saldo,
    MIN(custo."dataLancamento") AS primeiro_lancamento_em,
    MAX(custo."dataLancamento") AS ultimo_lancamento_em,
    MAX(custo."syncedAt") AS ultimo_sync_aethos
  FROM "bi"."contabilidade_impostos_configuracao" configuracao
  INNER JOIN "AethosPlanoContaCost" custo
    ON custo."codigoEmpresa" = configuracao."aethos_empresa_codigo"
   AND custo."codigoPlanoConta" = configuracao."aethos_plano_conta_codigo"
   AND custo."active" = true
   AND custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$'
  GROUP BY
    configuracao."empresa_codigo",
    configuracao."imposto",
    TO_CHAR(
      TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
      - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses"),
      'YYYY-MM'
    )
),
previsao AS (
  SELECT
    previsao."company" AS empresa_codigo,
    previsao."taxType" AS imposto,
    TO_CHAR(MAKE_DATE(previsao."year", previsao."month", 1), 'YYYY-MM') AS competencia,
    SUM(COALESCE(previsao."forecastAmount", 0))::numeric(18, 2) AS valor_previsto,
    SUM(COALESCE(previsao."actualAmount", 0))::numeric(18, 2) AS realizado_manual_legado,
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
  CONCAT(
    grade."empresa_codigo",
    ':',
    grade."imposto",
    ':',
    grade.competencia
  ) AS chave,
  grade."empresa_codigo",
  grade."empresa_nome",
  grade."empresa_ordem",
  grade."imposto",
  grade."imposto_ordem",
  grade."aethos_empresa_codigo",
  grade."aethos_plano_conta_codigo",
  grade."aethos_plano_conta_nome",
  grade."deslocamento_competencia_meses",
  grade."base_realizado",
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
  COALESCE(
    NULLIF(realizado.valor_realizado, 0),
    previsao.realizado_manual_legado,
    0
  )::numeric(18, 2) AS valor_realizado,
  COALESCE(realizado.valor_pago, 0)::numeric(18, 2) AS valor_pago,
  COALESCE(realizado.valor_saldo, 0)::numeric(18, 2) AS valor_saldo,
  realizado.competencias_aethos,
  COALESCE(previsao.realizado_manual_legado, 0)::numeric(18, 2) AS realizado_manual_legado,
  (
    COALESCE(
      NULLIF(realizado.valor_realizado, 0),
      previsao.realizado_manual_legado,
      0
    )
    - COALESCE(previsao.valor_previsto, 0)
  )::numeric(18, 2) AS variacao_realizado_previsto,
  CASE
    WHEN COALESCE(previsao.valor_previsto, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(
        NULLIF(realizado.valor_realizado, 0),
        previsao.realizado_manual_legado,
        0
      )
      / NULLIF(previsao.valor_previsto, 0)
      * 100,
      2
    )
  END::numeric(18, 2) AS percentual_execucao,
  (COALESCE(previsao.valor_previsto, 0) <> 0) AS tem_previsao,
  (
    COALESCE(
      NULLIF(realizado.valor_realizado, 0),
      previsao.realizado_manual_legado,
      0
    ) <> 0
  ) AS tem_realizado,
  CASE
    WHEN grade.competencia_data > DATE_TRUNC('month', CURRENT_DATE)::date
      THEN 'Competência futura'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(
        NULLIF(realizado.valor_realizado, 0),
        previsao.realizado_manual_legado,
        0
      ) = 0
      THEN 'Sem previsão e sem realizado'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(
        NULLIF(realizado.valor_realizado, 0),
        previsao.realizado_manual_legado,
        0
      ) <> 0
      THEN 'Realizado sem previsão'
    WHEN COALESCE(
      NULLIF(realizado.valor_realizado, 0),
      previsao.realizado_manual_legado,
      0
    ) > COALESCE(previsao.valor_previsto, 0)
      THEN 'Acima do previsto'
    WHEN COALESCE(
      NULLIF(realizado.valor_realizado, 0),
      previsao.realizado_manual_legado,
      0
    ) = COALESCE(previsao.valor_previsto, 0)
      THEN 'No previsto'
    ELSE 'Abaixo do previsto'
  END AS situacao,
  COALESCE(realizado.qtd_lancamentos, 0)::integer AS qtd_lancamentos,
  COALESCE(realizado.qtd_lancamentos_com_nf, 0)::integer AS qtd_lancamentos_com_nf,
  COALESCE(realizado.qtd_notas_fiscais, 0)::integer AS qtd_notas_fiscais,
  realizado.primeiro_lancamento_em,
  realizado.ultimo_lancamento_em,
  realizado.ultimo_sync_aethos,
  previsao.previsao_atualizada_em,
  previsao.previsao_atualizada_por
FROM grade_competencias grade
LEFT JOIN realizado
  ON realizado."empresa_codigo" = grade."empresa_codigo"
 AND realizado."imposto" = grade."imposto"
 AND realizado.competencia = grade.competencia
LEFT JOIN previsao
  ON previsao.empresa_codigo = grade."empresa_codigo"
 AND previsao.imposto = grade."imposto"
 AND previsao.competencia = grade.competencia;

COMMENT ON TABLE "TaxForecastAudit" IS
  'Histórico imutável das inclusões e alterações manuais de previsão e realizado tributário.';

COMMENT ON VIEW "bi"."contabilidade_impostos" IS
  'Contrato BI preservado: valor_realizado usa Aethos quando diferente de zero e, caso contrário, o valor manual auditado.';
