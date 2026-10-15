CREATE TABLE "PrumareVgvScenario" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "phases" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrumareVgvScenario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrumareVgvScenario_createdBy_enterpriseId_createdAt_idx" ON "PrumareVgvScenario"("createdBy", "enterpriseId", "createdAt");

ALTER TABLE "PrumareVgvScenario" ADD CONSTRAINT "PrumareVgvScenario_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "PrumareEnterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
