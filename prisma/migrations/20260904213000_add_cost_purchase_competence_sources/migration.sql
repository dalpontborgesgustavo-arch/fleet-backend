CREATE TABLE "CostPurchaseInternalConsumptionFact" (
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
    "planAccountId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "aethosItemId" INTEGER NOT NULL,
    "aethosVehicleId" INTEGER,
    "assetCode" TEXT,
    "quantity" DECIMAL(24,12),
    "unit" TEXT,
    "amount" DECIMAL(24,12) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "sourceContentHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostPurchaseInternalConsumptionFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CostPurchaseInternalConsumptionFact_dataset_check"
      CHECK ("dataset" = 'COST_PURCHASE_INTERNAL_CONSUMPTION'),
    CONSTRAINT "CostPurchaseInternalConsumptionFact_amount_check"
      CHECK ("amount" >= 0),
    CONSTRAINT "CostPurchaseInternalConsumptionFact_quantity_check"
      CHECK ("quantity" IS NULL OR "quantity" >= 0)
);

CREATE TABLE "CostPurchaseInternalConsumptionFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchaseInternalConsumptionFactAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchasePreventiveOrderFact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "competence" DATE NOT NULL,
    "documentNumber" TEXT,
    "aethosVehicleId" INTEGER,
    "assetCode" TEXT,
    "amount" DECIMAL(24,12) NOT NULL,
    "preventiveLinkIds" JSONB NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "sourceContentHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostPurchasePreventiveOrderFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CostPurchasePreventiveOrderFact_dataset_check"
      CHECK ("dataset" = 'COST_PURCHASE_PREVENTIVE_ORDERS'),
    CONSTRAINT "CostPurchasePreventiveOrderFact_amount_check"
      CHECK ("amount" >= 0),
    CONSTRAINT "CostPurchasePreventiveOrderFact_links_check"
      CHECK (jsonb_typeof("preventiveLinkIds") = 'array' AND jsonb_array_length("preventiveLinkIds") > 0)
);

CREATE TABLE "CostPurchasePreventiveOrderFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchasePreventiveOrderFactAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cp_internal_source_record_key"
ON "CostPurchaseInternalConsumptionFact"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE UNIQUE INDEX "cp_internal_header_item_key"
ON "CostPurchaseInternalConsumptionFact"("source", "companyId", "unitId", "dataset", "sourceHeaderId", "sourceItemId");
CREATE INDEX "CostPurchaseInternalConsumptionFact_companyId_unitId_dataset_competence_active_idx"
ON "CostPurchaseInternalConsumptionFact"("companyId", "unitId", "dataset", "competence", "active");
CREATE INDEX "CostPurchaseInternalConsumptionFact_planAccountId_categoryId_competence_active_idx"
ON "CostPurchaseInternalConsumptionFact"("planAccountId", "categoryId", "competence", "active");
CREATE INDEX "CostPurchaseInternalConsumptionFact_aethosItemId_competence_active_idx"
ON "CostPurchaseInternalConsumptionFact"("aethosItemId", "competence", "active");
CREATE INDEX "CostPurchaseInternalConsumptionFact_lastSeenRunId_idx"
ON "CostPurchaseInternalConsumptionFact"("lastSeenRunId");
CREATE INDEX "CostPurchaseInternalConsumptionFactAudit_factId_changedAt_idx"
ON "CostPurchaseInternalConsumptionFactAudit"("factId", "changedAt");
CREATE INDEX "CostPurchaseInternalConsumptionFactAudit_syncRunId_idx"
ON "CostPurchaseInternalConsumptionFactAudit"("syncRunId");

CREATE UNIQUE INDEX "cp_preventive_source_record_key"
ON "CostPurchasePreventiveOrderFact"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE UNIQUE INDEX "cp_preventive_order_key"
ON "CostPurchasePreventiveOrderFact"("source", "companyId", "unitId", "dataset", "orderId");
CREATE INDEX "CostPurchasePreventiveOrderFact_companyId_unitId_dataset_competence_active_idx"
ON "CostPurchasePreventiveOrderFact"("companyId", "unitId", "dataset", "competence", "active");
CREATE INDEX "CostPurchasePreventiveOrderFact_aethosVehicleId_competence_active_idx"
ON "CostPurchasePreventiveOrderFact"("aethosVehicleId", "competence", "active");
CREATE INDEX "CostPurchasePreventiveOrderFact_lastSeenRunId_idx"
ON "CostPurchasePreventiveOrderFact"("lastSeenRunId");
CREATE INDEX "CostPurchasePreventiveOrderFactAudit_factId_changedAt_idx"
ON "CostPurchasePreventiveOrderFactAudit"("factId", "changedAt");
CREATE INDEX "CostPurchasePreventiveOrderFactAudit_syncRunId_idx"
ON "CostPurchasePreventiveOrderFactAudit"("syncRunId");

ALTER TABLE "CostPurchaseInternalConsumptionFact"
ADD CONSTRAINT "CostPurchaseInternalConsumptionFact_lastSeenRunId_fkey"
FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseInternalConsumptionFactAudit"
ADD CONSTRAINT "CostPurchaseInternalConsumptionFactAudit_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "CostPurchaseInternalConsumptionFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostPurchasePreventiveOrderFact"
ADD CONSTRAINT "CostPurchasePreventiveOrderFact_lastSeenRunId_fkey"
FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostPurchasePreventiveOrderFactAudit"
ADD CONSTRAINT "CostPurchasePreventiveOrderFactAudit_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "CostPurchasePreventiveOrderFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
