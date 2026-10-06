ALTER TABLE "User"
ADD COLUMN "canAccessFleetUtilization" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canAccessFleetAlerts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canAccessFleetVideo" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET
  "canAccessFleetUtilization" = "canAccessFleetOverview",
  "canAccessFleetAlerts" = "canAccessFleetOverview",
  "canAccessFleetVideo" = "canAccessFleetOverview"
WHERE "role" ILIKE 'financeiro';
