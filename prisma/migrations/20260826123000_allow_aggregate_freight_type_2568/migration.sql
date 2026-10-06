BEGIN;

ALTER TABLE "UsinaMaterialReceiptFact"
  DROP CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check";

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check" CHECK (
    "dataset" <> 'AGGREGATE_RECEIPTS' OR (
      "materialClass" = 'BRITADO' AND
      "movementType" = 'ENTRY' AND
      "sourceLineId" IS NOT NULL AND
      "sourceFreightTypeId" IN (2262, 2568) AND
      "sourceStatus" = 'F'
    )
  );

COMMIT;
