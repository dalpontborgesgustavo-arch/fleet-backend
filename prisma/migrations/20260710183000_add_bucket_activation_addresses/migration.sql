-- CreateTable
CREATE TABLE "BucketActivationAddress" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "raw" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucketActivationAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BucketActivationAddress_key_key" ON "BucketActivationAddress"("key");

-- CreateIndex
CREATE INDEX "BucketActivationAddress_latitude_longitude_idx" ON "BucketActivationAddress"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "BucketActivationAddress_resolvedAt_idx" ON "BucketActivationAddress"("resolvedAt");
