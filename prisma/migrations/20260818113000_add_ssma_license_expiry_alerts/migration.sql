ALTER TABLE "SsmaLicense"
ADD COLUMN "alertDaysBefore" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "alertEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "alertSentForExpiry" TIMESTAMP(3),
ADD COLUMN "alertSentAt" TIMESTAMP(3),
ADD COLUMN "alertLastError" TEXT;

ALTER TABLE "SsmaLicense"
ADD CONSTRAINT "SsmaLicense_alertDaysBefore_check"
CHECK ("alertDaysBefore" >= 0 AND "alertDaysBefore" <= 3650);

CREATE INDEX "SsmaLicense_active_expiryDate_idx"
ON "SsmaLicense"("active", "expiryDate");
