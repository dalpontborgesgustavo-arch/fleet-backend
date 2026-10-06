CREATE TABLE "UsinaMaterialStockValuation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "aethosCompanyId" INTEGER NOT NULL,
    "aethosItemId" INTEGER NOT NULL,
    "competence" DATE NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "openingQuantity" DECIMAL(18,6) NOT NULL,
    "validEntryQuantity" DECIMAL(18,6) NOT NULL,
    "validIssueQuantity" DECIMAL(18,6) NOT NULL,
    "cancellationAdjustmentQuantity" DECIMAL(18,6) NOT NULL,
    "netMovementQuantity" DECIMAL(18,6) NOT NULL,
    "closingQuantity" DECIMAL(18,6) NOT NULL,
    "openingAverageCost" DECIMAL(18,6),
    "closingAverageCost" DECIMAL(18,6),
    "sourceMaxMovementId" BIGINT,
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UsinaMaterialStockValuation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsinaMaterialStockValuation_source_check" CHECK ("source" = 'AETHOS'),
    CONSTRAINT "UsinaMaterialStockValuation_item_check" CHECK ("aethosItemId" = 968),
    CONSTRAINT "UsinaMaterialStockValuation_unit_check" CHECK ("quantityUnit" = 'M3'),
    CONSTRAINT "UsinaMaterialStockValuation_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
    CONSTRAINT "UsinaMaterialStockValuation_quantities_check" CHECK (
      "openingQuantity" >= 0 AND "validEntryQuantity" >= 0 AND
      "validIssueQuantity" >= 0 AND "closingQuantity" >= 0
    ),
    CONSTRAINT "UsinaMaterialStockValuation_costs_check" CHECK (
      ("openingAverageCost" IS NULL OR "openingAverageCost" >= 0) AND
      ("closingAverageCost" IS NULL OR "closingAverageCost" >= 0)
    ),
    CONSTRAINT "UsinaMaterialStockValuation_movement_check" CHECK (
      "netMovementQuantity" = "validEntryQuantity" - "validIssueQuantity" + "cancellationAdjustmentQuantity"
    ),
    CONSTRAINT "UsinaMaterialStockValuation_balance_check" CHECK (
      "closingQuantity" = "openingQuantity" + "netMovementQuantity"
    )
);

CREATE TABLE "UsinaMaterialStockValuationAudit" (
    "id" BIGSERIAL NOT NULL,
    "valuationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsinaMaterialStockValuationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsinaMaterialStockValuation_source_aethosCompanyId_aethosItemId_competence_key"
ON "UsinaMaterialStockValuation"("source", "aethosCompanyId", "aethosItemId", "competence");
CREATE INDEX "UsinaMaterialStockValuation_companyId_unitId_competence_active_idx"
ON "UsinaMaterialStockValuation"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaMaterialStockValuation_aethosCompanyId_aethosItemId_competence_active_idx"
ON "UsinaMaterialStockValuation"("aethosCompanyId", "aethosItemId", "competence", "active");
CREATE INDEX "UsinaMaterialStockValuation_lastSeenRunId_idx"
ON "UsinaMaterialStockValuation"("lastSeenRunId");
CREATE INDEX "UsinaMaterialStockValuation_syncedAt_idx"
ON "UsinaMaterialStockValuation"("syncedAt");
CREATE INDEX "UsinaMaterialStockValuationAudit_valuationId_changedAt_idx"
ON "UsinaMaterialStockValuationAudit"("valuationId", "changedAt");
CREATE INDEX "UsinaMaterialStockValuationAudit_syncRunId_idx"
ON "UsinaMaterialStockValuationAudit"("syncRunId");

ALTER TABLE "UsinaMaterialStockValuation"
ADD CONSTRAINT "UsinaMaterialStockValuation_lastSeenRunId_fkey"
FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UsinaMaterialStockValuationAudit"
ADD CONSTRAINT "UsinaMaterialStockValuationAudit_valuationId_fkey"
FOREIGN KEY ("valuationId") REFERENCES "UsinaMaterialStockValuation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
