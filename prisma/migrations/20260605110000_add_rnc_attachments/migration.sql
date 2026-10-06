ALTER TYPE "RncHistoryAction" ADD VALUE IF NOT EXISTS 'ATTACHMENT_ADDED';

CREATE TABLE IF NOT EXISTS "RncAttachment" (
    "id" TEXT NOT NULL,
    "rncId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RncAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'RncAttachment_rncId_fkey'
    ) THEN
        ALTER TABLE "RncAttachment"
        ADD CONSTRAINT "RncAttachment_rncId_fkey"
        FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'RncAttachment_uploadedById_fkey'
    ) THEN
        ALTER TABLE "RncAttachment"
        ADD CONSTRAINT "RncAttachment_uploadedById_fkey"
        FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RncAttachment_rncId_idx" ON "RncAttachment"("rncId");
CREATE INDEX IF NOT EXISTS "RncAttachment_uploadedById_idx" ON "RncAttachment"("uploadedById");
CREATE INDEX IF NOT EXISTS "RncAttachment_createdAt_idx" ON "RncAttachment"("createdAt");
