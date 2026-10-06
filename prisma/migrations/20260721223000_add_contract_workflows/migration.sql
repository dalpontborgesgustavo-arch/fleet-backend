CREATE TABLE "ContractWorkflow" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "outcomeAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "notes" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractWorkflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractWorkflowStage" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "responsible" TEXT NOT NULL,
  "targetDays" INTEGER,
  "targetUnit" TEXT,
  "targetComparison" TEXT,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractWorkflowStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractWorkflow_contractId_key" ON "ContractWorkflow"("contractId");
CREATE INDEX "ContractWorkflow_type_idx" ON "ContractWorkflow"("type");
CREATE INDEX "ContractWorkflow_status_idx" ON "ContractWorkflow"("status");
CREATE INDEX "ContractWorkflow_updatedAt_idx" ON "ContractWorkflow"("updatedAt");
CREATE UNIQUE INDEX "ContractWorkflowStage_workflowId_key_key" ON "ContractWorkflowStage"("workflowId", "key");
CREATE INDEX "ContractWorkflowStage_workflowId_sequence_idx" ON "ContractWorkflowStage"("workflowId", "sequence");
CREATE INDEX "ContractWorkflowStage_completedAt_idx" ON "ContractWorkflowStage"("completedAt");

ALTER TABLE "ContractWorkflow"
  ADD CONSTRAINT "ContractWorkflow_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "AethosContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractWorkflowStage"
  ADD CONSTRAINT "ContractWorkflowStage_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "ContractWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
