ALTER TABLE "Occurrence"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledById" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledByName" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

CREATE TABLE IF NOT EXISTS "OccurrenceComment" (
  "id" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccurrenceComment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OccurrenceComment_occurrenceId_fkey'
  ) THEN
    ALTER TABLE "OccurrenceComment"
      ADD CONSTRAINT "OccurrenceComment_occurrenceId_fkey"
      FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Occurrence_cancelledAt_idx"
  ON "Occurrence"("cancelledAt");
CREATE INDEX IF NOT EXISTS "OccurrenceComment_occurrenceId_idx"
  ON "OccurrenceComment"("occurrenceId");
CREATE INDEX IF NOT EXISTS "OccurrenceComment_authorId_idx"
  ON "OccurrenceComment"("authorId");
CREATE INDEX IF NOT EXISTS "OccurrenceComment_createdAt_idx"
  ON "OccurrenceComment"("createdAt");
