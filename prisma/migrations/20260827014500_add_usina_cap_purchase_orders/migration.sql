BEGIN;

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD COLUMN "sourceUsedQuantity" DECIMAL(18,6),
  ADD COLUMN "sourceBalanceQuantity" DECIMAL(18,6),
  ADD COLUMN "sourceDiscountAmount" DECIMAL(18,6);

ALTER TABLE "UsinaMaterialReceiptFact"
  DROP CONSTRAINT "UsinaMaterialReceiptFact_dataset_check";

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_dataset_check"
  CHECK ("dataset" IN ('CAP_MOVEMENTS', 'AGGREGATE_RECEIPTS', 'CAP_PURCHASE_ORDERS'));

ALTER TABLE "UsinaMaterialReceiptFact"
  DROP CONSTRAINT "UsinaMaterialReceiptFact_reporting_family_check";

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_reporting_family_check"
  CHECK (
    "reportingFamily" IS NULL OR
    "reportingFamily" IN (
      'CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_ALTO_MODULO'
    )
  );

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_cap_purchase_check"
  CHECK (
    "dataset" <> 'CAP_PURCHASE_ORDERS' OR (
      "materialClass" IN ('CAP_50_70', 'CAP_BORRACHA', 'CAP_POLIMERO', 'CAP_ALTO_MODULO') AND
      "movementType" = 'ENTRY' AND
      "sourceLineId" IS NOT NULL AND
      "sourceFreightTypeId" IS NULL AND
      "sourceStatus" = 'F' AND
      "quantityUnit" = 'TN' AND
      "quantityTon" > 0 AND
      "materialUnitCost" > 0 AND
      "materialAmount" = ROUND("quantityTon" * "materialUnitCost", 2)
    )
  );

UPDATE "UsinaMaterialReceiptFact"
SET "reportingFamily" = 'CAP_ALTO_MODULO'
WHERE "materialClass" = 'CAP_ALTO_MODULO'
  AND "reportingFamily" IS DISTINCT FROM 'CAP_ALTO_MODULO';

CREATE INDEX "UsinaMaterialReceiptFact_purchase_class_competence_idx"
  ON "UsinaMaterialReceiptFact"("dataset", "materialClass", "competence", "active");

CREATE TABLE "UsinaMaterialReceiptFactAudit" (
  "id" BIGSERIAL NOT NULL,
  "factId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaMaterialReceiptFactAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMaterialReceiptFactAudit_operation_check"
    CHECK ("operation" IN ('CREATE', 'UPDATE', 'DEACTIVATE')),
  CONSTRAINT "UsinaMaterialReceiptFactAudit_factId_fkey"
    FOREIGN KEY ("factId") REFERENCES "UsinaMaterialReceiptFact"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "UsinaMaterialReceiptFactAudit_fact_changed_idx"
  ON "UsinaMaterialReceiptFactAudit"("factId", "changedAt");
CREATE INDEX "UsinaMaterialReceiptFactAudit_sync_run_idx"
  ON "UsinaMaterialReceiptFactAudit"("syncRunId");

COMMIT;
