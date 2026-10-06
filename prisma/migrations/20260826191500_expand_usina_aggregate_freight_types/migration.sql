BEGIN;

ALTER TABLE "UsinaMaterialReceiptFact"
  DROP CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check";

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check" CHECK (
    "dataset" <> 'AGGREGATE_RECEIPTS' OR (
      "materialClass" = 'BRITADO' AND
      "movementType" = 'ENTRY' AND
      "sourceLineId" IS NOT NULL AND
      "sourceFreightTypeId" IN (2062, 2262, 2364, 2568, 2677) AND
      "sourceStatus" = 'F'
    )
  );

COMMENT ON CONSTRAINT "UsinaMaterialReceiptFact_aggregate_check"
  ON "UsinaMaterialReceiptFact" IS
  'Aceita as rotas autoritativas 2262/2568 e as rotas correlacionadas 2062/2364/2677; as correlacionadas tambem obedecem UsinaMaterialReceiptFact_correlated_freight_check';

COMMIT;
