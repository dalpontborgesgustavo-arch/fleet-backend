-- Datas oficiais do mesmo ciclo. Sem backfill a partir de cadastro/sincronizacao.
ALTER TABLE "AethosContract"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvalCycleContractedAt" TIMESTAMP(3),
  ADD COLUMN "approvalCycleSourceId" TEXT,
  ADD COLUMN "approvalCycleHistoryComplete" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX "AethosContract_approvedAt_idx" ON "AethosContract"("approvedAt");

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
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:SOLICITACAO', 'SOLICITACAO', 1, 'Entrada em aprovacao', 'Solicitante (Gerente)', 0, 'IMEDIATO', 'MAX', TRUE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:CONFERENCIA_ADMINISTRATIVO', 'CONFERENCIA_ADMINISTRATIVO', 2, 'Conferencia da documentacao', 'Administrativo', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:ELABORACAO_JURIDICO', 'ELABORACAO_JURIDICO', 3, 'Elaboracao, validacao e envio para assinatura', 'Juridico', 3, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:ASSINATURA_FORNECEDOR', 'ASSINATURA_FORNECEDOR', 4, 'Validacao e assinatura do fornecedor', 'Fornecedor / Prestador', 2, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:APROVACAO_DIRETORA_ADMINISTRATIVA', 'APROVACAO_DIRETORA_ADMINISTRATIVA', 5, 'Conferencia, aprovacao e assinatura', 'Diretora Administrativa', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:DISPONIBILIZACAO_JURIDICO', 'DISPONIBILIZACAO_JURIDICO', 6, 'Disponibilizacao do contrato assinado', 'Juridico', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:CONTRATO_LIBERADO', 'CONTRATO_LIBERADO', 7, 'Contrato liberado no Aethos', 'Processo concluido', NULL, 'AUTOMATICA', NULL, TRUE, TRUE, TRUE),
    ('EMPREITEIRO', 'Empreiteiro', 'EMPREITEIRO_8_ETAPAS', 'Fluxo de empreiteiro', 'EMPREITEIRO:SOLICITACAO_ENGENHEIRO', 'SOLICITACAO_ENGENHEIRO', 1, 'Entrada em aprovacao', 'Engenheiro de Obras', 0, 'IMEDIATO', 'MAX', TRUE, TRUE, FALSE),
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

GRANT SELECT ON bi.pbi_adm_dim_etapas_fluxo TO powerbi_reader;

CREATE OR REPLACE VIEW bi.pbi_adm_contratos_etapas AS
WITH contratos_classificados AS (
 SELECT c.id AS contrato_id, c."aethosId" AS contrato_aethos_id,
 c."statusCode" AS status_contrato_codigo,
 CASE WHEN c."approvalCycleHistoryComplete" THEN c."approvedAt"::date END AS data_entrada_aprovacao,
 CASE WHEN c."approvalCycleHistoryComplete" AND c."statusCode" IN ('O','F')
   AND c."approvalCycleContractedAt" >= c."approvedAt"
   THEN c."approvalCycleContractedAt"::date END AS data_contratacao_ciclo,
 c."approvalCycleSourceId" AS ciclo_aprovacao_id,
 c."approvalCycleHistoryComplete" AS historico_ciclo_completo,
 f.id AS workflow_registro_id, f.type AS workflow_tipo,
 CASE WHEN c."statusCode" IN ('O','F') THEN 'COMPLETED' ELSE 'IN_PROGRESS' END AS workflow_status
 FROM "AethosContract" c JOIN "ContractWorkflow" f ON f."contractId"=c.id
 WHERE c.active=TRUE AND c."statusCode" IN ('P','O','F') AND f.type IN ('SERVICO','EMPREITEIRO')
), etapas_base AS (
 SELECT c.*, d.tipo_contrato_codigo,d.tipo_contrato_nome,d.fluxo_id,d.fluxo_nome,
 d.etapa_id,d.etapa_chave,d.etapa_ordem,d.etapa_nome,d.responsavel_padrao AS responsavel_etapa,
 d.meta_dias,d.meta_tipo,d.meta_comparacao,d.etapa_automatica,d.etapa_obrigatoria,d.etapa_final,
 s.id AS etapa_registro_id,
 CASE WHEN d.etapa_ordem=1 THEN c.data_entrada_aprovacao
 WHEN d.etapa_final THEN c.data_contratacao_ciclo
 WHEN s."completedAt"::date >= c.data_entrada_aprovacao
  AND (c.data_contratacao_ciclo IS NULL OR s."completedAt"::date <= c.data_contratacao_ciclo)
 THEN s."completedAt"::date END AS data_etapa,
 s.notes AS observacao_etapa,s."updatedByName" AS ultimo_usuario_alteracao,s."updatedAt" AS ultima_alteracao_em
 FROM contratos_classificados c JOIN bi.pbi_adm_dim_etapas_fluxo d
 ON d.tipo_contrato_codigo=CASE c.workflow_tipo WHEN 'SERVICO' THEN 'PRESTACAO_SERVICO' ELSE 'EMPREITEIRO' END
 LEFT JOIN "ContractWorkflowStage" s ON s."workflowId"=c.workflow_registro_id AND s.key=d.etapa_chave
), etapas_sequenciadas AS (
 SELECT b.*,
 LAG(b.data_etapa) OVER(PARTITION BY b.contrato_id ORDER BY b.etapa_ordem) AS etapa_anterior_em,
 MIN(b.etapa_ordem) FILTER(WHERE b.data_etapa IS NULL) OVER(PARTITION BY b.contrato_id) AS primeira_pendente
 FROM etapas_base b
), intervalos AS (
 SELECT e.*,
 CASE WHEN e.etapa_ordem=1 THEN e.data_etapa ELSE e.etapa_anterior_em END AS data_inicio_contagem,
 CASE WHEN e.data_etapa IS NOT NULL THEN e.data_etapa
 WHEN e.status_contrato_codigo='P' AND e.etapa_ordem=e.primeira_pendente
 AND e.data_entrada_aprovacao IS NOT NULL AND e.etapa_anterior_em IS NOT NULL THEN CURRENT_DATE END AS data_fim_contagem,
 (e.status_contrato_codigo='P' AND e.data_entrada_aprovacao IS NOT NULL
  AND e.etapa_ordem=e.primeira_pendente) AS fase_atual_contrato
 FROM etapas_sequenciadas e
), duracoes AS (
 SELECT i.*,
 CASE WHEN i.data_fim_contagem >= i.data_inicio_contagem
 THEN bi.fn_dias_uteis(i.data_inicio_contagem,i.data_fim_contagem) END AS dias_etapa
 FROM intervalos i
), classificadas AS (
 SELECT d.*,
 CASE WHEN d.data_etapa IS NOT NULL THEN 'Concluida'
 WHEN d.workflow_status='COMPLETED' THEN 'Pendente de preenchimento'
 WHEN d.fase_atual_contrato THEN 'Em andamento' ELSE 'Nao iniciada' END AS status_etapa,
 CASE WHEN d.meta_dias IS NULL AND d.data_etapa IS NOT NULL THEN 'Concluida'
 WHEN d.meta_dias IS NULL THEN 'Sem meta' WHEN d.dias_etapa IS NULL THEN 'Pendente'
 WHEN d.dias_etapa<=d.meta_dias THEN 'No prazo' ELSE 'Fora da meta' END AS status_meta_etapa,
 CASE WHEN d.meta_dias IS NOT NULL AND d.dias_etapa IS NOT NULL
 THEN GREATEST(d.dias_etapa-d.meta_dias,0) END AS atraso_dias
 FROM duracoes d
)
SELECT contrato_id,contrato_aethos_id,tipo_contrato_codigo,tipo_contrato_nome,
 fluxo_id,fluxo_nome,etapa_id,etapa_chave,etapa_ordem,etapa_nome,responsavel_etapa,
 meta_dias,meta_tipo,etapa_automatica,etapa_obrigatoria,data_etapa,data_inicio_contagem,
 data_fim_contagem,dias_etapa,status_etapa,fase_atual_contrato,status_meta_etapa,
 atraso_dias,observacao_etapa,ultimo_usuario_alteracao,ultima_alteracao_em,
 workflow_registro_id,etapa_registro_id,workflow_status,meta_comparacao,etapa_final,
 data_entrada_aprovacao,data_contratacao_ciclo,ciclo_aprovacao_id,historico_ciclo_completo,
 (etapa_ordem>1 AND data_etapa IS NOT NULL AND etapa_anterior_em IS NOT NULL AND dias_etapa IS NOT NULL) AS intervalo_completo,
 CASE WHEN status_contrato_codigo IN ('O','F') AND etapa_ordem>1
 AND data_etapa IS NOT NULL AND etapa_anterior_em IS NOT NULL THEN dias_etapa END AS dias_etapa_concluida,
 status_contrato_codigo
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
    COUNT(*) FILTER (WHERE etapa.etapa_ordem>1 AND etapa.data_etapa IS NOT NULL AND NOT etapa.intervalo_completo)::integer AS etapas_intervalo_invalido,
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
    CASE WHEN contrato."statusCode" IN ('O','F') THEN 'COMPLETED'
      WHEN contrato."statusCode"='P' THEN 'IN_PROGRESS' END AS workflow_status_codigo,
    fluxo."outcomeAt"::date AS workflow_desfecho_em,
    fluxo."updatedAt" AS workflow_atualizado_em,
    resumo.tipo_contrato_codigo,
    resumo.tipo_contrato_nome,
    resumo.fluxo_id,
    resumo.fluxo_nome,
    resumo.etapas_preenchidas,
    resumo.total_etapas,
    resumo.etapas_intervalo_invalido,
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
  WHERE contrato.active = TRUE AND contrato."statusCode" IN ('P','O','F')
), contratos_calculados AS (
 SELECT base.*,
 CASE WHEN base.workflow_tipo IN ('SERVICO','EMPREITEIRO') AND base."approvalCycleHistoryComplete"
 AND base."approvedAt" IS NOT NULL THEN
 CASE WHEN base."statusCode"='P' THEN CURRENT_DATE
 WHEN base."approvalCycleContractedAt">=base."approvedAt" THEN base."approvalCycleContractedAt"::date END END AS data_fim_lead_time,
 CASE base.workflow_tipo WHEN 'SERVICO' THEN 8 WHEN 'EMPREITEIRO' THEN 6 END AS meta_total_fluxo_dias
 FROM contratos_base base
), contratos_com_lead_time AS (
 SELECT calculado.*,
 CASE WHEN calculado.data_fim_lead_time >= calculado."approvedAt"::date
 THEN bi.fn_dias_uteis(calculado."approvedAt"::date,calculado.data_fim_lead_time) END AS lead_time_total_dias
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
  CASE WHEN contrato.meta_total_fluxo_dias IS NULL THEN 'Sem meta total'
    WHEN contrato.lead_time_total_dias IS NULL THEN 'Pendente'
    WHEN contrato.lead_time_total_dias <= contrato.meta_total_fluxo_dias THEN 'No prazo'
    ELSE 'Fora da meta' END AS status_meta_total,
  CASE WHEN contrato.lead_time_total_dias IS NOT NULL AND contrato.meta_total_fluxo_dias IS NOT NULL
    THEN GREATEST(contrato.lead_time_total_dias-contrato.meta_total_fluxo_dias,0) END AS atraso_total_dias,
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
  contrato."measurementBalance" AS saldo_medicao,
  CASE WHEN contrato."approvalCycleHistoryComplete" THEN contrato."approvedAt"::date END AS data_entrada_aprovacao,
  CASE WHEN contrato."approvalCycleHistoryComplete" AND contrato."statusCode" IN ('O','F')
    AND contrato."approvalCycleContractedAt">=contrato."approvedAt" THEN contrato."approvalCycleContractedAt"::date END AS data_contratacao_ciclo,
  contrato."approvalCycleSourceId" AS ciclo_aprovacao_id,
  contrato."approvalCycleHistoryComplete" AS historico_ciclo_completo,
  (COALESCE(contrato.total_etapas,0)>0 AND contrato.etapas_preenchidas=contrato.total_etapas AND contrato.etapas_intervalo_invalido=0) AS preenchimento_completo,
  (contrato."statusCode" IN ('O','F') AND contrato.lead_time_total_dias IS NOT NULL) AS indicador_concluido_elegivel,
  CASE WHEN contrato.workflow_tipo='EMPREITEIRO' AND contrato."startDate" IS NOT NULL
    THEN GREATEST(contrato."startDate"::date-contrato."registeredAt"::date,0) END AS antecedencia_solicitacao_dias,
  CASE WHEN contrato.workflow_tipo='EMPREITEIRO' THEN 15 END AS meta_antecedencia_solicitacao_dias
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
  ROUND(AVG(etapa.dias_etapa_concluida)::numeric, 2) AS tempo_medio_etapa_dias,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY etapa.dias_etapa_concluida)::numeric,
    2
  ) AS mediana_etapa_dias,
  MIN(etapa.dias_etapa_concluida) AS menor_tempo_etapa_dias,
  MAX(etapa.dias_etapa_concluida) AS maior_tempo_etapa_dias,
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
    WHEN AVG(etapa.dias_etapa_concluida) IS NULL THEN 'Sem dados'
    WHEN MAX(etapa.meta_comparacao) = 'MIN'
      AND AVG(etapa.dias_etapa_concluida) >= etapa.meta_dias THEN 'No prazo'
    WHEN MAX(etapa.meta_comparacao) = 'MIN' THEN 'Fora da meta'
    WHEN AVG(etapa.dias_etapa_concluida) <= etapa.meta_dias THEN 'No prazo'
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
  ROUND(AVG(contrato.lead_time_total_dias) FILTER (WHERE contrato.indicador_concluido_elegivel)::numeric, 2) AS lead_time_medio_dias,
  ROUND(AVG(contrato.atraso_total_dias) FILTER (WHERE contrato.indicador_concluido_elegivel)::numeric, 2) AS atraso_medio_dias
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

COMMENT ON VIEW bi.pbi_adm_contratos IS 'Contratos P/O/F. Prazo oficial da aprovacao ate a primeira contratacao do mesmo ciclo; cadastro e antecedencia separados.';
COMMENT ON VIEW bi.pbi_adm_contratos_etapas IS 'Somente a primeira etapa pendente de P envelhece. Medias concluidas usam intervalos adjacentes completos de O/F.';
