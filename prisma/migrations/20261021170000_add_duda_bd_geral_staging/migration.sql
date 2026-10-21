-- Immutable staging of the source worksheet. This is intentionally separate
-- from operational billing tables until Duda validates the row semantics.
CREATE TABLE "DudaBdGeralImport" (
    "id" TEXT NOT NULL,
    "sourceWorkbookSha256" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL,
    "physicalRowCount" INTEGER NOT NULL,
    "detailCandidateCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaBdGeralImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DudaBdGeralRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "excelRow" INTEGER NOT NULL,
    "rowSha256" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "hiddenByFilter" BOOLEAN NOT NULL,
    "legacyItem" TEXT,
    "serviceMonth" TEXT,
    "engineer" TEXT,
    "contractNumber" TEXT,
    "clientName" TEXT,
    "municipality" TEXT,
    "workName" TEXT,
    "billingMonth" TEXT,
    "expectedReceiptMonth" TEXT,
    "receivedMonthText" TEXT,
    "cells" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaBdGeralRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DudaBdGeralImport_sourceWorkbookSha256_key" ON "DudaBdGeralImport"("sourceWorkbookSha256");
CREATE INDEX "DudaBdGeralImport_status_createdAt_idx" ON "DudaBdGeralImport"("status", "createdAt");
CREATE UNIQUE INDEX "DudaBdGeralRow_importId_excelRow_key" ON "DudaBdGeralRow"("importId", "excelRow");
CREATE INDEX "DudaBdGeralRow_importId_classification_excelRow_idx" ON "DudaBdGeralRow"("importId", "classification", "excelRow");
CREATE INDEX "DudaBdGeralRow_importId_serviceMonth_idx" ON "DudaBdGeralRow"("importId", "serviceMonth");
CREATE INDEX "DudaBdGeralRow_importId_legacyItem_idx" ON "DudaBdGeralRow"("importId", "legacyItem");
CREATE INDEX "DudaBdGeralRow_importId_clientName_idx" ON "DudaBdGeralRow"("importId", "clientName");
CREATE INDEX "DudaBdGeralRow_importId_workName_idx" ON "DudaBdGeralRow"("importId", "workName");
ALTER TABLE "DudaBdGeralRow" ADD CONSTRAINT "DudaBdGeralRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DudaBdGeralImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
