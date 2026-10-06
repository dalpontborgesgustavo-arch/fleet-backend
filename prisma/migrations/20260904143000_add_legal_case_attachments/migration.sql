CREATE TABLE "LegalCaseAttachment" (
    "id" UUID NOT NULL,
    "legalCaseId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "deletedByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalCaseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalCaseAttachment_fileKey_key"
ON "LegalCaseAttachment"("fileKey");

CREATE INDEX "LegalCaseAttachment_legalCaseId_active_createdAt_idx"
ON "LegalCaseAttachment"("legalCaseId", "active", "createdAt");

CREATE INDEX "LegalCaseAttachment_uploadedById_createdAt_idx"
ON "LegalCaseAttachment"("uploadedById", "createdAt");

ALTER TABLE "LegalCaseAttachment"
ADD CONSTRAINT "LegalCaseAttachment_legalCaseId_fkey"
FOREIGN KEY ("legalCaseId") REFERENCES "LegalCase"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
