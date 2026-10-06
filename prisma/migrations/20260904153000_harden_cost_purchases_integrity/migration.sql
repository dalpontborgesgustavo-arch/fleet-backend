CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "CostPurchaseVehicleExpenseFact"
  ADD COLUMN "unitId" TEXT,
  ADD COLUMN "dataset" TEXT;

UPDATE "CostPurchaseVehicleExpenseFact" fact
SET
  "unitId" = COALESCE(run."scopeUnitId", 'FLEET'),
  "dataset" = 'COST_PURCHASE_VEHICLE_EXPENSES'
FROM "UsinaSyncRun" run
WHERE fact."lastSeenRunId" = run."id";

UPDATE "CostPurchaseVehicleExpenseFact"
SET
  "unitId" = COALESCE("unitId", 'FLEET'),
  "dataset" = COALESCE("dataset", 'COST_PURCHASE_VEHICLE_EXPENSES');

ALTER TABLE "CostPurchaseVehicleExpenseFact"
  ALTER COLUMN "unitId" SET NOT NULL,
  ALTER COLUMN "dataset" SET NOT NULL;

ALTER TABLE "CostPurchaseVehicleFuelFact"
  ADD COLUMN "unitId" TEXT,
  ADD COLUMN "dataset" TEXT;

UPDATE "CostPurchaseVehicleFuelFact" fact
SET
  "unitId" = COALESCE(run."scopeUnitId", 'FLEET'),
  "dataset" = 'COST_PURCHASE_VEHICLE_FUEL'
FROM "UsinaSyncRun" run
WHERE fact."lastSeenRunId" = run."id";

UPDATE "CostPurchaseVehicleFuelFact"
SET
  "unitId" = COALESCE("unitId", 'FLEET'),
  "dataset" = COALESCE("dataset", 'COST_PURCHASE_VEHICLE_FUEL');

ALTER TABLE "CostPurchaseVehicleFuelFact"
  ALTER COLUMN "unitId" SET NOT NULL,
  ALTER COLUMN "dataset" SET NOT NULL;

DROP INDEX "CostPurchaseVehicleExpenseFact_source_sourceRecordId_key";
DROP INDEX "CostPurchaseVehicleExpenseFact_companyId_competence_active_idx";
CREATE UNIQUE INDEX "CostPurchaseExpense_source_scope_dataset_record_key"
  ON "CostPurchaseVehicleExpenseFact"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE INDEX "CostPurchaseExpense_scope_competence_active_idx"
  ON "CostPurchaseVehicleExpenseFact"("companyId", "unitId", "dataset", "competence", "active");

DROP INDEX "CostPurchaseVehicleFuelFact_source_sourceRecordId_key";
DROP INDEX "CostPurchaseVehicleFuelFact_companyId_competence_active_idx";
CREATE UNIQUE INDEX "CostPurchaseFuel_source_scope_dataset_record_key"
  ON "CostPurchaseVehicleFuelFact"("source", "companyId", "unitId", "dataset", "sourceRecordId");
CREATE INDEX "CostPurchaseFuel_scope_competence_active_idx"
  ON "CostPurchaseVehicleFuelFact"("companyId", "unitId", "dataset", "competence", "active");

ALTER TABLE "CostPurchaseVehicleExpenseFact"
  ADD CONSTRAINT "CostPurchaseExpense_dataset_check"
  CHECK ("dataset" = 'COST_PURCHASE_VEHICLE_EXPENSES');

ALTER TABLE "CostPurchaseVehicleFuelFact"
  ADD CONSTRAINT "CostPurchaseFuel_dataset_check"
  CHECK ("dataset" = 'COST_PURCHASE_VEHICLE_FUEL');

ALTER TABLE "CostPurchaseReportException"
  ADD CONSTRAINT "CostPurchaseException_validity_check"
  CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  ADD CONSTRAINT "CostPurchaseException_identifier_type_check"
  CHECK ("identifierType" IN ('PLATE', 'FLEET')),
  ADD CONSTRAINT "CostPurchaseException_rate_group_check"
  CHECK ("rateGroup" IS NULL OR "rateGroup" IN ('VEICULOS', 'CAMINHOES', 'MAQUINAS'));

ALTER TABLE "CostPurchaseReportException"
  ADD CONSTRAINT "CostPurchaseException_no_overlap"
  EXCLUDE USING gist (
    "identifierType" WITH =,
    "identifierValue" WITH =,
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[)') WITH &&
  ) WHERE ("active" AND "deletedAt" IS NULL);

ALTER TABLE "CostPurchaseAllocationPolicy"
  ADD CONSTRAINT "CostPurchasePolicy_validity_check"
  CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  ADD CONSTRAINT "CostPurchasePolicy_shares_check"
  CHECK (
    "vehicleShare" >= 0 AND
    "truckShare" >= 0 AND
    "machineShare" >= 0 AND
    "vehicleShare" + "truckShare" + "machineShare" = 1.000000
  ),
  ADD CONSTRAINT "CostPurchasePolicy_fixed_values_check"
  CHECK ("maintenanceVehicleFixed" >= 0 AND "comboioPlateFixed" >= 0);

ALTER TABLE "CostPurchaseAllocationPolicy"
  ADD CONSTRAINT "CostPurchasePolicy_no_overlap"
  EXCLUDE USING gist (
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[)') WITH &&
  ) WHERE ("active");
