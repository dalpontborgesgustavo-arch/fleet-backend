CREATE SCHEMA IF NOT EXISTS bi;

-- Centraliza a regra de dias uteis usada nas views do Power BI.
-- Quando existir um calendario corporativo de feriados, esta funcao sera o
-- unico ponto que precisara ser adaptado.
CREATE OR REPLACE FUNCTION bi.fn_dias_uteis(
  data_inicio date,
  data_fim date
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN data_inicio IS NULL OR data_fim IS NULL THEN NULL
    WHEN data_fim <= data_inicio THEN 0
    ELSE (
      SELECT COUNT(*)::integer
      FROM generate_series(
        data_inicio + 1,
        data_fim,
        interval '1 day'
      ) AS dia(valor)
      WHERE EXTRACT(ISODOW FROM dia.valor) BETWEEN 1 AND 5
    )
  END;
$$;

CREATE OR REPLACE VIEW bi.pbi_adm_dim_etapas_fluxo AS
SELECT
  catalogo.tipo_contrato_codigo,
  catalogo.tipo_contrato_nome,
  catalogo.fluxo_id,
  catalogo.fluxo_nome,
  catalogo.etapa_id,
  catalogo.etapa_chave,
  catalogo.etapa_ordem,
  catalogo.etapa_nome,
  catalogo.responsavel_padrao,
  catalogo.meta_dias,
  catalogo.meta_tipo,
  catalogo.meta_comparacao,
  catalogo.etapa_automatica,
  catalogo.etapa_obrigatoria,
  catalogo.etapa_final,
  TRUE AS etapa_ativa
FROM (
  VALUES
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:SOLICITACAO', 'SOLICITACAO', 1, 'Solicitacao do contrato', 'Solicitante (Gerente)', 0, 'IMEDIATO', 'MAX', TRUE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:CONFERENCIA_ADMINISTRATIVO', 'CONFERENCIA_ADMINISTRATIVO', 2, 'Conferencia da documentacao', 'Administrativo', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:ELABORACAO_JURIDICO', 'ELABORACAO_JURIDICO', 3, 'Elaboracao, validacao e envio para assinatura', 'Juridico', 3, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:ASSINATURA_FORNECEDOR', 'ASSINATURA_FORNECEDOR', 4, 'Validacao e assinatura do fornecedor', 'Fornecedor / Prestador', 2, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:APROVACAO_DIRETORA_ADMINISTRATIVA', 'APROVACAO_DIRETORA_ADMINISTRATIVA', 5, 'Conferencia, aprovacao e assinatura', 'Diretora Administrativa', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:DISPONIBILIZACAO_JURIDICO', 'DISPONIBILIZACAO_JURIDICO', 6, 'Disponibilizacao do contrato assinado', 'Juridico', NULL, 'SEM_META', NULL, FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:CONTRATO_LIBERADO', 'CONTRATO_LIBERADO', 7, 'Contrato liberado no Aethos', 'Processo concluido', NULL, 'AUTOMATICA', NULL, TRUE, TRUE, TRUE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:SOLICITACAO_ENGENHEIRO', 'SOLICITACAO_ENGENHEIRO', 1, 'Solicitacao do contrato', 'Engenheiro de Obras', 15, 'CORRIDO', 'MIN', TRUE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:CONFERENCIA_ADMINISTRATIVO', 'CONFERENCIA_ADMINISTRATIVO', 2, 'Conferencia das informacoes e documentacao', 'Administrativo', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:APROVACAO_DIRETOR_OPERACOES', 'APROVACAO_DIRETOR_OPERACOES', 3, 'Analise e aprovacao da solicitacao', 'Diretor de Operacoes', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:ENCAMINHAMENTO_JURIDICO', 'ENCAMINHAMENTO_JURIDICO', 4, 'Insercao da documentacao e envio ao Juridico', 'Administrativo', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:VALIDACAO_JURIDICO', 'VALIDACAO_JURIDICO', 5, 'Validacao, minuta e plataforma de assinaturas', 'Juridico', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:ASSINATURA_EMPREITEIRO', 'ASSINATURA_EMPREITEIRO', 6, 'Assinatura eletronica de todas as partes', 'Empreiteiro / Fornecedor', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:LIBERACAO_GERENTE_ADMINISTRATIVA', 'LIBERACAO_GERENTE_ADMINISTRATIVA', 7, 'Conferencia final, assinatura e liberacao', 'Gerente Administrativa', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:CONTRATO_LIBERADO', 'CONTRATO_LIBERADO', 8, 'Contrato liberado no Aethos', 'Processo concluido', NULL, 'AUTOMATICA', NULL, TRUE, TRUE, TRUE)
) AS catalogo(
  tipo_contrato_codigo,
  tipo_contrato_nome,
  fluxo_id,
  fluxo_nome,
  etapa_id,
  etapa_chave,
  etapa_ordem,
  etapa_nome,
  responsavel_padrao,
  meta_dias,
  meta_tipo,
  meta_comparacao,
  etapa_automatica,
  etapa_obrigatoria,
  etapa_final
);

CREATE OR REPLACE VIEW bi.pbi_adm_contratos_etapas AS
WITH contratos_classificados AS (
  SELECT
    contrato.id AS contrato_id,
    contrato."aethosId" AS contrato_aethos_id,
    contrato."registeredAt"::date AS data_cadastro,
    contrato."startDate"::date AS data_inicio_contrato,
    contrato."contractedAt"::date AS data_contratado,
    fluxo.id AS workflow_registro_id,
    fluxo.type AS workflow_tipo,
    fluxo.status AS workflow_status,
    fluxo."outcomeAt"::date AS workflow_desfecho_em
  FROM "AethosContract" contrato
  INNER JOIN "ContractWorkflow" fluxo ON fluxo."contractId" = contrato.id
  WHERE contrato.active = TRUE
    AND fluxo.type IN ('SERVICO', 'EMPREITEIRO')
), etapas_base AS (
  SELECT
    contrato.*,
    dimensao.tipo_contrato_codigo,
    dimensao.tipo_contrato_nome,
    dimensao.fluxo_id,
    dimensao.fluxo_nome,
    dimensao.etapa_id,
    dimensao.etapa_chave,
    dimensao.etapa_ordem,
    dimensao.etapa_nome,
    dimensao.responsavel_padrao AS responsavel_etapa,
    dimensao.meta_dias,
    dimensao.meta_tipo,
    dimensao.meta_comparacao,
    dimensao.etapa_automatica,
    dimensao.etapa_obrigatoria,
    dimensao.etapa_final,
    etapa.id AS etapa_registro_id,
    CASE
      WHEN dimensao.etapa_ordem = 1 THEN contrato.data_cadastro
      WHEN dimensao.etapa_final THEN COALESCE(contrato.data_contratado, etapa."completedAt"::date)
      ELSE etapa."completedAt"::date
    END AS data_etapa,
    etapa.notes AS observacao_etapa,
    etapa."updatedByName" AS ultimo_usuario_alteracao,
    etapa."updatedAt" AS ultima_alteracao_em
  FROM contratos_classificados contrato
  INNER JOIN bi.pbi_adm_dim_etapas_fluxo dimensao
    ON dimensao.tipo_contrato_codigo = CASE contrato.workflow_tipo
      WHEN 'SERVICO' THEN 'PRESTACAO_SERVICO'
      WHEN 'EMPREITEIRO' THEN 'EMPREITEIRO'
    END
  LEFT JOIN "ContractWorkflowStage" etapa
    ON etapa."workflowId" = contrato.workflow_registro_id
    AND etapa.key = dimensao.etapa_chave
), etapas_sequenciadas AS (
  SELECT
    base.*,
    MAX(base.data_etapa) FILTER (WHERE base.data_etapa IS NOT NULL)
      OVER (
        PARTITION BY base.contrato_id
        ORDER BY base.etapa_ordem
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS ultima_etapa_anterior_em,
    MIN(base.etapa_ordem) FILTER (WHERE base.data_etapa IS NULL)
      OVER (PARTITION BY base.contrato_id) AS primeira_etapa_pendente_ordem
  FROM etapas_base base
), intervalos AS (
  SELECT
    etapa.*,
    CASE
      WHEN etapa.etapa_ordem = 1 THEN etapa.data_etapa
      ELSE etapa.ultima_etapa_anterior_em
    END AS data_inicio_contagem,
    CASE
      WHEN etapa.tipo_contrato_codigo = 'EMPREITEIRO'
        AND etapa.etapa_ordem = 1
        THEN etapa.data_inicio_contrato
      WHEN etapa.data_etapa IS NOT NULL THEN etapa.data_etapa
      WHEN etapa.workflow_status = 'IN_PROGRESS'
        AND etapa.etapa_ordem = etapa.primeira_etapa_pendente_ordem
        AND etapa.ultima_etapa_anterior_em IS NOT NULL
        THEN CURRENT_DATE
      ELSE NULL
    END AS data_fim_contagem,
    (
      etapa.workflow_status = 'IN_PROGRESS'
      AND etapa.etapa_ordem = etapa.primeira_etapa_pendente_ordem
    ) AS fase_atual_contrato
  FROM etapas_sequenciadas etapa
), duracoes AS (
  SELECT
    intervalo.*,
    CASE
      WHEN intervalo.data_inicio_contagem IS NULL
        OR intervalo.data_fim_contagem IS NULL
        THEN NULL
      WHEN intervalo.tipo_contrato_codigo = 'EMPREITEIRO'
        AND intervalo.etapa_ordem = 1
        THEN GREATEST(0, intervalo.data_fim_contagem - intervalo.data_inicio_contagem)
      ELSE bi.fn_dias_uteis(
        intervalo.data_inicio_contagem,
        intervalo.data_fim_contagem
      )
    END AS dias_etapa
  FROM intervalos intervalo
), classificadas AS (
  SELECT
    duracao.*,
    CASE
      WHEN duracao.data_etapa IS NOT NULL THEN 'Concluida'
      WHEN duracao.workflow_status = 'CANCELLED' THEN 'Cancelada'
      WHEN duracao.workflow_status = 'COMPLETED' THEN 'Pulada'
      WHEN duracao.fase_atual_contrato THEN 'Em andamento'
      ELSE 'Nao iniciada'
    END AS status_etapa,
    CASE
      WHEN duracao.meta_dias IS NULL AND duracao.data_etapa IS NOT NULL
        THEN 'Concluida'
      WHEN duracao.meta_dias IS NULL THEN 'Sem meta'
      WHEN duracao.dias_etapa IS NULL THEN 'Pendente'
      WHEN duracao.meta_comparacao = 'MIN'
        AND duracao.dias_etapa >= duracao.meta_dias THEN 'No prazo'
      WHEN duracao.meta_comparacao = 'MIN' THEN 'Fora da meta'
      WHEN duracao.dias_etapa <= duracao.meta_dias THEN 'No prazo'
      ELSE 'Fora da meta'
    END AS status_meta_etapa,
    CASE
      WHEN duracao.meta_dias IS NULL OR duracao.dias_etapa IS NULL THEN NULL
      WHEN duracao.meta_comparacao = 'MIN'
        THEN GREATEST(duracao.meta_dias - duracao.dias_etapa, 0)
      ELSE GREATEST(duracao.dias_etapa - duracao.meta_dias, 0)
    END AS atraso_dias
  FROM duracoes duracao
)
SELECT
  contrato_id,
  contrato_aethos_id,
  tipo_contrato_codigo,
  tipo_contrato_nome,
  fluxo_id,
  fluxo_nome,
  etapa_id,
  etapa_chave,
  etapa_ordem,
  etapa_nome,
  responsavel_etapa,
  meta_dias,
  meta_tipo,
  etapa_automatica,
  etapa_obrigatoria,
  data_etapa,
  data_inicio_contagem,
  data_fim_contagem,
  dias_etapa,
  status_etapa,
  fase_atual_contrato,
  status_meta_etapa,
  atraso_dias,
  observacao_etapa,
  ultimo_usuario_alteracao,
  ultima_alteracao_em,
  workflow_registro_id,
  etapa_registro_id,
  workflow_status,
  meta_comparacao,
  etapa_final
FROM classificadas;

CREATE OR REPLACE VIEW bi.pbi_adm_contratos AS
WITH resumo_etapas AS (
  SELECT
    etapa.contrato_id,
    MAX(etapa.tipo_contrato_codigo) AS tipo_contrato_codigo,
    MAX(etapa.tipo_contrato_nome) AS tipo_contrato_nome,
    MAX(etapa.fluxo_id) AS fluxo_id,
    MAX(etapa.fluxo_nome) AS fluxo_nome,
    COUNT(*) FILTER (WHERE etapa.data_etapa IS NOT NULL)::integer AS etapas_preenchidas,
    COUNT(*)::integer AS total_etapas,
    MAX(etapa.etapa_ordem) FILTER (WHERE etapa.fase_atual_contrato) AS etapa_atual_ordem,
    MAX(etapa.etapa_nome) FILTER (WHERE etapa.fase_atual_contrato) AS etapa_atual_nome,
    MAX(etapa.responsavel_etapa) FILTER (WHERE etapa.fase_atual_contrato) AS responsavel_atual,
    MAX(etapa.data_inicio_contagem) FILTER (WHERE etapa.fase_atual_contrato) AS data_inicio_etapa_atual,
    MAX(etapa.dias_etapa) FILTER (WHERE etapa.fase_atual_contrato) AS dias_etapa_atual,
    MAX(etapa.meta_dias) FILTER (WHERE etapa.fase_atual_contrato) AS meta_etapa_atual,
    MAX(etapa.status_meta_etapa) FILTER (WHERE etapa.fase_atual_contrato) AS status_meta_etapa_atual,
    MAX(etapa.atraso_dias) FILTER (WHERE etapa.fase_atual_contrato) AS atraso_etapa_atual,
    COUNT(*) FILTER (
      WHERE etapa.status_meta_etapa IN ('No prazo', 'Fora da meta')
    )::integer AS etapas_com_meta_avaliadas,
    COUNT(*) FILTER (
      WHERE etapa.status_meta_etapa = 'Fora da meta'
    )::integer AS etapas_fora_meta,
    COALESCE(SUM(etapa.atraso_dias), 0)::integer AS atraso_total_etapas
  FROM bi.pbi_adm_contratos_etapas etapa
  GROUP BY etapa.contrato_id
), contratos_base AS (
  SELECT
    contrato.*,
    fluxo.id AS workflow_registro_id,
    fluxo.type AS workflow_tipo,
    fluxo.status AS workflow_status_codigo,
    fluxo."outcomeAt"::date AS workflow_desfecho_em,
    fluxo."updatedAt" AS workflow_atualizado_em,
    resumo.tipo_contrato_codigo,
    resumo.tipo_contrato_nome,
    resumo.fluxo_id,
    resumo.fluxo_nome,
    resumo.etapas_preenchidas,
    resumo.total_etapas,
    resumo.etapa_atual_ordem,
    resumo.etapa_atual_nome,
    resumo.responsavel_atual,
    resumo.data_inicio_etapa_atual,
    resumo.dias_etapa_atual,
    resumo.meta_etapa_atual,
    resumo.status_meta_etapa_atual,
    resumo.atraso_etapa_atual,
    resumo.etapas_com_meta_avaliadas,
    resumo.etapas_fora_meta,
    resumo.atraso_total_etapas
  FROM "AethosContract" contrato
  LEFT JOIN "ContractWorkflow" fluxo ON fluxo."contractId" = contrato.id
  LEFT JOIN resumo_etapas resumo ON resumo.contrato_id = contrato.id
  WHERE contrato.active = TRUE
), contratos_calculados AS (
  SELECT
    base.*,
    CASE
      WHEN base.workflow_tipo IN ('SERVICO', 'EMPREITEIRO') THEN
        COALESCE(
          base.workflow_desfecho_em,
          base."contractedAt"::date,
          CASE
            WHEN base.workflow_status_codigo IN ('COMPLETED', 'CANCELLED')
              THEN COALESCE(base."finalizedAt"::date, base."endDate"::date)
            ELSE CURRENT_DATE
          END
        )
      ELSE NULL
    END AS data_fim_lead_time,
    CASE base.workflow_tipo
      WHEN 'SERVICO' THEN 7
      WHEN 'EMPREITEIRO' THEN 6
      ELSE NULL
    END AS meta_total_fluxo_dias
  FROM contratos_base base
), contratos_com_lead_time AS (
  SELECT
    calculado.*,
    CASE
      WHEN calculado.data_fim_lead_time IS NULL THEN NULL
      ELSE bi.fn_dias_uteis(
        calculado."registeredAt"::date,
        calculado.data_fim_lead_time
      )
    END AS lead_time_total_dias
  FROM contratos_calculados calculado
)
SELECT
  contrato.id AS contrato_id,
  contrato."aethosId" AS contrato_aethos_id,
  contrato."aethosId" AS contrato_codigo,
  contrato."companyAethosId" AS empresa_id,
  CASE contrato."companyAethosId"
    WHEN '1' THEN 'JR Construcoes'
    WHEN '4' THEN 'Pedraforte'
    ELSE 'Empresa ' || contrato."companyAethosId"
  END AS empresa_nome,
  contrato."workAethosId" AS obra_id,
  contrato."workName" AS obra_nome,
  contrato."contractorAethosId" AS contratado_id,
  contrato."contractorName" AS contratado_nome,
  contrato."engineerAethosId" AS engenheiro_id,
  contrato."engineerName" AS engenheiro_nome,
  contrato."accountPlanAethosId" AS plano_contas_id,
  contrato."accountPlanName" AS plano_contas_descricao,
  COALESCE(contrato.tipo_contrato_codigo, 'SEM_CLASSIFICACAO') AS tipo_contrato_codigo,
  COALESCE(contrato.tipo_contrato_nome, 'Sem classificacao') AS tipo_contrato_nome,
  contrato.fluxo_id,
  contrato.fluxo_nome,
  CASE contrato.workflow_status_codigo
    WHEN 'IN_PROGRESS' THEN 'Em andamento'
    WHEN 'COMPLETED' THEN 'Concluido'
    WHEN 'CANCELLED' THEN 'Cancelado'
    ELSE 'Sem classificacao'
  END AS fluxo_status,
  contrato."statusCode" AS status_contrato_codigo,
  contrato."statusDescription" AS status_contrato_descricao,
  contrato."originalValue" AS valor_original,
  COALESCE(contrato."totalMeasuredValue", 0) AS valor_medido,
  COALESCE(contrato."contractBalance", 0) AS saldo_contratual,
  COALESCE(contrato."payableBalance", 0) AS saldo_a_pagar,
  contrato."registeredAt"::date AS data_cadastro,
  contrato."startDate"::date AS data_inicio,
  contrato."endDate"::date AS data_conclusao,
  contrato."finalizedAt"::date AS data_finalizacao,
  contrato."contractedAt"::date AS data_contratado,
  contrato.etapa_atual_ordem,
  contrato.etapa_atual_nome,
  contrato.responsavel_atual,
  contrato.data_inicio_etapa_atual,
  contrato.dias_etapa_atual,
  contrato.meta_etapa_atual,
  contrato.status_meta_etapa_atual,
  contrato.atraso_etapa_atual,
  contrato.lead_time_total_dias,
  contrato.meta_total_fluxo_dias,
  CASE
    WHEN contrato.meta_total_fluxo_dias IS NULL THEN 'Sem meta total'
    WHEN COALESCE(contrato.etapas_com_meta_avaliadas, 0) = 0 THEN 'Pendente'
    WHEN COALESCE(contrato.etapas_fora_meta, 0) = 0 THEN 'No prazo'
    ELSE 'Fora da meta'
  END AS status_meta_total,
  CASE
    WHEN contrato.meta_total_fluxo_dias IS NULL THEN NULL
    ELSE contrato.atraso_total_etapas
  END AS atraso_total_dias,
  COALESCE(contrato.etapas_preenchidas, 0)::integer AS etapas_preenchidas,
  COALESCE(contrato.total_etapas, 0)::integer AS total_etapas,
  CASE
    WHEN COALESCE(contrato.total_etapas, 0) = 0 THEN 0
    ELSE ROUND(
      contrato.etapas_preenchidas::numeric
      / contrato.total_etapas::numeric
      * 100
    )::integer
  END AS percentual_fluxo,
  contrato."syncedAt" AS ultima_sincronizacao_em,
  contrato.workflow_atualizado_em,
  contrato.workflow_registro_id,
  contrato.workflow_status_codigo,
  contrato."lastContractedAt"::date AS data_ultima_contratacao,
  contrato."contractedByUser" AS usuario_contratacao,
  contrato."retentionValue" AS valor_retencao,
  contrato."retentionBalance" AS saldo_retencao,
  contrato."measurementBalance" AS saldo_medicao
FROM contratos_com_lead_time contrato;

CREATE OR REPLACE VIEW bi.pbi_adm_resumo_etapas AS
SELECT
  etapa.tipo_contrato_codigo,
  etapa.tipo_contrato_nome,
  etapa.fluxo_id,
  etapa.fluxo_nome,
  etapa.etapa_id,
  etapa.etapa_ordem,
  etapa.etapa_nome,
  etapa.responsavel_etapa,
  etapa.meta_dias,
  etapa.meta_tipo,
  COUNT(DISTINCT etapa.contrato_id)::integer AS contratos_qtd,
  COUNT(DISTINCT etapa.contrato_id) FILTER (
    WHERE etapa.status_etapa = 'Concluida'
  )::integer AS contratos_concluidos_qtd,
  COUNT(DISTINCT etapa.contrato_id) FILTER (
    WHERE etapa.status_etapa = 'Em andamento'
  )::integer AS contratos_em_andamento_qtd,
  ROUND(AVG(etapa.dias_etapa)::numeric, 2) AS tempo_medio_etapa_dias,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY etapa.dias_etapa)::numeric,
    2
  ) AS mediana_etapa_dias,
  MIN(etapa.dias_etapa) AS menor_tempo_etapa_dias,
  MAX(etapa.dias_etapa) AS maior_tempo_etapa_dias,
  COUNT(DISTINCT etapa.contrato_id) FILTER (
    WHERE etapa.status_meta_etapa = 'No prazo'
  )::integer AS contratos_no_prazo_qtd,
  COUNT(DISTINCT etapa.contrato_id) FILTER (
    WHERE etapa.status_meta_etapa = 'Fora da meta'
  )::integer AS contratos_fora_meta_qtd,
  ROUND(
    100.0 * COUNT(DISTINCT etapa.contrato_id) FILTER (
      WHERE etapa.status_meta_etapa = 'No prazo'
    )
    / NULLIF(
      COUNT(DISTINCT etapa.contrato_id) FILTER (
        WHERE etapa.status_meta_etapa IN ('No prazo', 'Fora da meta')
      ),
      0
    ),
    2
  ) AS percentual_no_prazo,
  CASE
    WHEN etapa.meta_dias IS NULL THEN 'Sem meta'
    WHEN AVG(etapa.dias_etapa) IS NULL THEN 'Sem dados'
    WHEN MAX(etapa.meta_comparacao) = 'MIN'
      AND AVG(etapa.dias_etapa) >= etapa.meta_dias THEN 'No prazo'
    WHEN MAX(etapa.meta_comparacao) = 'MIN' THEN 'Fora da meta'
    WHEN AVG(etapa.dias_etapa) <= etapa.meta_dias THEN 'No prazo'
    ELSE 'Fora da meta'
  END AS status_media_meta
FROM bi.pbi_adm_contratos_etapas etapa
GROUP BY
  etapa.tipo_contrato_codigo,
  etapa.tipo_contrato_nome,
  etapa.fluxo_id,
  etapa.fluxo_nome,
  etapa.etapa_id,
  etapa.etapa_ordem,
  etapa.etapa_nome,
  etapa.responsavel_etapa,
  etapa.meta_dias,
  etapa.meta_tipo;

CREATE OR REPLACE VIEW bi.pbi_adm_resumo_mensal AS
SELECT
  DATE_TRUNC('month', contrato.data_cadastro)::date AS mes_referencia,
  contrato.empresa_id,
  contrato.empresa_nome,
  contrato.tipo_contrato_codigo,
  contrato.tipo_contrato_nome,
  contrato.status_contrato_codigo,
  contrato.status_contrato_descricao,
  contrato.fluxo_status,
  COUNT(*)::integer AS contratos_qtd,
  COUNT(*) FILTER (
    WHERE contrato.tipo_contrato_codigo <> 'SEM_CLASSIFICACAO'
  )::integer AS contratos_classificados_qtd,
  COUNT(*) FILTER (
    WHERE contrato.tipo_contrato_codigo = 'SEM_CLASSIFICACAO'
  )::integer AS contratos_sem_classificacao_qtd,
  COUNT(*) FILTER (
    WHERE COALESCE(contrato.atraso_etapa_atual, 0) > 0
      OR COALESCE(contrato.atraso_total_dias, 0) > 0
  )::integer AS contratos_em_atraso_qtd,
  COUNT(*) FILTER (
    WHERE contrato.fluxo_status = 'Concluido'
  )::integer AS contratos_concluidos_qtd,
  SUM(contrato.valor_original) AS valor_original_total,
  SUM(contrato.valor_medido) AS valor_medido_total,
  SUM(contrato.saldo_contratual) AS saldo_contratual_total,
  ROUND(AVG(contrato.lead_time_total_dias)::numeric, 2) AS lead_time_medio_dias,
  ROUND(AVG(contrato.atraso_total_dias)::numeric, 2) AS atraso_medio_dias
FROM bi.pbi_adm_contratos contrato
GROUP BY
  DATE_TRUNC('month', contrato.data_cadastro)::date,
  contrato.empresa_id,
  contrato.empresa_nome,
  contrato.tipo_contrato_codigo,
  contrato.tipo_contrato_nome,
  contrato.status_contrato_codigo,
  contrato.status_contrato_descricao,
  contrato.fluxo_status;

COMMENT ON FUNCTION bi.fn_dias_uteis(date, date) IS
  'Conta dias de segunda a sexta entre duas datas, excluindo o dia inicial. Ponto unico para futura inclusao de feriados.';
COMMENT ON VIEW bi.pbi_adm_dim_etapas_fluxo IS
  'Catalogo oficial dos fluxos e etapas de contratos, sem inferencia por plano de contas.';
COMMENT ON VIEW bi.pbi_adm_contratos_etapas IS
  'Uma linha por contrato manualmente classificado e por etapa aplicavel, com datas, prazos e desempenho calculados no PostgreSQL.';
COMMENT ON VIEW bi.pbi_adm_contratos IS
  'Uma linha por contrato ativo. Contratos sem classificacao permanecem como SEM_CLASSIFICACAO e nao recebem fluxo inferido.';
COMMENT ON VIEW bi.pbi_adm_resumo_etapas IS
  'Resumo agregado por etapa e fluxo para indicadores de tempo e cumprimento de meta.';
COMMENT ON VIEW bi.pbi_adm_resumo_mensal IS
  'Resumo mensal dos contratos por empresa, classificacao manual, status do contrato e situacao do fluxo.';

GRANT USAGE ON SCHEMA bi TO powerbi_reader;
GRANT EXECUTE ON FUNCTION bi.fn_dias_uteis(date, date) TO powerbi_reader;
GRANT SELECT ON bi.pbi_adm_dim_etapas_fluxo TO powerbi_reader;
GRANT SELECT ON bi.pbi_adm_contratos_etapas TO powerbi_reader;
GRANT SELECT ON bi.pbi_adm_contratos TO powerbi_reader;
GRANT SELECT ON bi.pbi_adm_resumo_etapas TO powerbi_reader;
GRANT SELECT ON bi.pbi_adm_resumo_mensal TO powerbi_reader;
