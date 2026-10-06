CREATE TABLE "OccurrenceValidation" (
  "id" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "photoUrl" TEXT NOT NULL,
  "validatedByUserId" TEXT NOT NULL,
  "validatedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccurrenceValidation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OccurrenceValidation_occurrenceId_createdAt_idx"
  ON "OccurrenceValidation"("occurrenceId", "createdAt");
CREATE INDEX "OccurrenceValidation_validatedByUserId_idx"
  ON "OccurrenceValidation"("validatedByUserId");
ALTER TABLE "OccurrenceValidation" ADD CONSTRAINT "OccurrenceValidation_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
