ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "responsibleName" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleEmail" TEXT;

ALTER TABLE "Checklist"
  ADD COLUMN IF NOT EXISTS "fleetPhotos" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChecklistConsentStatus') THEN
    CREATE TYPE "ChecklistConsentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ChecklistConsent" (
  "id" TEXT NOT NULL,
  "checklistId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "responsibleName" TEXT,
  "responsibleEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "ChecklistConsentStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "lastEmailError" TEXT,
  "consentedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "note" TEXT,
  "responseIp" TEXT,
  "responseUserAgent" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChecklistConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChecklistConsent_checklistId_key"
  ON "ChecklistConsent"("checklistId");

CREATE UNIQUE INDEX IF NOT EXISTS "ChecklistConsent_tokenHash_key"
  ON "ChecklistConsent"("tokenHash");

CREATE INDEX IF NOT EXISTS "ChecklistConsent_vehicleId_idx"
  ON "ChecklistConsent"("vehicleId");

CREATE INDEX IF NOT EXISTS "ChecklistConsent_status_idx"
  ON "ChecklistConsent"("status");

CREATE INDEX IF NOT EXISTS "ChecklistConsent_responsibleEmail_idx"
  ON "ChecklistConsent"("responsibleEmail");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChecklistConsent_checklistId_fkey'
  ) THEN
    ALTER TABLE "ChecklistConsent"
      ADD CONSTRAINT "ChecklistConsent_checklistId_fkey"
      FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChecklistConsent_vehicleId_fkey'
  ) THEN
    ALTER TABLE "ChecklistConsent"
      ADD CONSTRAINT "ChecklistConsent_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
