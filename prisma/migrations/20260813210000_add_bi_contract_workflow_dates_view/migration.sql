CREATE SCHEMA IF NOT EXISTS bi;

CREATE OR REPLACE VIEW bi.contratos_fluxo_datas AS
WITH stage_dates AS (
  SELECT
    stage."workflowId" AS workflow_id,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'CONFERENCIA_ADMINISTRATIVO') AS conferencia_administrativo_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'APROVACAO_DIRETOR_OPERACOES') AS aprovacao_diretor_operacoes_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'ENCAMINHAMENTO_JURIDICO') AS encaminhamento_juridico_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'ELABORACAO_JURIDICO') AS elaboracao_juridico_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'VALIDACAO_JURIDICO') AS validacao_juridico_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'ASSINATURA_FORNECEDOR') AS assinatura_fornecedor_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'ASSINATURA_EMPREITEIRO') AS assinatura_empreiteiro_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'APROVACAO_DIRETORA_ADMINISTRATIVA') AS aprovacao_diretora_administrativa_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'DISPONIBILIZACAO_JURIDICO') AS disponibilizacao_juridico_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'LIBERACAO_GERENTE_ADMINISTRATIVA') AS liberacao_gerente_administrativa_em,
    MAX(stage."completedAt") FILTER (WHERE stage.key = 'CONTRATO_LIBERADO') AS contrato_liberado_etapa_em,
    COUNT(*) FILTER (WHERE stage."completedAt" IS NOT NULL)::integer AS etapas_intermediarias_concluidas
  FROM "ContractWorkflowStage" stage
  GROUP BY stage."workflowId"
), flow_dates AS (
  SELECT
    contract.id AS contrato_id,
    contract."aethosId" AS contrato_aethos_id,
    contract."companyAethosId" AS empresa_aethos_id,
    CASE contract."companyAethosId"
      WHEN '1' THEN 'JR Construcoes'
      WHEN '4' THEN 'Pedraforte'
      ELSE 'Empresa ' || contract."companyAethosId"
    END AS empresa_nome,
    contract."workAethosId" AS obra_aethos_id,
    contract."workName" AS obra_nome,
    contract."contractorAethosId" AS contratado_aethos_id,
    contract."contractorName" AS contratado_nome,
    contract."engineerName" AS engenheiro_nome,
    contract."originalValue" AS valor_contrato,
    contract."statusCode" AS contrato_status_codigo,
    contract."statusDescription" AS contrato_status_descricao,
    COALESCE(workflow.type, 'SEM_CLASSIFICACAO') AS tipo_fluxo,
    CASE workflow.type
      WHEN 'SERVICO' THEN 'Prestacao de servicos'
      WHEN 'EMPREITEIRO' THEN 'Contrato de empreiteiro'
      ELSE 'Sem classificacao manual'
    END AS tipo_fluxo_nome,
    COALESCE(workflow.status, 'NAO_INICIADO') AS status_fluxo,
    CASE workflow.status
      WHEN 'COMPLETED' THEN 'Concluido'
      WHEN 'CANCELLED' THEN 'Cancelado'
      WHEN 'IN_PROGRESS' THEN 'Em andamento'
      ELSE 'Nao iniciado'
    END AS status_fluxo_nome,
    workflow.id IS NOT NULL AS fluxo_classificado,
    contract."registeredAt"::date AS solicitacao_em,
    contract."startDate"::date AS inicio_contrato_em,
    stage_dates.conferencia_administrativo_em::date AS conferencia_administrativo_em,
    stage_dates.aprovacao_diretor_operacoes_em::date AS aprovacao_diretor_operacoes_em,
    stage_dates.encaminhamento_juridico_em::date AS encaminhamento_juridico_em,
    stage_dates.elaboracao_juridico_em::date AS elaboracao_juridico_em,
    stage_dates.validacao_juridico_em::date AS validacao_juridico_em,
    stage_dates.assinatura_fornecedor_em::date AS assinatura_fornecedor_em,
    stage_dates.assinatura_empreiteiro_em::date AS assinatura_empreiteiro_em,
    stage_dates.aprovacao_diretora_administrativa_em::date AS aprovacao_diretora_administrativa_em,
    stage_dates.disponibilizacao_juridico_em::date AS disponibilizacao_juridico_em,
    stage_dates.liberacao_gerente_administrativa_em::date AS liberacao_gerente_administrativa_em,
    COALESCE(contract."contractedAt", stage_dates.contrato_liberado_etapa_em)::date AS contrato_liberado_em,
    COALESCE(workflow."outcomeAt", contract."finalizedAt")::date AS desfecho_em,
    contract."endDate"::date AS termino_contrato_em,
    COALESCE(stage_dates.etapas_intermediarias_concluidas, 0) AS etapas_registradas,
    CASE workflow.type WHEN 'SERVICO' THEN 7 WHEN 'EMPREITEIRO' THEN 8 ELSE 0 END AS total_etapas,
    contract."syncedAt" AS sincronizado_em,
    workflow."updatedAt" AS fluxo_atualizado_em
  FROM "AethosContract" contract
  LEFT JOIN "ContractWorkflow" workflow ON workflow."contractId" = contract.id
  LEFT JOIN stage_dates ON stage_dates.workflow_id = workflow.id
  WHERE contract.active = true
)
SELECT
  flow_dates.*,
  CASE
    WHEN flow_dates.total_etapas = 0 THEN 0
    ELSE ROUND(
      LEAST(
        flow_dates.total_etapas,
        flow_dates.etapas_registradas
      )::numeric / flow_dates.total_etapas::numeric * 100
    )::integer
  END AS percentual_fluxo
FROM flow_dates;

COMMENT ON VIEW bi.contratos_fluxo_datas IS
  'Uma linha por contrato, com classificacao manual e datas do fluxo para consumo no Power BI.';

GRANT USAGE ON SCHEMA bi TO powerbi_reader;
GRANT SELECT ON bi.contratos_fluxo_datas TO powerbi_reader;
