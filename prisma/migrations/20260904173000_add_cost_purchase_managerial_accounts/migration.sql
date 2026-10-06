ALTER TABLE "CostPurchaseVehicleFuelFact"
  ADD COLUMN "planAccountId" INTEGER;

CREATE INDEX "CostPurchaseFuel_plan_competence_active_idx"
  ON "CostPurchaseVehicleFuelFact"("planAccountId", "competence", "active");

CREATE TABLE "CostPurchaseManagerialEntryFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceHeaderId" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "documentDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "documentNumber" TEXT,
  "sourceStatus" TEXT NOT NULL,
  "aethosItemId" INTEGER NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(24,12),
  "totalValue" DECIMAL(24,12) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostPurchaseManagerialEntryFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostPurchaseManagerialEntry_dataset_check"
    CHECK ("dataset" = 'cost-purchases-managerial-entry-items'),
  CONSTRAINT "CostPurchaseManagerialEntry_status_check"
    CHECK ("sourceStatus" = 'F')
);

CREATE UNIQUE INDEX "CostPurchaseManagerialEntry_source_scope_dataset_record_key"
  ON "CostPurchaseManagerialEntryFact"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE INDEX "CostPurchaseManagerialEntry_scope_competence_active_idx"
  ON "CostPurchaseManagerialEntryFact"("companyId", "unitId", "dataset", "competence", "active");
CREATE INDEX "CostPurchaseManagerialEntry_item_competence_active_idx"
  ON "CostPurchaseManagerialEntryFact"("aethosItemId", "competence", "active");
CREATE INDEX "CostPurchaseManagerialEntry_lastSeenRunId_idx"
  ON "CostPurchaseManagerialEntryFact"("lastSeenRunId");

ALTER TABLE "CostPurchaseManagerialEntryFact"
  ADD CONSTRAINT "CostPurchaseManagerialEntryFact_lastSeenRunId_fkey"
  FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CostPurchaseManagerialEntryFactAudit" (
  "id" BIGSERIAL NOT NULL,
  "factId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostPurchaseManagerialEntryFactAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CostPurchaseManagerialEntryFactAudit_factId_changedAt_idx"
  ON "CostPurchaseManagerialEntryFactAudit"("factId", "changedAt");
CREATE INDEX "CostPurchaseManagerialEntryFactAudit_syncRunId_idx"
  ON "CostPurchaseManagerialEntryFactAudit"("syncRunId");
ALTER TABLE "CostPurchaseManagerialEntryFactAudit"
  ADD CONSTRAINT "CostPurchaseManagerialEntryFactAudit_factId_fkey"
  FOREIGN KEY ("factId") REFERENCES "CostPurchaseManagerialEntryFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CostPurchaseManagerialItemMapping" (
  "id" TEXT NOT NULL,
  "aethosItemId" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMPTZ(6),
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CostPurchaseManagerialItemMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostPurchaseManagerialMapping_validity_check"
    CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  CONSTRAINT "CostPurchaseManagerialMapping_category_check"
    CHECK ("category" IN ('CAL','OLEO_RESIVALE','ANTIADERENTE_REMOTIN','CAP','RR','SEMI_IMPRIMA','DIESEL'))
);
CREATE UNIQUE INDEX "CostPurchaseManagerialItemMapping_aethosItemId_validFrom_key"
  ON "CostPurchaseManagerialItemMapping"("aethosItemId", "validFrom");
CREATE INDEX "CostPurchaseManagerialItemMapping_category_validity_active_idx"
  ON "CostPurchaseManagerialItemMapping"("category", "validFrom", "validTo", "active");
CREATE INDEX "CostPurchaseManagerialItemMapping_item_active_idx"
  ON "CostPurchaseManagerialItemMapping"("aethosItemId", "active");

CREATE TABLE "CostPurchaseManagerialItemMappingAudit" (
  "id" BIGSERIAL NOT NULL,
  "mappingId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "actorId" TEXT,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostPurchaseManagerialItemMappingAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CostPurchaseManagerialItemMappingAudit_mappingId_changedAt_idx"
  ON "CostPurchaseManagerialItemMappingAudit"("mappingId", "changedAt");
ALTER TABLE "CostPurchaseManagerialItemMappingAudit"
  ADD CONSTRAINT "CostPurchaseManagerialItemMappingAudit_mappingId_fkey"
  FOREIGN KEY ("mappingId") REFERENCES "CostPurchaseManagerialItemMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CostPurchaseManagerialQuarantine" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "competence" DATE,
  "reasonCode" TEXT NOT NULL,
  "reasonDetail" TEXT,
  "payloadHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "resolvedAt" TIMESTAMPTZ(6),
  "resolvedBy" TEXT,
  "syncRunId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CostPurchaseManagerialQuarantine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostPurchaseManagerialQuarantine_source_scope_dataset_record_key"
  ON "CostPurchaseManagerialQuarantine"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE INDEX "CostPurchaseManagerialQuarantine_dataset_competence_active_idx"
  ON "CostPurchaseManagerialQuarantine"("dataset", "competence", "active");
CREATE INDEX "CostPurchaseManagerialQuarantine_reasonCode_active_idx"
  ON "CostPurchaseManagerialQuarantine"("reasonCode", "active");

CREATE TABLE "CostPurchaseManagerialQuarantineAudit" (
  "id" BIGSERIAL NOT NULL,
  "quarantineId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostPurchaseManagerialQuarantineAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CostPurchaseManagerialQuarantineAudit_quarantineId_changedAt_idx"
  ON "CostPurchaseManagerialQuarantineAudit"("quarantineId", "changedAt");
CREATE INDEX "CostPurchaseManagerialQuarantineAudit_syncRunId_idx"
  ON "CostPurchaseManagerialQuarantineAudit"("syncRunId");
ALTER TABLE "CostPurchaseManagerialQuarantineAudit"
  ADD CONSTRAINT "CostPurchaseManagerialQuarantineAudit_quarantineId_fkey"
  FOREIGN KEY ("quarantineId") REFERENCES "CostPurchaseManagerialQuarantine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH seed("aethosItemId", "category") AS (
  VALUES
    (2023,'CAL'),(14093,'CAL'),(14129,'CAL'),
    (3024,'OLEO_RESIVALE'),
    (11944,'ANTIADERENTE_REMOTIN'),(15019,'ANTIADERENTE_REMOTIN'),
    (1813,'CAP'),(5525,'CAP'),(5643,'CAP'),(11734,'CAP'),(13861,'CAP'),(15309,'CAP'),(16234,'CAP'),(17555,'CAP'),(17556,'CAP'),
    (1281,'RR'),(13718,'RR'),
    (1808,'SEMI_IMPRIMA'),(8412,'SEMI_IMPRIMA'),(13720,'SEMI_IMPRIMA'),
    (11,'DIESEL'),(4816,'DIESEL'),(5254,'DIESEL'),(5255,'DIESEL'),(10067,'DIESEL'),(11031,'DIESEL'),(12934,'DIESEL'),(13370,'DIESEL'),(13376,'DIESEL'),(14378,'DIESEL'),(16363,'DIESEL')
), inserted AS (
  INSERT INTO "CostPurchaseManagerialItemMapping" (
    "id", "aethosItemId", "category", "validFrom", "reason", "active", "createdBy", "updatedAt"
  )
  SELECT
    md5('cost-purchases-managerial:' || "aethosItemId"::text || ':2025-01-01')::uuid::text,
    "aethosItemId", "category", DATE '2025-01-01',
    'Mapeamento inicial aprovado em CUSTOS-COMPRAS-SRV-005', true, 'SYSTEM_MIGRATION', CURRENT_TIMESTAMP
  FROM seed
  RETURNING *
)
INSERT INTO "CostPurchaseManagerialItemMappingAudit" (
  "mappingId", "operation", "afterData", "actorId"
)
SELECT "id", 'CREATE', to_jsonb(inserted), 'SYSTEM_MIGRATION' FROM inserted;
