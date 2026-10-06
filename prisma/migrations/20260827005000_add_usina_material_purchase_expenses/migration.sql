BEGIN;

ALTER TABLE "UsinaOperationalCostFact"
  ADD COLUMN "materialEntryId" INTEGER,
  ADD COLUMN "materialEntryItemId" INTEGER,
  ADD COLUMN "sourceNoteNumber" TEXT,
  ADD COLUMN "receivedDate" DATE,
  ADD COLUMN "quantityOriginal" DECIMAL(18, 6),
  ADD COLUMN "quantityOriginalUnit" TEXT,
  ADD COLUMN "quantityTon" DECIMAL(18, 6),
  ADD COLUMN "unitPriceOriginal" DECIMAL(18, 6),
  ADD COLUMN "unitPriceTon" DECIMAL(18, 6),
  ADD COLUMN "sourceItemTotal" DECIMAL(18, 6),
  ADD COLUMN "quantityNormalizationBasis" TEXT,
  ADD COLUMN "priceNormalizationBasis" TEXT,
  ADD COLUMN "competenceBasis" TEXT;

ALTER TABLE "UsinaOperationalCostFact"
  DROP CONSTRAINT "UsinaOperationalCostFact_dataset_check";

ALTER TABLE "UsinaOperationalCostFact"
  ADD CONSTRAINT "UsinaOperationalCostFact_dataset_check"
  CHECK (
    "dataset" IN (
      'VEHICLE_EXPENSES',
      'PAYABLE_EXPENSES',
      'LABOR_COSTS',
      'INTERNAL_CONSUMPTION_EXPENSES',
      'MATERIAL_PURCHASE_EXPENSES'
    )
  );

ALTER TABLE "UsinaOperationalCostFact"
  ADD CONSTRAINT "UsinaOperationalCostFact_material_purchase_check"
  CHECK (
    "dataset" <> 'MATERIAL_PURCHASE_EXPENSES' OR (
      "source" = 'AETHOS'
      AND "costClass" = 'CAL_CH1'
      AND "sourceDocumentType" = 'NF_ENTRADA'
      AND "materialEntryId" IS NOT NULL
      AND "materialEntryItemId" IS NOT NULL
      AND "aethosItemId" = 2023
      AND "accountPlanId" IS NULL
      AND "sourceStatus" = 'F'
      AND "competence" = DATE_TRUNC('month', "occurredDate")::date
      AND "amount" > 0
      AND "quantity" > 0
      AND "quantityUnit" = 'TN'
      AND "quantityOriginal" > 0
      AND "quantityOriginalUnit" IS NOT NULL
      AND "quantityTon" > 0
      AND "unitPriceOriginal" > 0
      AND "unitPriceTon" > 0
      AND "sourceItemTotal" > 0
      AND "quantityNormalizationBasis" IS NOT NULL
      AND "priceNormalizationBasis" IS NOT NULL
      AND "competenceBasis" IS NOT NULL
      AND "amount" = ROUND("quantityTon" * "unitPriceTon", 2)
    )
  );

CREATE INDEX "UsinaOperationalCostFact_material_entry_idx"
  ON "UsinaOperationalCostFact"("materialEntryId", "materialEntryItemId");

COMMIT;
