ALTER TABLE "ChecklistConsent"
  ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastReminderError" TEXT,
  ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ChecklistConsentToken" (
  "id" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'INITIAL',
  "expiresAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChecklistConsentToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChecklistConsentToken_tokenHash_key"
  ON "ChecklistConsentToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "ChecklistConsentToken_consentId_idx"
  ON "ChecklistConsentToken"("consentId");

CREATE INDEX IF NOT EXISTS "ChecklistConsentToken_expiresAt_idx"
  ON "ChecklistConsentToken"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ChecklistConsentToken_consentId_fkey'
  ) THEN
    ALTER TABLE "ChecklistConsentToken"
      ADD CONSTRAINT "ChecklistConsentToken_consentId_fkey"
      FOREIGN KEY ("consentId") REFERENCES "ChecklistConsent"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ChecklistConsentToken" ("id", "consentId", "tokenHash", "kind", "expiresAt", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), "id", "tokenHash", 'INITIAL', "expiresAt", "createdAt"
FROM "ChecklistConsent" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "ChecklistConsentToken" t
  WHERE t."tokenHash" = c."tokenHash"
);
