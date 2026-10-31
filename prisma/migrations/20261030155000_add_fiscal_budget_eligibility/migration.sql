ALTER TABLE "AethosPlanoContaCost"
ADD COLUMN "fiscalBudgetEligible" BOOLEAN;

CREATE TABLE "AethosFiscalBudgetEligibilityBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "changedCount" INTEGER NOT NULL,
    "alreadyCount" INTEGER NOT NULL,
    "updates" JSONB NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AethosFiscalBudgetEligibilityBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosFiscalBudgetEligibilityBatch_runId_key" ON "AethosFiscalBudgetEligibilityBatch"("runId");
CREATE INDEX "AethosFiscalBudgetEligibilityBatch_executedAt_idx" ON "AethosFiscalBudgetEligibilityBatch"("executedAt");
