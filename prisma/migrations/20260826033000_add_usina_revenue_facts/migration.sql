BEGIN;

CREATE TABLE "UsinaRevenueFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "revenueType" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceOrderId" TEXT,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "sourceLineId" TEXT,
  "aethosProductId" INTEGER NOT NULL,
  "productDescription" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "occurredDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "quantityOriginal" DECIMAL(18,6) NOT NULL,
  "quantityUnit" TEXT NOT NULL,
  "quantityTon" DECIMAL(18,6),
  "amount" DECIMAL(18,6) NOT NULL,
  "freightAmount" DECIMAL(18,6),
  "orderFreightAmount" DECIMAL(18,6),
  "historicalUnitCost" DECIMAL(18,6),
  "aethosCompanyId" INTEGER,
  "originFlag" TEXT,
  "personId" INTEGER,
  "entryExitFlag" TEXT,
  "weighingVehicleStatus" TEXT,
  "weighingStatus" TEXT,
  "tareTon" DECIMAL(18,6),
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
  CONSTRAINT "UsinaRevenueFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaRevenueFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaRevenueFact_source_check" CHECK ("source" = 'AETHOS'),
  CONSTRAINT "UsinaRevenueFact_type_check" CHECK ("revenueType" IN ('INTERNAL', 'EXTERNAL')),
  CONSTRAINT "UsinaRevenueFact_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaRevenueFact_competence_date_check" CHECK (
    "competence" = DATE_TRUNC('month', "occurredDate")::DATE
  ),
  CONSTRAINT "UsinaRevenueFact_product_check" CHECK ("aethosProductId" > 0),
  CONSTRAINT "UsinaRevenueFact_classification_check" CHECK (
    "classification" IN ('USINAGEM_SEM_CAP', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_50_70')
  ),
  CONSTRAINT "UsinaRevenueFact_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "UsinaRevenueFact_internal_check" CHECK (
    "revenueType" <> 'INTERNAL' OR (
      "quantityTon" IS NOT NULL AND "quantityTon" > 0 AND
      "aethosCompanyId" IS NOT NULL AND "aethosCompanyId" > 0 AND
      "weighingVehicleStatus" = 'FIN' AND "weighingStatus" = 'FIN'
    )
  ),
  CONSTRAINT "UsinaRevenueFact_external_key_check" CHECK (
    "revenueType" <> 'EXTERNAL' OR (
      "sourceOrderId" IS NOT NULL AND "sourceLineId" IS NOT NULL
    )
  ),
  CONSTRAINT "UsinaRevenueFact_deactivation_check" CHECK (
    "active" = TRUE OR "deactivatedAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "UsinaRevenueFact_source_type_record_key"
  ON "UsinaRevenueFact"("source", "revenueType", "sourceRecordId");
CREATE INDEX "UsinaRevenueFact_context_competence_type_active_idx"
  ON "UsinaRevenueFact"("companyId", "unitId", "competence", "revenueType", "active");
CREATE INDEX "UsinaRevenueFact_product_competence_idx"
  ON "UsinaRevenueFact"("aethosProductId", "competence");
CREATE INDEX "UsinaRevenueFact_classification_competence_idx"
  ON "UsinaRevenueFact"("classification", "competence");
CREATE INDEX "UsinaRevenueFact_document_item_idx"
  ON "UsinaRevenueFact"("sourceDocumentId", "sourceItemId");
CREATE INDEX "UsinaRevenueFact_order_line_idx"
  ON "UsinaRevenueFact"("sourceOrderId", "sourceLineId");
CREATE INDEX "UsinaRevenueFact_last_seen_run_idx"
  ON "UsinaRevenueFact"("lastSeenRunId");
CREATE INDEX "UsinaRevenueFact_synced_at_idx"
  ON "UsinaRevenueFact"("syncedAt");

COMMIT;
