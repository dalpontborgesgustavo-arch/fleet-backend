CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."contratos_fluxo_resumo_mensal";
DROP VIEW IF EXISTS "bi"."contratos_fluxo";
DROP VIEW IF EXISTS "bi"."contratos_fluxo_etapas";

CREATE VIEW "bi"."contratos_fluxo_etapas" AS
WITH templates (
  tipo_fluxo,
  sequencia,
  chave_etapa,
  etapa,
  responsavel,
  meta_dias,
  meta_unidade,
  meta_comparacao,
  meta_descricao
) AS (
  VALUES
    ('SERVICO', 1, 'SOLICITACAO', 'Solicitacao do contrato', 'Solicitante (Gerente)', 0, 'BUSINESS_DAYS', 'MAX', 'Imediato'),
    ('SERVICO', 2, 'CONFERENCIA_ADMINISTRATIVO', 'Conferencia da documentacao', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('SERVICO', 3, 'ELABORACAO_JURIDICO', 'Elaboracao, validacao e envio para assinatura', 'Juridico', 3, 'BUSINESS_DAYS', 'MAX', 'Ate 3 dias uteis'),
    ('SERVICO', 4, 'ASSINATURA_FORNECEDOR', 'Validacao e assinatura do fornecedor', 'Fornecedor / Prestador', 2, 'BUSINESS_DAYS', 'MAX', 'Ate 2 dias uteis'),
    ('SERVICO', 5, 'APROVACAO_DIRETORA_ADMINISTRATIVA', 'Conferencia, aprovacao e assinatura', 'Diretora Administrativa', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('SERVICO', 6, 'DISPONIBILIZACAO_JURIDICO', 'Disponibilizacao do contrato assinado', 'Juridico', NULL, NULL, NULL, 'Responsabilidade do Juridico'),
    ('SERVICO', 7, 'CONTRATO_LIBERADO', 'Contrato liberado no Aethos', 'Processo concluido', NULL, NULL, NULL, 'Conclusao'),
    ('EMPREITEIRO', 1, 'SOLICITACAO_ENGENHEIRO', 'Solicitacao do contrato', 'Engenheiro de Obras', 15, 'CALENDAR_DAYS', 'MIN', 'Minimo de 15 dias de antecedencia'),
    ('EMPREITEIRO', 2, 'CONFERENCIA_ADMINISTRATIVO', 'Conferencia das informacoes e documentacao', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 3, 'APROVACAO_DIRETOR_OPERACOES', 'Analise e aprovacao da solicitacao', 'Diretor de Operacoes', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 4, 'ENCAMINHAMENTO_JURIDICO', 'Insercao da documentacao e envio ao Juridico', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 5, 'VALIDACAO_JURIDICO', 'Validacao, minuta e plataforma de assinaturas', 'Juridico', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 6, 'ASSINATURA_EMPREITEIRO', 'Assinatura eletronica de todas as partes', 'Empreiteiro / Fornecedor', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 7, 'LIBERACAO_GERENTE_ADMINISTRATIVA', 'Conferencia final, assinatura e liberacao', 'Gerente Administrativa', 1, 'BUSINESS_DAYS', 'MAX', 'Ate 1 dia util'),
    ('EMPREITEIRO', 8, 'CONTRATO_LIBERADO', 'Contrato liberado no Aethos', 'Processo concluido', NULL, NULL, NULL, 'Conclusao')
),
contracts AS (
  SELECT
    contract.*,
    workflow."id" AS workflow_id,
    workflow."status" AS workflow_status_saved,
    workflow."outcomeAt" AS workflow_outcome_at,
    workflow."cancellationReason" AS workflow_cancellation_reason,
    workflow."notes" AS workflow_notes,
    workflow."updatedById" AS workflow_updated_by_id,
    workflow."updatedByName" AS workflow_updated_by_name,
    workflow."createdAt" AS workflow_created_at,
    workflow."updatedAt" AS workflow_updated_at,
    CASE
      WHEN workflow."type" IN ('SERVICO', 'EMPREITEIRO') THEN workflow."type"
      WHEN contract."accountPlanAethosId" = '750'
        OR COALESCE(contract."accountPlanName", '') ILIKE '%EMPREITEIR%'
        THEN 'EMPREITEIRO'
      ELSE 'SERVICO'
    END AS workflow_type,
    CASE
      WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status"
      WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
      WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
      ELSE 'IN_PROGRESS'
    END AS workflow_status
  FROM "AethosContract" contract
  LEFT JOIN "ContractWorkflow" workflow ON workflow."contractId" = contract."id"
  WHERE contract."active" = TRUE
),
stage_rows AS (
  SELECT
    contract.*,
    template.sequencia,
    template.chave_etapa,
    COALESCE(stage."label", template.etapa) AS etapa,
    COALESCE(stage."responsible", template.responsavel) AS responsavel,
    COALESCE(stage."targetDays", template.meta_dias) AS meta_dias,
    COALESCE(stage."targetUnit", template.meta_unidade) AS meta_unidade,
    COALESCE(stage."targetComparison", template.meta_comparacao) AS meta_comparacao,
    template.meta_descricao,
    stage."id" AS etapa_id,
    stage."completedAt" AS etapa_concluida_em,
    stage."notes" AS etapa_observacoes,
    stage."updatedById" AS etapa_atualizada_por_id,
    stage."updatedByName" AS etapa_atualizada_por_nome,
    stage."updatedAt" AS etapa_atualizada_em
  FROM contracts contract
  INNER JOIN templates template ON template.tipo_fluxo = contract.workflow_type
  LEFT JOIN "ContractWorkflowStage" stage
    ON stage."workflowId" = contract.workflow_id
    AND stage."key" = template.chave_etapa
),
sequenced AS (
  SELECT
    stage_rows.*,
    MAX(stage_rows.etapa_concluida_em) FILTER (WHERE stage_rows.etapa_concluida_em IS NOT NULL)
      OVER (
        PARTITION BY stage_rows."id"
        ORDER BY stage_rows.sequencia
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS etapa_anterior_concluida_em
  FROM stage_rows
),
elapsed AS (
  SELECT
    sequenced.*,
    CASE
      WHEN sequenced.sequencia = 1
        AND sequenced.meta_comparacao = 'MIN'
        AND sequenced.etapa_concluida_em IS NOT NULL
        AND sequenced."startDate" IS NOT NULL
        THEN GREATEST(0, sequenced."startDate"::date - sequenced.etapa_concluida_em::date)
      WHEN sequenced.sequencia = 1 AND sequenced.etapa_concluida_em IS NOT NULL
        THEN 0
      WHEN sequenced.etapa_anterior_concluida_em IS NOT NULL
        AND sequenced.meta_unidade = 'CALENDAR_DAYS'
        THEN GREATEST(
          0,
          COALESCE(sequenced.etapa_concluida_em::date, CURRENT_DATE)
            - sequenced.etapa_anterior_concluida_em::date
        )
      WHEN sequenced.etapa_anterior_concluida_em IS NOT NULL
        THEN (
          SELECT COUNT(*)::integer
          FROM generate_series(
            sequenced.etapa_anterior_concluida_em::date + 1,
            COALESCE(sequenced.etapa_concluida_em::date, CURRENT_DATE),
            INTERVAL '1 day'
          ) AS calendar_day
          WHERE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5
        )
      ELSE NULL
    END AS dias_decorridos
  FROM sequenced
)
SELECT
  elapsed."id" AS contrato_id,
  elapsed."aethosId" AS contrato_aethos_id,
  elapsed."quotationAethosId" AS cotacao_aethos_id,
  elapsed."companyAethosId" AS empresa_aethos_id,
  CASE elapsed."companyAethosId"
    WHEN '1' THEN 'JR Construcoes'
    WHEN '4' THEN 'Pedraforte'
    ELSE 'Empresa ' || elapsed."companyAethosId"
  END AS empresa_nome,
  elapsed."workAethosId" AS obra_aethos_id,
  elapsed."workName" AS obra_nome,
  elapsed."contractorAethosId" AS contratado_aethos_id,
  elapsed."contractorName" AS contratado_nome,
  elapsed."engineerAethosId" AS engenheiro_aethos_id,
  elapsed."engineerName" AS engenheiro_nome,
  elapsed."accountPlanAethosId" AS plano_contas_aethos_id,
  elapsed."accountPlanName" AS plano_contas_nome,
  elapsed."registeredAt" AS contrato_cadastrado_em,
  elapsed."startDate" AS contrato_inicio_em,
  elapsed."endDate" AS contrato_termino_em,
  elapsed."statusCode" AS contrato_status_codigo,
  elapsed."statusDescription" AS contrato_status_descricao,
  elapsed.workflow_id,
  (elapsed.workflow_id IS NOT NULL) AS fluxo_preenchido,
  elapsed.workflow_type AS tipo_fluxo,
  CASE elapsed.workflow_type
    WHEN 'EMPREITEIRO' THEN 'Contrato de empreiteiro'
    ELSE 'Prestacao de servicos'
  END AS tipo_fluxo_nome,
  elapsed.workflow_status AS status_fluxo,
  CASE elapsed.workflow_status
    WHEN 'COMPLETED' THEN 'Concluido'
    WHEN 'CANCELLED' THEN 'Cancelado'
    ELSE 'Em andamento'
  END AS status_fluxo_nome,
  elapsed.sequencia,
  elapsed.chave_etapa,
  elapsed.etapa,
  elapsed.responsavel,
  elapsed.meta_dias,
  elapsed.meta_unidade,
  CASE elapsed.meta_unidade
    WHEN 'BUSINESS_DAYS' THEN 'Dias uteis'
    WHEN 'CALENDAR_DAYS' THEN 'Dias corridos'
    ELSE NULL
  END AS meta_unidade_nome,
  elapsed.meta_comparacao,
  elapsed.meta_descricao,
  elapsed.etapa_anterior_concluida_em,
  elapsed.etapa_concluida_em,
  elapsed.dias_decorridos,
  CASE
    WHEN elapsed.etapa_concluida_em IS NULL AND elapsed.dias_decorridos IS NULL THEN 'PENDING'
    WHEN elapsed.meta_dias IS NULL THEN
      CASE WHEN elapsed.etapa_concluida_em IS NULL THEN 'PENDING' ELSE 'COMPLETED' END
    WHEN elapsed.etapa_concluida_em IS NOT NULL THEN
      CASE
        WHEN elapsed.meta_comparacao = 'MIN' AND elapsed.dias_decorridos >= elapsed.meta_dias THEN 'ON_TIME'
        WHEN elapsed.meta_comparacao = 'MAX' AND elapsed.dias_decorridos <= elapsed.meta_dias THEN 'ON_TIME'
        ELSE 'LATE'
      END
    WHEN elapsed.meta_comparacao = 'MAX' AND elapsed.dias_decorridos > elapsed.meta_dias THEN 'LATE'
    ELSE 'PENDING'
  END AS desempenho_etapa,
  CASE
    WHEN elapsed.etapa_concluida_em IS NULL AND elapsed.dias_decorridos IS NULL THEN 'Aguardando'
    WHEN elapsed.meta_dias IS NULL THEN
      CASE WHEN elapsed.etapa_concluida_em IS NULL THEN 'Aguardando' ELSE 'Concluida' END
    WHEN elapsed.etapa_concluida_em IS NOT NULL THEN
      CASE
        WHEN elapsed.meta_comparacao = 'MIN' AND elapsed.dias_decorridos >= elapsed.meta_dias THEN 'No prazo'
        WHEN elapsed.meta_comparacao = 'MAX' AND elapsed.dias_decorridos <= elapsed.meta_dias THEN 'No prazo'
        ELSE 'Atrasada'
      END
    WHEN elapsed.meta_comparacao = 'MAX' AND elapsed.dias_decorridos > elapsed.meta_dias THEN 'Atrasada'
    ELSE 'Aguardando'
  END AS desempenho_etapa_nome,
  CASE
    WHEN elapsed.meta_dias IS NULL OR elapsed.dias_decorridos IS NULL THEN NULL
    WHEN elapsed.meta_comparacao = 'MIN' THEN GREATEST(0, elapsed.meta_dias - elapsed.dias_decorridos)
    ELSE GREATEST(0, elapsed.dias_decorridos - elapsed.meta_dias)
  END AS dias_fora_meta,
  elapsed.etapa_observacoes,
  elapsed.etapa_atualizada_por_id,
  elapsed.etapa_atualizada_por_nome,
  elapsed.etapa_atualizada_em,
  elapsed.workflow_updated_by_id AS fluxo_atualizado_por_id,
  elapsed.workflow_updated_by_name AS fluxo_atualizado_por_nome,
  elapsed.workflow_updated_at AS fluxo_atualizado_em
FROM elapsed;

CREATE VIEW "bi"."contratos_fluxo" AS
WITH stage_summary AS (
  SELECT
    stage.contrato_id,
    COUNT(*)::integer AS total_etapas,
    COUNT(*) FILTER (WHERE stage.etapa_concluida_em IS NOT NULL)::integer AS etapas_concluidas,
    COUNT(*) FILTER (WHERE stage.desempenho_etapa = 'ON_TIME')::integer AS etapas_no_prazo,
    COUNT(*) FILTER (WHERE stage.desempenho_etapa = 'LATE')::integer AS etapas_atrasadas,
    MIN(stage.etapa_concluida_em) AS primeira_etapa_em,
    MAX(stage.etapa_concluida_em) AS ultima_etapa_em,
    MIN(stage.sequencia) FILTER (WHERE stage.etapa_concluida_em IS NULL) AS etapa_atual_sequencia
  FROM "bi"."contratos_fluxo_etapas" stage
  GROUP BY stage.contrato_id
),
current_stage AS (
  SELECT
    stage.contrato_id,
    stage.sequencia,
    stage.chave_etapa,
    stage.etapa,
    stage.responsavel,
    stage.desempenho_etapa,
    stage.dias_decorridos,
    stage.meta_dias
  FROM "bi"."contratos_fluxo_etapas" stage
  INNER JOIN stage_summary summary
    ON summary.contrato_id = stage.contrato_id
    AND summary.etapa_atual_sequencia = stage.sequencia
)
SELECT
  contract."id" AS contrato_id,
  contract."aethosId" AS contrato_aethos_id,
  contract."quotationAethosId" AS cotacao_aethos_id,
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
  contract."engineerAethosId" AS engenheiro_aethos_id,
  contract."engineerName" AS engenheiro_nome,
  contract."accountPlanAethosId" AS plano_contas_aethos_id,
  contract."accountPlanName" AS plano_contas_nome,
  contract."registeredAt" AS cadastrado_em,
  contract."startDate" AS inicio_em,
  contract."endDate" AS termino_em,
  contract."finalizedAt" AS finalizado_em,
  contract."originalValue" AS valor_contrato,
  COALESCE(contract."totalMeasuredValue", 0) AS valor_medido,
  COALESCE(contract."contractBalance", 0) AS saldo_contrato,
  COALESCE(contract."payableBalance", 0) AS saldo_a_pagar,
  contract."statusCode" AS contrato_status_codigo,
  contract."statusDescription" AS contrato_status_descricao,
  (workflow."id" IS NOT NULL) AS fluxo_preenchido,
  COALESCE(
    CASE WHEN workflow."type" IN ('SERVICO', 'EMPREITEIRO') THEN workflow."type" END,
    CASE
      WHEN contract."accountPlanAethosId" = '750'
        OR COALESCE(contract."accountPlanName", '') ILIKE '%EMPREITEIR%'
        THEN 'EMPREITEIRO'
      ELSE 'SERVICO'
    END
  ) AS tipo_fluxo,
  CASE
    WHEN COALESCE(
      CASE WHEN workflow."type" IN ('SERVICO', 'EMPREITEIRO') THEN workflow."type" END,
      CASE
        WHEN contract."accountPlanAethosId" = '750'
          OR COALESCE(contract."accountPlanName", '') ILIKE '%EMPREITEIR%'
          THEN 'EMPREITEIRO'
        ELSE 'SERVICO'
      END
    ) = 'EMPREITEIRO' THEN 'Contrato de empreiteiro'
    ELSE 'Prestacao de servicos'
  END AS tipo_fluxo_nome,
  COALESCE(
    CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
    CASE
      WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
      WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
      ELSE 'IN_PROGRESS'
    END
  ) AS status_fluxo,
  CASE COALESCE(
    CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
    CASE
      WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
      WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
      ELSE 'IN_PROGRESS'
    END
  )
    WHEN 'COMPLETED' THEN 'Concluido'
    WHEN 'CANCELLED' THEN 'Cancelado'
    ELSE 'Em andamento'
  END AS status_fluxo_nome,
  COALESCE(
    workflow."outcomeAt",
    CASE
      WHEN COALESCE(
        CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
        CASE
          WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
          WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
          ELSE 'IN_PROGRESS'
        END
      ) <> 'IN_PROGRESS' THEN COALESCE(contract."finalizedAt", contract."endDate")
      ELSE NULL
    END
  ) AS desfecho_em,
  COALESCE(workflow."cancellationReason", contract."cancellationReason") AS motivo_cancelamento,
  workflow."notes" AS observacoes_fluxo,
  summary.total_etapas,
  summary.etapas_concluidas,
  summary.etapas_no_prazo,
  summary.etapas_atrasadas,
  ROUND((summary.etapas_concluidas::numeric / NULLIF(summary.total_etapas, 0)) * 100)::integer AS percentual_conclusao,
  (summary.etapas_atrasadas > 0) AS possui_atraso,
  CASE
    WHEN summary.primeira_etapa_em IS NULL THEN NULL
    ELSE (
      SELECT COUNT(*)::integer
      FROM generate_series(
        summary.primeira_etapa_em::date + 1,
        COALESCE(
          workflow."outcomeAt"::date,
          CASE
            WHEN COALESCE(
              CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
              CASE
                WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
                WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
                ELSE 'IN_PROGRESS'
              END
            ) <> 'IN_PROGRESS' THEN COALESCE(contract."finalizedAt"::date, contract."endDate"::date)
            ELSE summary.ultima_etapa_em::date
          END,
          summary.ultima_etapa_em::date
        ),
        INTERVAL '1 day'
      ) AS calendar_day
      WHERE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5
    )
  END AS total_dias_uteis,
  CASE
    WHEN COALESCE(
      CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
      CASE
        WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
        WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
        ELSE 'IN_PROGRESS'
      END
    ) = 'IN_PROGRESS' THEN current_stage.sequencia
    ELSE NULL
  END AS etapa_atual_sequencia,
  CASE
    WHEN COALESCE(
      CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
      CASE
        WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
        WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
        ELSE 'IN_PROGRESS'
      END
    ) = 'IN_PROGRESS' THEN current_stage.etapa
    ELSE NULL
  END AS etapa_atual,
  CASE
    WHEN COALESCE(
      CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
      CASE
        WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
        WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
        ELSE 'IN_PROGRESS'
      END
    ) = 'IN_PROGRESS' THEN current_stage.responsavel
    ELSE NULL
  END AS etapa_atual_responsavel,
  CASE
    WHEN COALESCE(
      CASE WHEN workflow."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN workflow."status" END,
      CASE
        WHEN contract."statusCode" = 'C' THEN 'CANCELLED'
        WHEN contract."statusCode" = 'F' THEN 'COMPLETED'
        ELSE 'IN_PROGRESS'
      END
    ) = 'IN_PROGRESS' THEN current_stage.desempenho_etapa
    ELSE NULL
  END AS etapa_atual_desempenho,
  workflow."updatedById" AS atualizado_por_id,
  workflow."updatedByName" AS atualizado_por_nome,
  workflow."updatedAt" AS atualizado_em,
  contract."syncedAt" AS sincronizado_em
FROM "AethosContract" contract
LEFT JOIN "ContractWorkflow" workflow ON workflow."contractId" = contract."id"
INNER JOIN stage_summary summary ON summary.contrato_id = contract."id"
LEFT JOIN current_stage ON current_stage.contrato_id = contract."id"
WHERE contract."active" = TRUE;

CREATE VIEW "bi"."contratos_fluxo_resumo_mensal" AS
SELECT
  DATE_TRUNC('month', contract.cadastrado_em)::date AS mes_cadastro,
  contract.empresa_aethos_id,
  contract.empresa_nome,
  contract.tipo_fluxo,
  contract.tipo_fluxo_nome,
  contract.status_fluxo,
  contract.status_fluxo_nome,
  COUNT(*)::integer AS total_contratos,
  COUNT(*) FILTER (WHERE contract.fluxo_preenchido)::integer AS fluxos_preenchidos,
  COUNT(*) FILTER (WHERE NOT contract.fluxo_preenchido)::integer AS fluxos_nao_preenchidos,
  COUNT(*) FILTER (WHERE contract.status_fluxo = 'IN_PROGRESS')::integer AS em_andamento,
  COUNT(*) FILTER (WHERE contract.status_fluxo = 'COMPLETED')::integer AS concluidos,
  COUNT(*) FILTER (WHERE contract.status_fluxo = 'CANCELLED')::integer AS cancelados,
  COUNT(*) FILTER (WHERE contract.possui_atraso)::integer AS contratos_com_atraso,
  SUM(contract.etapas_concluidas)::integer AS etapas_concluidas,
  SUM(contract.etapas_atrasadas)::integer AS etapas_atrasadas,
  AVG(contract.percentual_conclusao)::numeric(10, 2) AS percentual_medio_conclusao,
  AVG(contract.total_dias_uteis)::numeric(10, 2) AS media_dias_uteis,
  SUM(contract.valor_contrato) AS valor_contratos,
  SUM(contract.valor_medido) AS valor_medido,
  SUM(contract.saldo_contrato) AS saldo_contratos
FROM "bi"."contratos_fluxo" contract
GROUP BY
  DATE_TRUNC('month', contract.cadastrado_em)::date,
  contract.empresa_aethos_id,
  contract.empresa_nome,
  contract.tipo_fluxo,
  contract.tipo_fluxo_nome,
  contract.status_fluxo,
  contract.status_fluxo_nome;

COMMENT ON VIEW "bi"."contratos_fluxo" IS 'Um registro por contrato ativo, com os mesmos indicadores do fluxo exibido no Sistema JR.';
COMMENT ON VIEW "bi"."contratos_fluxo_etapas" IS 'Uma linha por etapa prevista de cada contrato ativo, incluindo etapas ainda nao preenchidas e calculo de prazo.';
COMMENT ON VIEW "bi"."contratos_fluxo_resumo_mensal" IS 'Resumo dos indicadores do fluxo por mes de cadastro, empresa, tipo e status.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contratos_fluxo" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contratos_fluxo_etapas" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."contratos_fluxo_resumo_mensal" TO powerbi_reader';
  END IF;
END $$;
