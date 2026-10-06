ALTER TABLE "Vehicle"
  ADD COLUMN "aethos_vehicle_id" TEXT,
  ADD COLUMN "aethos_managed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aethos_company_id" TEXT,
  ADD COLUMN "aethos_synced_at" TIMESTAMPTZ(6),
  ADD COLUMN "aethos_raw" JSONB;

CREATE UNIQUE INDEX "Vehicle_aethos_vehicle_id_key"
  ON "Vehicle"("aethos_vehicle_id");

CREATE INDEX "Vehicle_aethos_managed_active_idx"
  ON "Vehicle"("aethos_managed", "active");

CREATE INDEX "Vehicle_aethos_synced_at_idx"
  ON "Vehicle"("aethos_synced_at");

CREATE TABLE "AethosVehicleSyncRun" (
  "id" BIGSERIAL NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload_hash" TEXT NOT NULL,
  "received_count" INTEGER NOT NULL,
  "created_count" INTEGER NOT NULL,
  "linked_count" INTEGER NOT NULL,
  "updated_count" INTEGER NOT NULL,
  "reactivated_count" INTEGER NOT NULL,
  "deactivated_count" INTEGER NOT NULL,
  "result" JSONB NOT NULL,
  CONSTRAINT "AethosVehicleSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosVehicleSyncRun_snapshot_id_key"
  ON "AethosVehicleSyncRun"("snapshot_id");

CREATE INDEX "AethosVehicleSyncRun_executed_at_idx"
  ON "AethosVehicleSyncRun"("executed_at");
