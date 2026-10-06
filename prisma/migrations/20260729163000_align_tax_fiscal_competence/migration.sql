BEGIN;

CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."contabilidade_impostos_resumo_anual";
DROP VIEW IF EXISTS "bi"."contabilidade_impostos_resumo_mensal";
DROP VIEW IF EXISTS "bi"."contabilidade_impostos_lancamentos";
DROP VIEW IF EXISTS "bi"."contabilidade_impostos";
DROP VIEW IF EXISTS "bi"."contabilidade_impostos_configuracao";

CREATE VIEW "bi"."contabilidade_impostos_configuracao" AS
SELECT
  configuracao.empresa_codigo::text AS "empresa_codigo",
  configuracao.empresa_nome::text AS "empresa_nome",
  configuracao.empresa_ordem::integer AS "empresa_ordem",
  configuracao.imposto::text AS "imposto",
  configuracao.imposto_ordem::integer AS "imposto_ordem",
  configuracao.aethos_empresa_codigo::text AS "aethos_empresa_codigo",
  configuracao.aethos_plano_conta_codigo::text AS "aethos_plano_conta_codigo",
  configuracao.aethos_plano_conta_nome::text AS "aethos_plano_conta_nome",
  configuracao.deslocamento_competencia_meses::integer AS "deslocamento_competencia_meses",
  'COMPETENCIA_FISCAL_DERIVADA_VALOR_CUSTO'::text AS "base_realizado"
FROM (
  VALUES
    ('JR_CONSTRUCOES', 'JR Construções', 1, 'PIS', 1, '1', '153', 'IMPOSTOS - PIS', 1),
    ('JR_CONSTRUCOES', 'JR Construções', 1, 'COFINS', 2, '1', '152', 'IMPOSTOS - COFINS', 1),
    ('JR_CONSTRUCOES', 'JR Construções', 1, 'IRPJ', 3, '1', '145', 'IMPOSTOS - IRPJ', 0),
    ('JR_CONSTRUCOES', 'JR Construções', 1, 'CSLL', 4, '1', '151', 'IMPOSTO CSLL CONTR.SOCIAL', 0),
    ('JR_GESTAO', 'JR Gestão', 2, 'PIS', 1, '1', '1132', 'PRUMARE IMPOSTO PIS', 1),
    ('JR_GESTAO', 'JR Gestão', 2, 'COFINS', 2, '1', '1133', 'PRUMARE IMPOSTO COFINS', 1),
    ('JR_GESTAO', 'JR Gestão', 2, 'IRPJ', 3, '1', '1136', 'PRUMARE IMPOSTO IRPJ', 0),
    ('JR_GESTAO', 'JR Gestão', 2, 'CSLL', 4, '1', '1134', 'PRUMARE IMPOSTO CSLL', 0),
    ('PEDRAFORTE', 'Pedraforte', 3, 'PIS', 1, '4', '1074', 'PEDRAFORTE IMPOSTO PIS', 1),
    ('PEDRAFORTE', 'Pedraforte', 3, 'COFINS', 2, '4', '1075', 'PEDRAFORTE IMPOSTO COFINS', 1),
    ('PEDRAFORTE', 'Pedraforte', 3, 'IRPJ', 3, '4', '1076', 'PEDRAFORTE IMPOSTO IRPJ', 0),
    ('PEDRAFORTE', 'Pedraforte', 3, 'CSLL', 4, '4', '1077', 'PEDRAFORTE IMPOSTO CSLL', 0)
) AS configuracao(
  empresa_codigo,
  empresa_nome,
  empresa_ordem,
  imposto,
  imposto_ordem,
  aethos_empresa_codigo,
  aethos_plano_conta_codigo,
  aethos_plano_conta_nome,
  deslocamento_competencia_meses
);

CREATE VIEW "bi"."contabilidade_impostos" AS
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
  COALESCE(realizado.valor_realizado, 0)::numeric(18, 2) AS valor_realizado,
  COALESCE(realizado.valor_pago, 0)::numeric(18, 2) AS valor_pago,
  COALESCE(realizado.valor_saldo, 0)::numeric(18, 2) AS valor_saldo,
  realizado.competencias_aethos,
  COALESCE(previsao.realizado_manual_legado, 0)::numeric(18, 2) AS realizado_manual_legado,
  (
    COALESCE(realizado.valor_realizado, 0)
    - COALESCE(previsao.valor_previsto, 0)
  )::numeric(18, 2) AS variacao_realizado_previsto,
  CASE
    WHEN COALESCE(previsao.valor_previsto, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(realizado.valor_realizado, 0)
      / NULLIF(previsao.valor_previsto, 0)
      * 100,
      2
    )
  END::numeric(18, 2) AS percentual_execucao,
  (COALESCE(previsao.valor_previsto, 0) <> 0) AS tem_previsao,
  (COALESCE(realizado.valor_realizado, 0) <> 0) AS tem_realizado,
  CASE
    WHEN grade.competencia_data > DATE_TRUNC('month', CURRENT_DATE)::date
      THEN 'Competência futura'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(realizado.valor_realizado, 0) = 0
      THEN 'Sem previsão e sem realizado'
    WHEN COALESCE(previsao.valor_previsto, 0) = 0
      AND COALESCE(realizado.valor_realizado, 0) <> 0
      THEN 'Realizado sem previsão'
    WHEN COALESCE(realizado.valor_realizado, 0) > COALESCE(previsao.valor_previsto, 0)
      THEN 'Acima do previsto'
    WHEN COALESCE(realizado.valor_realizado, 0) = COALESCE(previsao.valor_previsto, 0)
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

CREATE VIEW "bi"."contabilidade_impostos_lancamentos" AS
SELECT
  custo."id",
  custo."matchKey" AS chave_integracao,
  configuracao."empresa_codigo",
  configuracao."empresa_nome",
  configuracao."empresa_ordem",
  configuracao."imposto",
  configuracao."imposto_ordem",
  configuracao."aethos_empresa_codigo",
  configuracao."aethos_plano_conta_codigo",
  COALESCE(custo."nomePlanoConta", configuracao."aethos_plano_conta_nome") AS aethos_plano_conta_nome,
  configuracao."deslocamento_competencia_meses",
  TO_CHAR(
    TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
    - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses"),
    'YYYY-MM'
  ) AS competencia,
  TO_CHAR(
    TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
    - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses"),
    'YYYY-MM'
  ) AS competencia_fiscal,
  custo."competencia" AS competencia_aethos,
  CASE
    WHEN custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$'
      THEN TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
        - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses")
    ELSE NULL
  END AS competencia_data,
  CASE
    WHEN custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$'
      THEN EXTRACT(
        YEAR FROM (
          TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
          - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses")
        )
      )::integer
    ELSE NULL
  END AS ano,
  CASE
    WHEN custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$'
      THEN EXTRACT(
        MONTH FROM (
          TO_DATE(custo."competencia" || '-01', 'YYYY-MM-DD')
          - MAKE_INTERVAL(months => configuracao."deslocamento_competencia_meses")
        )
      )::integer
    ELSE NULL
  END AS mes,
  custo."idLancamento" AS id_lancamento,
  custo."origem",
  custo."dataBaseLancamento" AS data_base_lancamento,
  custo."dataLancamento" AS data_lancamento,
  custo."dataVencimento" AS data_vencimento,
  custo."temNotaFiscal" AS tem_nota_fiscal,
  custo."idNotaFiscal" AS id_nota_fiscal,
  custo."numeroNotaFiscal" AS numero_nota_fiscal,
  custo."dataEmissaoNotaFiscal" AS data_emissao_nota_fiscal,
  custo."observacaoLancamento" AS observacao_lancamento,
  custo."observacaoNotaFiscal" AS observacao_nota_fiscal,
  custo."valorCusto"::numeric(18, 2) AS valor_realizado,
  COALESCE(custo."valorPago", 0)::numeric(18, 2) AS valor_pago,
  COALESCE(custo."valorSaldo", 0)::numeric(18, 2) AS valor_saldo,
  custo."status",
  custo."statusDescricao" AS status_descricao,
  custo."tipoDocumento" AS tipo_documento,
  custo."tipoDocumentoDescricao" AS tipo_documento_descricao,
  custo."syncedAt" AS sincronizado_em,
  custo."createdAt" AS criado_em,
  custo."updatedAt" AS atualizado_em
FROM "bi"."contabilidade_impostos_configuracao" configuracao
INNER JOIN "AethosPlanoContaCost" custo
  ON custo."codigoEmpresa" = configuracao."aethos_empresa_codigo"
 AND custo."codigoPlanoConta" = configuracao."aethos_plano_conta_codigo"
WHERE custo."active" = true
  AND custo."competencia" ~ '^[0-9]{4}-[0-9]{2}$';

CREATE VIEW "bi"."contabilidade_impostos_resumo_mensal" AS
SELECT
  impostos."empresa_codigo",
  impostos."empresa_nome",
  impostos."empresa_ordem",
  impostos.competencia,
  impostos.competencia_data,
  impostos.ano,
  impostos.mes,
  impostos.ano_mes,
  impostos.mes_nome,
  SUM(impostos.valor_previsto)::numeric(18, 2) AS valor_previsto,
  SUM(impostos.valor_realizado)::numeric(18, 2) AS valor_realizado,
  SUM(impostos.valor_pago)::numeric(18, 2) AS valor_pago,
  SUM(impostos.valor_saldo)::numeric(18, 2) AS valor_saldo,
  STRING_AGG(
    DISTINCT NULLIF(impostos.competencias_aethos, ''),
    ', '
  ) AS competencias_aethos,
  SUM(impostos.variacao_realizado_previsto)::numeric(18, 2) AS variacao_realizado_previsto,
  CASE
    WHEN SUM(impostos.valor_previsto) = 0 THEN NULL
    ELSE ROUND(
      SUM(impostos.valor_realizado)
      / NULLIF(SUM(impostos.valor_previsto), 0)
      * 100,
      2
    )
  END::numeric(18, 2) AS percentual_execucao,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'PIS')::numeric(18, 2) AS pis_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'PIS')::numeric(18, 2) AS pis_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'COFINS')::numeric(18, 2) AS cofins_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'COFINS')::numeric(18, 2) AS cofins_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'IRPJ')::numeric(18, 2) AS irpj_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'IRPJ')::numeric(18, 2) AS irpj_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'CSLL')::numeric(18, 2) AS csll_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'CSLL')::numeric(18, 2) AS csll_realizado,
  SUM(impostos.qtd_lancamentos)::integer AS qtd_lancamentos,
  SUM(impostos.qtd_notas_fiscais)::integer AS qtd_notas_fiscais,
  MAX(impostos.ultimo_sync_aethos) AS ultimo_sync_aethos,
  COUNT(*) FILTER (WHERE impostos.tem_previsao)::integer AS impostos_com_previsao,
  COUNT(*) FILTER (WHERE impostos.tem_realizado)::integer AS impostos_com_realizado
FROM "bi"."contabilidade_impostos" impostos
GROUP BY
  impostos."empresa_codigo",
  impostos."empresa_nome",
  impostos."empresa_ordem",
  impostos.competencia,
  impostos.competencia_data,
  impostos.ano,
  impostos.mes,
  impostos.ano_mes,
  impostos.mes_nome;

CREATE VIEW "bi"."contabilidade_impostos_resumo_anual" AS
SELECT
  impostos."empresa_codigo",
  impostos."empresa_nome",
  impostos."empresa_ordem",
  impostos.ano,
  SUM(impostos.valor_previsto)::numeric(18, 2) AS valor_previsto,
  SUM(impostos.valor_realizado)::numeric(18, 2) AS valor_realizado,
  SUM(impostos.valor_pago)::numeric(18, 2) AS valor_pago,
  SUM(impostos.valor_saldo)::numeric(18, 2) AS valor_saldo,
  SUM(impostos.variacao_realizado_previsto)::numeric(18, 2) AS variacao_realizado_previsto,
  CASE
    WHEN SUM(impostos.valor_previsto) = 0 THEN NULL
    ELSE ROUND(
      SUM(impostos.valor_realizado)
      / NULLIF(SUM(impostos.valor_previsto), 0)
      * 100,
      2
    )
  END::numeric(18, 2) AS percentual_execucao,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'PIS')::numeric(18, 2) AS pis_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'PIS')::numeric(18, 2) AS pis_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'COFINS')::numeric(18, 2) AS cofins_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'COFINS')::numeric(18, 2) AS cofins_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'IRPJ')::numeric(18, 2) AS irpj_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'IRPJ')::numeric(18, 2) AS irpj_realizado,
  SUM(impostos.valor_previsto) FILTER (WHERE impostos.imposto = 'CSLL')::numeric(18, 2) AS csll_previsto,
  SUM(impostos.valor_realizado) FILTER (WHERE impostos.imposto = 'CSLL')::numeric(18, 2) AS csll_realizado,
  SUM(impostos.qtd_lancamentos)::integer AS qtd_lancamentos,
  SUM(impostos.qtd_notas_fiscais)::integer AS qtd_notas_fiscais,
  MAX(impostos.ultimo_sync_aethos) AS ultimo_sync_aethos
FROM "bi"."contabilidade_impostos" impostos
GROUP BY
  impostos."empresa_codigo",
  impostos."empresa_nome",
  impostos."empresa_ordem",
  impostos.ano;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos_configuracao" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos_lancamentos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos_resumo_mensal" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contabilidade_impostos_resumo_anual" TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END
$$;

COMMIT;
