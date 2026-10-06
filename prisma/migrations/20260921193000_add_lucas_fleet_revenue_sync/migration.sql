CREATE TABLE "LucasFleetRevenueSyncRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "ruleHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ(6) NOT NULL,
    "scopeDateFrom" DATE NOT NULL,
    "scopeDateToExclusive" DATE NOT NULL,
    "scopeBranches" TEXT[] NOT NULL,
    "scopeCompanies" TEXT[] NOT NULL,
    "scopeMetadata" JSONB NOT NULL,
    "snapshotStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "snapshotFinishedAt" TIMESTAMPTZ(6) NOT NULL,
    "snapshotComplete" BOOLEAN NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "allowedForPosting" BOOLEAN NOT NULL,
    "batchTotal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "receivedBatchCount" INTEGER NOT NULL DEFAULT 0,
    "receivedRecordCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedRecordCount" INTEGER,
    "finalizedAmountTotal" DECIMAL(65,30),
    "manifest" JSONB,
    "completedAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "LucasFleetRevenueSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LucasFleetRevenueSyncBatch" (
    "id" TEXT NOT NULL,
    "runDbId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "batchTotal" INTEGER NOT NULL,
    "producerPayloadHash" TEXT NOT NULL,
    "serverPayloadHash" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LucasFleetRevenueSyncBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LucasFleetRevenueStagingFact" (
    "id" TEXT NOT NULL,
    "runDbId" TEXT NOT NULL,
    "nativeLocator" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "nativeKey" JSONB NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "aethosVehicleId" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "competence" DATE NOT NULL,
    "amount" DECIMAL(65,30),
    "sourceStatus" TEXT,
    "active" BOOLEAN NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "planAccountId" TEXT,
    "recordHash" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LucasFleetRevenueStagingFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LucasFleetRevenueFact" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "nativeLocator" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "nativeKey" JSONB NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "aethosVehicleId" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "competence" DATE NOT NULL,
    "amount" DECIMAL(65,30),
    "sourceStatus" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "planAccountId" TEXT,
    "recordHash" TEXT NOT NULL,
    "raw" JSONB,
    "lastRunId" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "LucasFleetRevenueFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LucasFleetRevenueFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LucasFleetRevenueFactAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LucasFleetRevenueSyncRun_runId_key" ON "LucasFleetRevenueSyncRun"("runId");
CREATE UNIQUE INDEX "LucasFleetRevenueSyncRun_dataset_runId_key" ON "LucasFleetRevenueSyncRun"("dataset", "runId");
CREATE INDEX "LucasFleetRevenueSyncRun_status_generatedAt_idx" ON "LucasFleetRevenueSyncRun"("status", "generatedAt");
CREATE INDEX "LucasFleetRevenueSyncRun_scopeDateFrom_scopeDateToExclusive_idx" ON "LucasFleetRevenueSyncRun"("scopeDateFrom", "scopeDateToExclusive");

CREATE UNIQUE INDEX "LucasFleetRevenueSyncBatch_runDbId_batchNumber_key" ON "LucasFleetRevenueSyncBatch"("runDbId", "batchNumber");
CREATE INDEX "LucasFleetRevenueSyncBatch_producerPayloadHash_idx" ON "LucasFleetRevenueSyncBatch"("producerPayloadHash");
CREATE INDEX "LucasFleetRevenueSyncBatch_serverPayloadHash_idx" ON "LucasFleetRevenueSyncBatch"("serverPayloadHash");

CREATE UNIQUE INDEX "LucasFleetRevenueStagingFact_runDbId_nativeLocator_key" ON "LucasFleetRevenueStagingFact"("runDbId", "nativeLocator");
CREATE INDEX "LucasFleetRevenueStagingFact_runDbId_competence_idx" ON "LucasFleetRevenueStagingFact"("runDbId", "competence");
CREATE INDEX "LucasFleetRevenueStagingFact_aethosVehicleId_competence_idx" ON "LucasFleetRevenueStagingFact"("aethosVehicleId", "competence");

CREATE UNIQUE INDEX "LucasFleetRevenueFact_dataset_source_nativeLocator_key" ON "LucasFleetRevenueFact"("dataset", "source", "nativeLocator");
CREATE INDEX "LucasFleetRevenueFact_aethosVehicleId_competence_active_idx" ON "LucasFleetRevenueFact"("aethosVehicleId", "competence", "active");
CREATE INDEX "LucasFleetRevenueFact_companyId_competence_active_idx" ON "LucasFleetRevenueFact"("companyId", "competence", "active");
CREATE INDEX "LucasFleetRevenueFact_lastRunId_idx" ON "LucasFleetRevenueFact"("lastRunId");

CREATE INDEX "LucasFleetRevenueFactAudit_factId_changedAt_idx" ON "LucasFleetRevenueFactAudit"("factId", "changedAt");
CREATE INDEX "LucasFleetRevenueFactAudit_syncRunId_idx" ON "LucasFleetRevenueFactAudit"("syncRunId");

ALTER TABLE "LucasFleetRevenueSyncBatch"
  ADD CONSTRAINT "LucasFleetRevenueSyncBatch_runDbId_fkey"
  FOREIGN KEY ("runDbId") REFERENCES "LucasFleetRevenueSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LucasFleetRevenueStagingFact"
  ADD CONSTRAINT "LucasFleetRevenueStagingFact_runDbId_fkey"
  FOREIGN KEY ("runDbId") REFERENCES "LucasFleetRevenueSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LucasFleetRevenueFact"
  ADD CONSTRAINT "LucasFleetRevenueFact_lastRunId_fkey"
  FOREIGN KEY ("lastRunId") REFERENCES "LucasFleetRevenueSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LucasFleetRevenueFactAudit"
  ADD CONSTRAINT "LucasFleetRevenueFactAudit_factId_fkey"
  FOREIGN KEY ("factId") REFERENCES "LucasFleetRevenueFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
