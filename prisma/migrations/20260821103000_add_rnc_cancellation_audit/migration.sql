ALTER TABLE "Rnc"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelledByName" TEXT,
  ADD COLUMN "cancelledByEmail" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

CREATE INDEX "Rnc_cancelledAt_idx" ON "Rnc"("cancelledAt");
