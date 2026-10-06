CREATE TABLE "AethosContract" (
    "id" TEXT NOT NULL,
    "aethosId" TEXT NOT NULL,
    "quotationAethosId" TEXT,
    "companyAethosId" TEXT NOT NULL,
    "workAethosId" TEXT NOT NULL,
    "workName" TEXT NOT NULL,
    "contractorAethosId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "originalValue" DECIMAL(18,2) NOT NULL,
    "statusCode" TEXT NOT NULL,
    "statusDescription" TEXT NOT NULL,
    "notes" TEXT,
    "engineerAethosId" TEXT,
    "engineerName" TEXT,
    "retentionValue" DECIMAL(18,2),
    "anticipatedRetentionValue" DECIMAL(18,2),
    "retentionBalance" DECIMAL(18,2),
    "totalMeasuredValue" DECIMAL(18,2),
    "payableBalance" DECIMAL(18,2),
    "measurementBalance" DECIMAL(18,2),
    "contractBalance" DECIMAL(18,2),
    "contractQuantity" DECIMAL(18,4),
    "movesFinancial" BOOLEAN,
    "returnsWorkBalance" BOOLEAN,
    "accountPlanAethosId" TEXT,
    "accountPlanName" TEXT,
    "cancellationReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AETHOS',
    "contentHash" TEXT NOT NULL,
    "lastSeenSyncId" TEXT,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AethosContractAttachment" (
    "id" TEXT NOT NULL,
    "aethosId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "documentAethosId" TEXT NOT NULL,
    "documentTypeAethos" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "description" TEXT,
    "extension" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "md5" TEXT,
    "includedAt" TIMESTAMP(3),
    "storageType" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "fileReceivedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'AETHOS',
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosContractAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosContract_aethosId_key" ON "AethosContract"("aethosId");
CREATE INDEX "AethosContract_companyAethosId_idx" ON "AethosContract"("companyAethosId");
CREATE INDEX "AethosContract_workAethosId_idx" ON "AethosContract"("workAethosId");
CREATE INDEX "AethosContract_contractorAethosId_idx" ON "AethosContract"("contractorAethosId");
CREATE INDEX "AethosContract_statusCode_idx" ON "AethosContract"("statusCode");
CREATE INDEX "AethosContract_active_idx" ON "AethosContract"("active");
CREATE INDEX "AethosContract_syncedAt_idx" ON "AethosContract"("syncedAt");
CREATE INDEX "AethosContract_lastSeenSyncId_idx" ON "AethosContract"("lastSeenSyncId");

CREATE UNIQUE INDEX "AethosContractAttachment_aethosId_key" ON "AethosContractAttachment"("aethosId");
CREATE INDEX "AethosContractAttachment_contractId_idx" ON "AethosContractAttachment"("contractId");
CREATE INDEX "AethosContractAttachment_active_idx" ON "AethosContractAttachment"("active");
CREATE INDEX "AethosContractAttachment_md5_idx" ON "AethosContractAttachment"("md5");
CREATE INDEX "AethosContractAttachment_syncedAt_idx" ON "AethosContractAttachment"("syncedAt");

ALTER TABLE "AethosContractAttachment"
ADD CONSTRAINT "AethosContractAttachment_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "AethosContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
