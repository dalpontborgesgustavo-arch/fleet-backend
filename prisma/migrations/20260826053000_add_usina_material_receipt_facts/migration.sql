BEGIN;

CREATE TABLE "UsinaMaterialReceiptFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceLineId" TEXT,
  "sourceFreightTypeId" INTEGER,
  "aethosMaterialId" INTEGER NOT NULL,
  "materialDescription" TEXT NOT NULL,
  "materialClass" TEXT NOT NULL,
  "movementType" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "occurredDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "quantityOriginal" DECIMAL(18,6) NOT NULL,
  "quantityUnit" TEXT NOT NULL,
  "quantityTon" DECIMAL(18,6),
  "materialUnitCost" DECIMAL(18,6),
  "materialAmount" DECIMAL(18,6),
  "freightQuantity" DECIMAL(18,6),
  "freightUnitCost" DECIMAL(18,6),
  "freightAmount" DECIMAL(18,6),
  "totalAmount" DECIMAL(18,6),
  "aethosCompanyId" INTEGER,
  "supplierId" INTEGER,
  "entryExitFlag" TEXT,
  "sourceStatus" TEXT NOT NULL,
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
  CONSTRAINT "UsinaMaterialReceiptFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMaterialReceiptFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMaterialReceiptFact_source_check" CHECK ("source" = 'AETHOS'),
  CONSTRAINT "UsinaMaterialReceiptFact_dataset_check" CHECK ("dataset" IN ('CAP_MOVEMENTS', 'AGGREGATE_RECEIPTS')),
  CONSTRAINT "UsinaMaterialReceiptFact_material_check" CHECK ("aethosMaterialId" > 0),
  CONSTRAINT "UsinaMaterialReceiptFact_class_check" CHECK ("materialClass" IN ('CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_ALTO_MODULO', 'BRITADO')),
  CONSTRAINT "UsinaMaterialReceiptFact_movement_check" CHECK ("movementType" IN ('ENTRY', 'DIRECT_EXIT')),
  CONSTRAINT "UsinaMaterialReceiptFact_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaMaterialReceiptFact_competence_date_check" CHECK ("competence" = DATE_TRUNC('month', "occurredDate")::DATE),
  CONSTRAINT "UsinaMaterialReceiptFact_quantity_check" CHECK ("quantityOriginal" > 0 AND ("quantityTon" IS NULL OR "quantityTon" > 0)),
  CONSTRAINT "UsinaMaterialReceiptFact_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "UsinaMaterialReceiptFact_cap_check" CHECK (
    "dataset" <> 'CAP_MOVEMENTS' OR (
      "materialClass" <> 'BRITADO' AND
      "sourceStatus" = 'FIN' AND
      ("tareTon" IS NULL OR "tareTon" <= 0)
    )
  ),
  CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check" CHECK (
    "dataset" <> 'AGGREGATE_RECEIPTS' OR (
      "materialClass" = 'BRITADO' AND
      "movementType" = 'ENTRY' AND
      "sourceLineId" IS NOT NULL AND
      "sourceFreightTypeId" = 2262 AND
      "sourceStatus" = 'F'
    )
  ),
  CONSTRAINT "UsinaMaterialReceiptFact_deactivation_check" CHECK ("active" = TRUE OR "deactivatedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "UsinaMaterialReceiptFact_source_dataset_record_key"
  ON "UsinaMaterialReceiptFact"("source", "dataset", "sourceRecordId");
CREATE INDEX "UsinaMaterialReceiptFact_context_competence_dataset_active_idx"
  ON "UsinaMaterialReceiptFact"("companyId", "unitId", "competence", "dataset", "active");
CREATE INDEX "UsinaMaterialReceiptFact_material_competence_movement_idx"
  ON "UsinaMaterialReceiptFact"("aethosMaterialId", "competence", "movementType");
CREATE INDEX "UsinaMaterialReceiptFact_class_competence_movement_idx"
  ON "UsinaMaterialReceiptFact"("materialClass", "competence", "movementType");
CREATE INDEX "UsinaMaterialReceiptFact_document_line_idx"
  ON "UsinaMaterialReceiptFact"("sourceDocumentId", "sourceLineId");
CREATE INDEX "UsinaMaterialReceiptFact_last_seen_run_idx"
  ON "UsinaMaterialReceiptFact"("lastSeenRunId");
CREATE INDEX "UsinaMaterialReceiptFact_synced_at_idx"
  ON "UsinaMaterialReceiptFact"("syncedAt");

COMMIT;
