ALTER TABLE "UsinaSyncRun" ADD COLUMN "scopeMetadata" JSONB;

CREATE TABLE "UsinaMaterialReceiptException" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceTicketId" TEXT NOT NULL,
  "sourceVehicleWeighingId" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "occurredDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "finalizedAt" TIMESTAMPTZ(6),
  "plate" TEXT NOT NULL,
  "sourcePartyId" INTEGER NOT NULL,
  "sourcePartyName" TEXT NOT NULL,
  "aethosItemId" INTEGER NOT NULL,
  "itemDescription" TEXT NOT NULL,
  "materialClass" TEXT NOT NULL,
  "quantityOriginal" DECIMAL(18,6) NOT NULL,
  "quantityUnit" TEXT NOT NULL,
  "sourceDirection" TEXT,
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "correlatedEntryId" BIGINT,
  "correlatedEntryItemId" BIGINT,
  "correlatedFreightTypeId" INTEGER,
  "correlatedEntryQuantityOriginal" DECIMAL(18,6),
  "correlatedEntryQuantityUnit" TEXT,
  "sourceUpdatedAt" TIMESTAMPTZ(6) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaMaterialReceiptException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMaterialReceiptException_dataset_check" CHECK ("dataset" = 'AGGREGATE_RECEIPT_EXCEPTIONS'),
  CONSTRAINT "UsinaMaterialReceiptException_source_check" CHECK ("source" = 'AETHOS'),
  CONSTRAINT "UsinaMaterialReceiptException_material_check" CHECK ("aethosItemId" = 968 AND "materialClass" = 'PO_DE_PEDRA'),
  CONSTRAINT "UsinaMaterialReceiptException_quantity_check" CHECK ("quantityOriginal" > 0 AND "quantityUnit" = 'M3'),
  CONSTRAINT "UsinaMaterialReceiptException_reason_check" CHECK ("reasonCode" IN ('NO_FINAL_ENTRY_MATCH', 'UNCONFIRMED_FREIGHT_TYPE')),
  CONSTRAINT "UsinaMaterialReceiptException_correlation_check" CHECK (
    ("reasonCode" = 'NO_FINAL_ENTRY_MATCH' AND "correlatedEntryId" IS NULL AND "correlatedEntryItemId" IS NULL AND "correlatedFreightTypeId" IS NULL AND "correlatedEntryQuantityOriginal" IS NULL AND "correlatedEntryQuantityUnit" IS NULL)
    OR
    ("reasonCode" = 'UNCONFIRMED_FREIGHT_TYPE' AND "correlatedEntryId" IS NOT NULL AND "correlatedEntryItemId" IS NOT NULL AND "correlatedFreightTypeId" IS NOT NULL AND "correlatedFreightTypeId" NOT IN (2262, 2568) AND "correlatedEntryQuantityOriginal" > 0 AND "correlatedEntryQuantityUnit" IS NOT NULL)
  ),
  CONSTRAINT "UsinaMaterialReceiptException_active_check" CHECK (("active" = true AND "deactivatedAt" IS NULL) OR "active" = false)
);

CREATE TABLE "UsinaMaterialReceiptExceptionAudit" (
  "id" BIGSERIAL NOT NULL,
  "exceptionId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaMaterialReceiptExceptionAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMaterialReceiptExceptionAudit_operation_check" CHECK ("operation" IN ('CREATE', 'UPDATE', 'DEACTIVATE'))
);

CREATE UNIQUE INDEX "UsinaMaterialReceiptException_source_sourceRecordId_key"
  ON "UsinaMaterialReceiptException"("source", "sourceRecordId");
CREATE INDEX "UsinaMaterialReceiptException_companyId_unitId_competence_active_idx"
  ON "UsinaMaterialReceiptException"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaMaterialReceiptException_sourcePartyId_aethosItemId_occurredDate_active_idx"
  ON "UsinaMaterialReceiptException"("sourcePartyId", "aethosItemId", "occurredDate", "active");
CREATE INDEX "UsinaMaterialReceiptException_reasonCode_competence_active_idx"
  ON "UsinaMaterialReceiptException"("reasonCode", "competence", "active");
CREATE INDEX "UsinaMaterialReceiptException_lastSeenRunId_idx"
  ON "UsinaMaterialReceiptException"("lastSeenRunId");
CREATE INDEX "UsinaMaterialReceiptExceptionAudit_exceptionId_changedAt_idx"
  ON "UsinaMaterialReceiptExceptionAudit"("exceptionId", "changedAt");
CREATE INDEX "UsinaMaterialReceiptExceptionAudit_syncRunId_idx"
  ON "UsinaMaterialReceiptExceptionAudit"("syncRunId");

ALTER TABLE "UsinaMaterialReceiptException"
  ADD CONSTRAINT "UsinaMaterialReceiptException_lastSeenRunId_fkey"
  FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsinaMaterialReceiptExceptionAudit"
  ADD CONSTRAINT "UsinaMaterialReceiptExceptionAudit_exceptionId_fkey"
  FOREIGN KEY ("exceptionId") REFERENCES "UsinaMaterialReceiptException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
