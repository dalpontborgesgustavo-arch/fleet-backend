ALTER TABLE "ChecklistTemplate"
ADD COLUMN "fleetNumbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "ChecklistTemplate_vehicleType_idx"
ON "ChecklistTemplate"("vehicleType");

CREATE INDEX "ChecklistTemplate_fleetNumbers_idx"
ON "ChecklistTemplate" USING GIN ("fleetNumbers");
