ALTER TABLE "Vehicle"
ADD COLUMN "currentDriverName" TEXT,
ADD COLUMN "currentResponsibleName" TEXT;

ALTER TABLE "Checklist"
ADD COLUMN "driverName" TEXT,
ADD COLUMN "responsibleName" TEXT,
ADD COLUMN "vehicleStopped" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VehicleAssignmentHistory" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "previousDriverName" TEXT,
    "driverName" TEXT,
    "previousResponsibleName" TEXT,
    "responsibleName" TEXT NOT NULL,
    "vehicleStopped" BOOLEAN NOT NULL DEFAULT false,
    "driverChanged" BOOLEAN NOT NULL DEFAULT false,
    "responsibleChanged" BOOLEAN NOT NULL DEFAULT false,
    "notificationRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notificationSentAt" TIMESTAMP(3),
    "notificationError" TEXT,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleAssignmentHistory_checklistId_key"
ON "VehicleAssignmentHistory"("checklistId");

CREATE INDEX "VehicleAssignmentHistory_vehicleId_createdAt_idx"
ON "VehicleAssignmentHistory"("vehicleId", "createdAt");

CREATE INDEX "VehicleAssignmentHistory_createdAt_idx"
ON "VehicleAssignmentHistory"("createdAt");

ALTER TABLE "VehicleAssignmentHistory"
ADD CONSTRAINT "VehicleAssignmentHistory_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleAssignmentHistory"
ADD CONSTRAINT "VehicleAssignmentHistory_checklistId_fkey"
FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
