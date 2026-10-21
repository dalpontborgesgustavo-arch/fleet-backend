CREATE TABLE "DudaBdGeralManualEntry" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceRowId" TEXT,
    "cells" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "DudaBdGeralManualEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DudaBdGeralManualEntryRevision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "beforeCells" JSONB,
    "afterCells" JSONB NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaBdGeralManualEntryRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DudaBdGeralManualEntry_sourceRowId_key" ON "DudaBdGeralManualEntry"("sourceRowId");
CREATE INDEX "DudaBdGeralManualEntry_importId_createdAt_idx" ON "DudaBdGeralManualEntry"("importId", "createdAt");
CREATE UNIQUE INDEX "DudaBdGeralManualEntryRevision_entryId_version_key" ON "DudaBdGeralManualEntryRevision"("entryId", "version");
CREATE INDEX "DudaBdGeralManualEntryRevision_entryId_changedAt_idx" ON "DudaBdGeralManualEntryRevision"("entryId", "changedAt");
ALTER TABLE "DudaBdGeralManualEntry" ADD CONSTRAINT "DudaBdGeralManualEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DudaBdGeralImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaBdGeralManualEntry" ADD CONSTRAINT "DudaBdGeralManualEntry_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "DudaBdGeralRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaBdGeralManualEntryRevision" ADD CONSTRAINT "DudaBdGeralManualEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DudaBdGeralManualEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
