ALTER TABLE "Checklist"
  ADD COLUMN "driverEmployeeKey" TEXT,
  ADD COLUMN "responsibleEmployeeKey" TEXT,
  ADD COLUMN "laborAssignments" JSONB;

ALTER TABLE "Vehicle"
  ADD COLUMN "currentDriverEmployeeKey" TEXT,
  ADD COLUMN "currentResponsibleEmployeeKey" TEXT;
