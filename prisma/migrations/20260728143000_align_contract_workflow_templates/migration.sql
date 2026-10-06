-- Mantem as metas persistidas alinhadas aos dois fluxos oficiais:
-- SERVICO com 7 etapas e EMPREITEIRO com 8 etapas.
WITH template (
  "type",
  "key",
  "sequence",
  "label",
  "responsible",
  "targetDays",
  "targetUnit",
  "targetComparison"
) AS (
  VALUES
    ('SERVICO', 'SOLICITACAO', 1, 'Solicitacao do contrato', 'Solicitante (Gerente)', 0, 'BUSINESS_DAYS', 'MAX'),
    ('SERVICO', 'CONFERENCIA_ADMINISTRATIVO', 2, 'Conferencia da documentacao', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX'),
    ('SERVICO', 'ELABORACAO_JURIDICO', 3, 'Elaboracao, validacao e envio para assinatura', 'Juridico', 3, 'BUSINESS_DAYS', 'MAX'),
    ('SERVICO', 'ASSINATURA_FORNECEDOR', 4, 'Validacao e assinatura do fornecedor', 'Fornecedor / Prestador', 2, 'BUSINESS_DAYS', 'MAX'),
    ('SERVICO', 'APROVACAO_DIRETORA_ADMINISTRATIVA', 5, 'Conferencia, aprovacao e assinatura', 'Diretora Administrativa', 1, 'BUSINESS_DAYS', 'MAX'),
    ('SERVICO', 'DISPONIBILIZACAO_JURIDICO', 6, 'Disponibilizacao do contrato assinado', 'Juridico', NULL, NULL, NULL),
    ('SERVICO', 'CONTRATO_LIBERADO', 7, 'Contrato liberado no Aethos', 'Processo concluido', NULL, NULL, NULL),
    ('EMPREITEIRO', 'SOLICITACAO_ENGENHEIRO', 1, 'Solicitacao do contrato', 'Engenheiro de Obras', 15, 'CALENDAR_DAYS', 'MIN'),
    ('EMPREITEIRO', 'CONFERENCIA_ADMINISTRATIVO', 2, 'Conferencia das informacoes e documentacao', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'APROVACAO_DIRETOR_OPERACOES', 3, 'Analise e aprovacao da solicitacao', 'Diretor de Operacoes', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'ENCAMINHAMENTO_JURIDICO', 4, 'Insercao da documentacao e envio ao Juridico', 'Administrativo', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'VALIDACAO_JURIDICO', 5, 'Validacao, minuta e plataforma de assinaturas', 'Juridico', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'ASSINATURA_EMPREITEIRO', 6, 'Assinatura eletronica de todas as partes', 'Empreiteiro / Fornecedor', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'LIBERACAO_GERENTE_ADMINISTRATIVA', 7, 'Conferencia final, assinatura e liberacao', 'Gerente Administrativa', 1, 'BUSINESS_DAYS', 'MAX'),
    ('EMPREITEIRO', 'CONTRATO_LIBERADO', 8, 'Contrato liberado no Aethos', 'Processo concluido', NULL, NULL, NULL)
)
UPDATE "ContractWorkflowStage" AS stage
SET
  "sequence" = template."sequence",
  "label" = template."label",
  "responsible" = template."responsible",
  "targetDays" = template."targetDays",
  "targetUnit" = template."targetUnit",
  "targetComparison" = template."targetComparison",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "ContractWorkflow" AS workflow, template
WHERE stage."workflowId" = workflow."id"
  AND workflow."type" = template."type"
  AND stage."key" = template."key";
