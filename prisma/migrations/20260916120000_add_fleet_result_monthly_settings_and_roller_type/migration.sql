DO $$
BEGIN
  CREATE TYPE "RollerType" AS ENUM ('CHAPA', 'PNEU', 'TERRAPLANAGEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "rollerType" "RollerType";

CREATE OR REPLACE FUNCTION public.vehicle_registration_audit_snapshot(row_data "Vehicle")
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'name', row_data."name",
        'plate', row_data."plate",
        'model', row_data."model",
        'fleet', row_data."fleet",
        'group', row_data."group",
        'subgroup', row_data."subgroup",
        'rollerType', row_data."rollerType",
        'company', row_data."company",
        'type', row_data."type",
        'vehicleType', row_data."vehicleType",
        'tipoFrota', row_data."tipoFrota",
        'filial', row_data."filial",
        'active', row_data."active",
        'checklistEnabled', row_data."checklist_enabled",
        'photoUrl', row_data."photoUrl",
        'responsibleName', row_data."responsibleName",
        'responsibleEmail', row_data."responsibleEmail",
        'currentDriverName', row_data."currentDriverName",
        'currentResponsibleName', row_data."currentResponsibleName",
        'monthlyChecklistResponsibleId', row_data."monthly_checklist_responsible_id",
        'hasTimeClockDevice', row_data."hasTimeClockDevice",
        'veiculoManutencao', row_data."veiculo_manutencao",
        'aethosVehicleId', row_data."aethos_vehicle_id",
        'aethosManaged', row_data."aethos_managed",
        'aethosCompanyId', row_data."aethos_company_id"
    );
$$;

CREATE TABLE IF NOT EXISTS "FleetResultMonthlySetting" (
  "id" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "groupKey" TEXT NOT NULL,
  "maintenancePlanned" DECIMAL(18,2),
  "dieselPlanned" DECIMAL(18,2),
  "depreciationPlanned" DECIMAL(18,2),
  "laborPlanned" DECIMAL(18,2),
  "revenuePlanned" DECIMAL(18,2),
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetResultMonthlySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FleetResultMonthlySetting_competence_groupKey_key"
  ON "FleetResultMonthlySetting"("competence", "groupKey");
CREATE INDEX IF NOT EXISTS "FleetResultMonthlySetting_competence_idx"
  ON "FleetResultMonthlySetting"("competence");

CREATE TABLE IF NOT EXISTS "FleetResultMonthlySettingAudit" (
  "id" BIGSERIAL NOT NULL,
  "settingId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "beforeData" JSONB,
  "afterData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FleetResultMonthlySettingAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FleetResultMonthlySettingAudit_settingId_createdAt_idx"
  ON "FleetResultMonthlySettingAudit"("settingId", "createdAt");
DO $$
BEGIN
  ALTER TABLE "FleetResultMonthlySettingAudit"
    ADD CONSTRAINT "FleetResultMonthlySettingAudit_settingId_fkey"
    FOREIGN KEY ("settingId") REFERENCES "FleetResultMonthlySetting"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
