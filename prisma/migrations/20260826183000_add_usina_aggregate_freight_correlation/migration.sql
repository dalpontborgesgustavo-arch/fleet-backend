BEGIN;

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD COLUMN "documentPartyId" INTEGER,
  ADD COLUMN "physicalSourcePartyId" INTEGER,
  ADD COLUMN "sourceTicketId" TEXT;

CREATE INDEX "UsinaMaterialReceiptFact_sourceTicketId_idx"
  ON "UsinaMaterialReceiptFact"("sourceTicketId");

ALTER TABLE "UsinaMaterialReceiptFact"
  ADD CONSTRAINT "UsinaMaterialReceiptFact_correlated_freight_check" CHECK (
    "sourceFreightTypeId" IS NULL OR
    "sourceFreightTypeId" NOT IN (2062, 2364, 2677) OR (
      "dataset" = 'AGGREGATE_RECEIPTS' AND
      "aethosMaterialId" = 968 AND
      "documentPartyId" IS NOT NULL AND
      "physicalSourcePartyId" = 3092 AND
      LENGTH(BTRIM(COALESCE("sourceTicketId", ''))) > 0
    )
  );

COMMENT ON COLUMN "UsinaMaterialReceiptFact"."documentPartyId" IS
  'Pessoa do documento fiscal preservada separadamente da origem fisica';
COMMENT ON COLUMN "UsinaMaterialReceiptFact"."physicalSourcePartyId" IS
  'Origem fisica correlacionada do material; 3092 para os fretes Pedraforte validados';
COMMENT ON COLUMN "UsinaMaterialReceiptFact"."sourceTicketId" IS
  'Ticket/pesagem de origem usado na correlacao documental do recebimento';

COMMIT;
