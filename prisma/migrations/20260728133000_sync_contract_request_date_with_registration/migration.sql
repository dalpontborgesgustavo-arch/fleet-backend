-- A primeira etapa do fluxo representa o lançamento oficial do contrato no Aethos.
-- Corrige fluxos já salvos para usar a data de cadastro recebida na sincronização.
UPDATE "ContractWorkflowStage" AS stage
SET
  "completedAt" = contract."registeredAt",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "ContractWorkflow" AS workflow
INNER JOIN "AethosContract" AS contract
  ON contract."id" = workflow."contractId"
WHERE stage."workflowId" = workflow."id"
  AND stage."key" IN ('SOLICITACAO', 'SOLICITACAO_ENGENHEIRO')
  AND stage."completedAt" IS DISTINCT FROM contract."registeredAt";
