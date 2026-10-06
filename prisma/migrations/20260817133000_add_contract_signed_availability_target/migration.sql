-- A etapa de disponibilizacao do contrato assinado passa a ter meta oficial
-- de ate 1 dia util no fluxo de prestacao de servico.
UPDATE "ContractWorkflowStage" AS stage
SET
  "targetDays" = 1,
  "targetUnit" = 'BUSINESS_DAYS',
  "targetComparison" = 'MAX',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "ContractWorkflow" AS workflow
WHERE stage."workflowId" = workflow.id
  AND workflow.type = 'SERVICO'
  AND stage.key = 'DISPONIBILIZACAO_JURIDICO';

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
    ('PRESTACAO_SERVICO', 'Prestacao de servico', 'PRESTACAO_SERVICO_7_ETAPAS', 'Fluxo de prestacao de servico', 'PRESTACAO_SERVICO:DISPONIBILIZACAO_JURIDICO', 'DISPONIBILIZACAO_JURIDICO', 6, 'Disponibilizacao do contrato assinado', 'Juridico', 1, 'UTIL', 'MAX', FALSE, TRUE, FALSE),
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

GRANT SELECT ON bi.pbi_adm_dim_etapas_fluxo TO powerbi_reader;
