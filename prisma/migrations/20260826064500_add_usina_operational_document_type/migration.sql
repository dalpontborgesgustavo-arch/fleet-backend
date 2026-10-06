ALTER TABLE "UsinaOperationalCostFact"
  ADD COLUMN IF NOT EXISTS "sourceDocumentType" TEXT;

CREATE INDEX IF NOT EXISTS "UsinaOperationalCostFact_sourceDocumentType_sourceDocumentId_idx"
  ON "UsinaOperationalCostFact"("sourceDocumentType", "sourceDocumentId");
