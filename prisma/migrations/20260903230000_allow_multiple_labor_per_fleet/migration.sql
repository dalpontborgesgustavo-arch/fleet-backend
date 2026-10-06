-- Uma frota pode ter varias pessoas trabalhando no mesmo periodo.
-- O bloqueio permanece apenas para o mesmo colaborador duplicado na mesma frota.
ALTER TABLE "UsinaAsphaltFleetOperatorAssignment"
  DROP CONSTRAINT IF EXISTS "UsinaAsphaltFleetOperatorAssignment_no_fleet_overlap";

ALTER TABLE "UsinaAsphaltFleetOperatorAssignment"
  ADD CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_no_fleet_overlap"
  EXCLUDE USING gist (
    "fleetAssignmentId" WITH =,
    "employeeKey" WITH =,
    daterange("validFrom", "validTo", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);
