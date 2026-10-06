-- Separate the maintenance notification target from the execution assignee.
ALTER TABLE "Occurrence" ADD COLUMN "maintenanceTargetUserId" TEXT;

CREATE INDEX "Occurrence_maintenanceTargetUserId_idx" ON "Occurrence"("maintenanceTargetUserId");
