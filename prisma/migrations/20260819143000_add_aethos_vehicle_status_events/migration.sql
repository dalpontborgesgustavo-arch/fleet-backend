CREATE TABLE "AethosVehicleStatusEvent" (
  "id" BIGSERIAL NOT NULL,
  "aethos_event_id" TEXT NOT NULL,
  "aethos_vehicle_id" TEXT NOT NULL,
  "vehicle_id" TEXT,
  "company_id" TEXT NOT NULL,
  "fleet" TEXT,
  "plate" TEXT,
  "previous_status" TEXT NOT NULL,
  "current_status" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL,
  "changed_by_user_id" TEXT,
  "changed_by_login" TEXT,
  "changed_by_name" TEXT,
  "effective_end_at" TIMESTAMPTZ(6),
  "inactive_reason" TEXT,
  "source" TEXT,
  "application_status" TEXT NOT NULL,
  "application_message" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(6),
  "raw" JSONB NOT NULL,

  CONSTRAINT "AethosVehicleStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosVehicleStatusEvent_aethos_event_id_key"
  ON "AethosVehicleStatusEvent"("aethos_event_id");

CREATE INDEX "AethosVehicleStatusEvent_aethos_vehicle_id_changed_at_idx"
  ON "AethosVehicleStatusEvent"("aethos_vehicle_id", "changed_at");

CREATE INDEX "AethosVehicleStatusEvent_vehicle_id_changed_at_idx"
  ON "AethosVehicleStatusEvent"("vehicle_id", "changed_at");

CREATE INDEX "AethosVehicleStatusEvent_application_status_idx"
  ON "AethosVehicleStatusEvent"("application_status");

ALTER TABLE "AethosVehicleStatusEvent"
  ADD CONSTRAINT "AethosVehicleStatusEvent_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
