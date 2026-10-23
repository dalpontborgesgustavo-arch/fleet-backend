CREATE TABLE "DudaObservation" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceRowId" TEXT,
    "manualEntryId" TEXT,
    "kind" TEXT NOT NULL,
    "referenceMonth" TEXT NOT NULL,
    "targetMonth" TEXT,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "rowSnapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    CONSTRAINT "DudaObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DudaObservation_one_row_source" CHECK (("sourceRowId" IS NULL) <> ("manualEntryId" IS NULL)),
    CONSTRAINT "DudaObservation_kind_check" CHECK ("kind" = 'RECEIPT_DELAY'),
    CONSTRAINT "DudaObservation_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
    CONSTRAINT "DudaObservation_reference_month_check" CHECK ("referenceMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "DudaObservation_target_month_check" CHECK ("targetMonth" IS NULL OR "targetMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "DudaObservation_only_postponed_month_check" CHECK ("targetMonth" IS NULL OR "targetMonth" > "referenceMonth")
);

CREATE TABLE "DudaObservationRevision" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaObservationRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DudaObservation_sourceRowId_kind_referenceMonth_key" ON "DudaObservation"("sourceRowId", "kind", "referenceMonth");
CREATE UNIQUE INDEX "DudaObservation_manualEntryId_kind_referenceMonth_key" ON "DudaObservation"("manualEntryId", "kind", "referenceMonth");
CREATE INDEX "DudaObservation_importId_status_referenceMonth_idx" ON "DudaObservation"("importId", "status", "referenceMonth");
CREATE INDEX "DudaObservation_importId_kind_referenceMonth_idx" ON "DudaObservation"("importId", "kind", "referenceMonth");
CREATE UNIQUE INDEX "DudaObservationRevision_observationId_version_key" ON "DudaObservationRevision"("observationId", "version");
CREATE INDEX "DudaObservationRevision_observationId_changedAt_idx" ON "DudaObservationRevision"("observationId", "changedAt");

ALTER TABLE "DudaObservation" ADD CONSTRAINT "DudaObservation_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DudaBdGeralImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaObservation" ADD CONSTRAINT "DudaObservation_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "DudaBdGeralRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaObservation" ADD CONSTRAINT "DudaObservation_manualEntryId_fkey" FOREIGN KEY ("manualEntryId") REFERENCES "DudaBdGeralManualEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaObservationRevision" ADD CONSTRAINT "DudaObservationRevision_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "DudaObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
