ALTER TABLE "AethosPlanoContaCost"
ADD COLUMN "deactivatedAt" TIMESTAMP(3),
ADD COLUMN "deactivationReason" TEXT,
ADD COLUMN "reconciliationId" TEXT;

CREATE INDEX "AethosPlanoContaCost_reconciliationId_idx"
ON "AethosPlanoContaCost"("reconciliationId");

CREATE TABLE "AethosPlanoContaCostReconciliation" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "foundCount" INTEGER NOT NULL,
    "deactivatedCount" INTEGER NOT NULL,
    "alreadyInactiveCount" INTEGER NOT NULL,
    "notFoundCount" INTEGER NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "idLancamentos" JSONB NOT NULL,
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AethosPlanoContaCostReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosPlanoContaCostReconciliation_reconciliationId_key"
ON "AethosPlanoContaCostReconciliation"("reconciliationId");

CREATE INDEX "AethosPlanoContaCostReconciliation_origin_idx"
ON "AethosPlanoContaCostReconciliation"("origin");

CREATE INDEX "AethosPlanoContaCostReconciliation_rule_idx"
ON "AethosPlanoContaCostReconciliation"("rule");

CREATE INDEX "AethosPlanoContaCostReconciliation_executedAt_idx"
ON "AethosPlanoContaCostReconciliation"("executedAt");
