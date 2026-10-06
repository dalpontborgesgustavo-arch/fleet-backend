-- Persist daily bucket-activation snapshots so the UI reads JR data instead of
-- waiting for Moovsec and reverse geocoding on every page load.
CREATE TABLE "BucketActivationDailySnapshot" (
    "date" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "addressCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedAddressCount" INTEGER NOT NULL DEFAULT 0,
    "sourceSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucketActivationDailySnapshot_pkey" PRIMARY KEY ("date")
);

CREATE INDEX "BucketActivationDailySnapshot_sourceSyncedAt_idx"
ON "BucketActivationDailySnapshot"("sourceSyncedAt");
