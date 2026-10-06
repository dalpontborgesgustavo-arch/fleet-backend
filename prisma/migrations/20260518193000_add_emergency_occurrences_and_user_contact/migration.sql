ALTER TABLE "User"
ADD COLUMN "phone" TEXT,
ADD COLUMN "city" TEXT;

ALTER TABLE "Occurrence"
ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Occurrence_isEmergency_idx" ON "Occurrence"("isEmergency");
