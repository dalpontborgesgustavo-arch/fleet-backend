ALTER TABLE "User"
ADD COLUMN "canAccessFleetTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canAccessFleetOverview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canAccessBucketActivations" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET
  "canAccessFleetTracking" = true,
  "canAccessFleetOverview" = true,
  "canAccessBucketActivations" = true
WHERE LOWER("role") = 'financeiro';
