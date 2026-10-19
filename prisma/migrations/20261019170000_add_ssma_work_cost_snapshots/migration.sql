CREATE TABLE "SsmaWorkCostSnapshot" (
    "runId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "budgetCount" INTEGER NOT NULL,
    "actualCount" INTEGER NOT NULL,
    "budgets" JSONB NOT NULL,
    "actuals" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsmaWorkCostSnapshot_pkey" PRIMARY KEY ("runId")
);

CREATE UNIQUE INDEX "SsmaWorkCostSnapshot_generatedAt_key" ON "SsmaWorkCostSnapshot"("generatedAt");
CREATE INDEX "SsmaWorkCostSnapshot_receivedAt_idx" ON "SsmaWorkCostSnapshot"("receivedAt");
