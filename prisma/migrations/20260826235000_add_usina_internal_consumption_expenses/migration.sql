BEGIN;

ALTER TABLE "UsinaOperationalCostFact"
  ADD COLUMN "internalConsumptionId" INTEGER,
  ADD COLUMN "internalConsumptionItemId" INTEGER,
  ADD COLUMN "aethosItemId" INTEGER,
  ADD COLUMN "itemDescription" TEXT,
  ADD COLUMN "itemCategoryId" INTEGER,
  ADD COLUMN "itemCategoryDescription" TEXT,
  ADD COLUMN "sourceDirection" TEXT,
  ADD COLUMN "selectionBasis" TEXT;

ALTER TABLE "UsinaOperationalCostFact"
  DROP CONSTRAINT "UsinaOperationalCostFact_dataset_check";

ALTER TABLE "UsinaOperationalCostFact"
  ADD CONSTRAINT "UsinaOperationalCostFact_dataset_check"
  CHECK (
    "dataset" IN (
      'VEHICLE_EXPENSES',
      'PAYABLE_EXPENSES',
      'LABOR_COSTS',
      'INTERNAL_CONSUMPTION_EXPENSES'
    )
  );

ALTER TABLE "UsinaOperationalCostFact"
  ADD CONSTRAINT "UsinaOperationalCostFact_internal_consumption_check"
  CHECK (
    "dataset" <> 'INTERNAL_CONSUMPTION_EXPENSES' OR (
      "source" = 'AETHOS'
      AND "costClass" = 'MATERIAL_EXPEDIENTE'
      AND "accountPlanId" = 1236
      AND "internalConsumptionId" IS NOT NULL
      AND "internalConsumptionItemId" IS NOT NULL
      AND "aethosItemId" IS NOT NULL
      AND "itemCategoryId" IS NOT NULL
      AND "sourceStatus" = 'E'
      AND "sourceDirection" = 'S'
      AND "selectionBasis" IS NOT NULL
    )
  );

CREATE INDEX "UsinaOperationalCostFact_internal_consumption_idx"
  ON "UsinaOperationalCostFact"("internalConsumptionId", "internalConsumptionItemId");
CREATE INDEX "UsinaOperationalCostFact_item_competence_idx"
  ON "UsinaOperationalCostFact"("aethosItemId", "competence");
CREATE INDEX "UsinaOperationalCostFact_category_competence_idx"
  ON "UsinaOperationalCostFact"("itemCategoryId", "competence");

CREATE TABLE "UsinaOperationalCostFactAudit" (
  "id" BIGSERIAL NOT NULL,
  "factId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaOperationalCostFactAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaOperationalCostFactAudit_factId_fkey"
    FOREIGN KEY ("factId") REFERENCES "UsinaOperationalCostFact"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaOperationalCostFactAudit_operation_check"
    CHECK ("operation" IN ('CREATE', 'UPDATE', 'DEACTIVATE'))
);

CREATE INDEX "UsinaOperationalCostFactAudit_fact_changed_idx"
  ON "UsinaOperationalCostFactAudit"("factId", "changedAt");
CREATE INDEX "UsinaOperationalCostFactAudit_sync_run_idx"
  ON "UsinaOperationalCostFactAudit"("syncRunId");

COMMIT;
