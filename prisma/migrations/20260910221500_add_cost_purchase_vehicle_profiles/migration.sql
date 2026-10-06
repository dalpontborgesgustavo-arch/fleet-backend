CREATE TABLE "CostPurchaseVehicleProfile" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "group" TEXT,
    "subgroup" TEXT,
    "company" TEXT,
    "tipo_frota" TEXT NOT NULL,
    "vehicle_type" TEXT NOT NULL,
    "filial" "Filial" NOT NULL,
    "keep_monthly_cost_report" BOOLEAN NOT NULL DEFAULT true,
    "veiculo_manutencao" BOOLEAN NOT NULL DEFAULT false,
    "changed_by_user_id" TEXT,
    "changed_by_name" TEXT,
    "changed_by_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CostPurchaseVehicleProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostPurchaseVehicleProfile_vehicle_id_effective_from_key"
ON "CostPurchaseVehicleProfile"("vehicle_id", "effective_from");

CREATE INDEX "CostPurchaseVehicleProfile_vehicle_id_effective_from_idx"
ON "CostPurchaseVehicleProfile"("vehicle_id", "effective_from");

ALTER TABLE "CostPurchaseVehicleProfile"
ADD CONSTRAINT "CostPurchaseVehicleProfile_vehicle_id_fkey"
FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
