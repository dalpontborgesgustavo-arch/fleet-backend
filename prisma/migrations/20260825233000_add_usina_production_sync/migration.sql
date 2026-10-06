BEGIN;

CREATE TABLE "UsinaSyncRun" (
  "id" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "syncMode" TEXT NOT NULL,
  "generatedAt" TIMESTAMPTZ(6) NOT NULL,
  "scopeCompanyId" TEXT NOT NULL,
  "scopeUnitId" TEXT NOT NULL,
  "scopeDateFrom" DATE NOT NULL,
  "scopeDateTo" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "receivedCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "upsertedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "deactivatedCount" INTEGER NOT NULL DEFAULT 0,
  "lastBatchNumber" INTEGER,
  "completedAt" TIMESTAMPTZ(6),
  "failedAt" TIMESTAMPTZ(6),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaSyncRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaSyncRun_mode_check" CHECK ("syncMode" IN ('incremental', 'full')),
  CONSTRAINT "UsinaSyncRun_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  CONSTRAINT "UsinaSyncRun_scope_check" CHECK ("scopeDateFrom" <= "scopeDateTo"),
  CONSTRAINT "UsinaSyncRun_counters_check" CHECK (
    "receivedCount" >= 0 AND "acceptedCount" >= 0 AND "upsertedCount" >= 0 AND
    "unchangedCount" >= 0 AND "rejectedCount" >= 0 AND "deactivatedCount" >= 0
  ),
  CONSTRAINT "UsinaSyncRun_last_batch_check" CHECK ("lastBatchNumber" IS NULL OR "lastBatchNumber" > 0),
  CONSTRAINT "UsinaSyncRun_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL) OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  ),
  CONSTRAINT "UsinaSyncRun_failure_check" CHECK (
    ("status" = 'FAILED' AND "failedAt" IS NOT NULL AND "failureReason" IS NOT NULL) OR
    ("status" <> 'FAILED' AND "failedAt" IS NULL AND "failureReason" IS NULL)
  )
);

CREATE TABLE "UsinaSyncBatch" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "batchNumber" INTEGER NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "receivedCount" INTEGER NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "upsertedCount" INTEGER NOT NULL,
  "unchangedCount" INTEGER NOT NULL,
  "rejectedCount" INTEGER NOT NULL,
  "deactivatedCount" INTEGER NOT NULL,
  "response" JSONB NOT NULL,
  "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaSyncBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaSyncBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "UsinaSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaSyncBatch_number_check" CHECK ("batchNumber" > 0),
  CONSTRAINT "UsinaSyncBatch_hash_check" CHECK (LENGTH("payloadHash") = 64),
  CONSTRAINT "UsinaSyncBatch_counters_check" CHECK (
    "receivedCount" >= 0 AND "acceptedCount" >= 0 AND "upsertedCount" >= 0 AND
    "unchangedCount" >= 0 AND "rejectedCount" >= 0 AND "deactivatedCount" >= 0
  )
);

CREATE TABLE "UsinaProductionFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "weighingId" TEXT NOT NULL,
  "aethosProductId" INTEGER NOT NULL,
  "productDescription" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "competence" DATE NOT NULL,
  "quantityTon" DECIMAL(18,6) NOT NULL,
  "aethosCompanyId" INTEGER NOT NULL,
  "originFlag" TEXT,
  "personId" INTEGER,
  "entryExitFlag" TEXT,
  "weighingVehicleStatus" TEXT NOT NULL,
  "weighingStatus" TEXT NOT NULL,
  "tareTon" DECIMAL(18,6),
  "firstWeighingAt" TIMESTAMPTZ(6),
  "secondWeighingAt" TIMESTAMPTZ(6),
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaProductionFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaProductionFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaProductionFact_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaProductionFact_quantity_check" CHECK ("quantityTon" > 0),
  CONSTRAINT "UsinaProductionFact_product_check" CHECK ("aethosProductId" > 0),
  CONSTRAINT "UsinaProductionFact_company_check" CHECK ("aethosCompanyId" > 0),
  CONSTRAINT "UsinaProductionFact_classification_check" CHECK (
    "classification" IN ('USINAGEM_SEM_CAP', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_50_70')
  ),
  CONSTRAINT "UsinaProductionFact_status_check" CHECK (
    "weighingVehicleStatus" = 'FIN' AND "weighingStatus" = 'FIN'
  ),
  CONSTRAINT "UsinaProductionFact_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "UsinaProductionFact_deactivation_check" CHECK (
    "active" = TRUE OR "deactivatedAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "UsinaSyncRun_dataset_syncRunId_key"
  ON "UsinaSyncRun"("dataset", "syncRunId");
CREATE INDEX "UsinaSyncRun_dataset_status_generatedAt_idx"
  ON "UsinaSyncRun"("dataset", "status", "generatedAt");
CREATE INDEX "UsinaSyncRun_scope_idx"
  ON "UsinaSyncRun"("scopeCompanyId", "scopeUnitId", "scopeDateFrom", "scopeDateTo");

CREATE UNIQUE INDEX "UsinaSyncBatch_runId_batchNumber_key"
  ON "UsinaSyncBatch"("runId", "batchNumber");
CREATE INDEX "UsinaSyncBatch_payloadHash_idx" ON "UsinaSyncBatch"("payloadHash");
CREATE INDEX "UsinaSyncBatch_processedAt_idx" ON "UsinaSyncBatch"("processedAt");

CREATE UNIQUE INDEX "UsinaProductionFact_source_sourceRecordId_key"
  ON "UsinaProductionFact"("source", "sourceRecordId");
CREATE INDEX "UsinaProductionFact_context_competence_active_idx"
  ON "UsinaProductionFact"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaProductionFact_product_competence_idx"
  ON "UsinaProductionFact"("aethosProductId", "competence");
CREATE INDEX "UsinaProductionFact_classification_competence_idx"
  ON "UsinaProductionFact"("classification", "competence");
CREATE INDEX "UsinaProductionFact_aethosCompanyId_idx"
  ON "UsinaProductionFact"("aethosCompanyId");
CREATE INDEX "UsinaProductionFact_lastSeenRunId_idx"
  ON "UsinaProductionFact"("lastSeenRunId");
CREATE INDEX "UsinaProductionFact_syncedAt_idx"
  ON "UsinaProductionFact"("syncedAt");

COMMIT;
