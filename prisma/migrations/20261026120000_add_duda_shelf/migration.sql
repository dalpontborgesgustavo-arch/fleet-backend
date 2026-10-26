CREATE TABLE "DudaShelfEntry" (
    "id" TEXT NOT NULL,
    "sourceSha256" TEXT,
    "sourceExcelRow" INTEGER,
    "previousEntryId" TEXT,
    "trackingMonth" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "workName" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "invoicedOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "DudaShelfEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DudaShelfEntry_month_check" CHECK ("trackingMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "DudaShelfEntry_status_check" CHECK ("status" IN ('HISTORICAL', 'OPEN', 'INVOICED')),
    CONSTRAINT "DudaShelfEntry_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "DudaShelfEntry_source_check" CHECK (("sourceSha256" IS NULL) = ("sourceExcelRow" IS NULL)),
    CONSTRAINT "DudaShelfEntry_source_sha_check" CHECK ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "DudaShelfEntry_invoice_check" CHECK (("status" = 'INVOICED') = ("invoicedOn" IS NOT NULL))
);
CREATE TABLE "DudaShelfRevision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaShelfRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DudaShelfEntry_sourceSha256_sourceExcelRow_key" ON "DudaShelfEntry"("sourceSha256", "sourceExcelRow");
CREATE UNIQUE INDEX "DudaShelfEntry_previousEntryId_key" ON "DudaShelfEntry"("previousEntryId");
CREATE INDEX "DudaShelfEntry_trackingMonth_status_idx" ON "DudaShelfEntry"("trackingMonth", "status");
CREATE INDEX "DudaShelfEntry_trackingMonth_workName_idx" ON "DudaShelfEntry"("trackingMonth", "workName");
CREATE UNIQUE INDEX "DudaShelfRevision_entryId_version_key" ON "DudaShelfRevision"("entryId", "version");
CREATE INDEX "DudaShelfRevision_entryId_changedAt_idx" ON "DudaShelfRevision"("entryId", "changedAt");
ALTER TABLE "DudaShelfEntry" ADD CONSTRAINT "DudaShelfEntry_previousEntryId_fkey" FOREIGN KEY ("previousEntryId") REFERENCES "DudaShelfEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DudaShelfRevision" ADD CONSTRAINT "DudaShelfRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DudaShelfEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
