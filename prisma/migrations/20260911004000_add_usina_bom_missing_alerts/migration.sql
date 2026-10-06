CREATE TABLE "UsinaBomMissingAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "aethosProductId" INTEGER NOT NULL,
    "productDescription" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenCompetence" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "recipientUserId" TEXT,
    "recipientEmail" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UsinaBomMissingAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsinaBomMissingAlert_companyId_unitId_aethosProductId_key"
ON "UsinaBomMissingAlert"("companyId", "unitId", "aethosProductId");

CREATE INDEX "UsinaBomMissingAlert_status_sentAt_idx"
ON "UsinaBomMissingAlert"("status", "sentAt");

CREATE INDEX "UsinaBomMissingAlert_resolvedAt_lastSeenAt_idx"
ON "UsinaBomMissingAlert"("resolvedAt", "lastSeenAt");

CREATE INDEX "UsinaBomMissingAlert_recipientUserId_idx"
ON "UsinaBomMissingAlert"("recipientUserId");
