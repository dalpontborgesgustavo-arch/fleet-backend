CREATE TABLE "DudaObservationSourceRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "excelRow" INTEGER NOT NULL,
    "rowSha256" TEXT NOT NULL,
    "trackingMonth" TEXT,
    "sectionLabel" TEXT NOT NULL,
    "groupLabel" TEXT,
    "workName" TEXT,
    "municipality" TEXT,
    "cells" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaObservationSourceRow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DudaObservationSourceRow_sha_check" CHECK ("rowSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "DudaObservationSourceRow_month_check" CHECK ("trackingMonth" IS NULL OR "trackingMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX "DudaObservationSourceRow_importId_excelRow_key" ON "DudaObservationSourceRow"("importId", "excelRow");
CREATE INDEX "DudaObservationSourceRow_importId_trackingMonth_excelRow_idx" ON "DudaObservationSourceRow"("importId", "trackingMonth", "excelRow");
ALTER TABLE "DudaObservationSourceRow" ADD CONSTRAINT "DudaObservationSourceRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DudaBdGeralImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
