ALTER TABLE "Vehicle"
ADD COLUMN "checklist_enabled" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "Vehicle"."checklist_enabled" IS
    'Define se o veiculo participa dos checklists diario e mensal.';

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

SELECT set_config('app.vehicle_audit_source', 'MIGRATION', false);
SELECT set_config(
    'app.vehicle_audit_user_name',
    'Configuracao inicial de veiculos sem checklist',
    false
);

UPDATE "Vehicle"
SET
    "checklist_enabled" = false,
    "monthly_checklist_responsible_id" = NULL
WHERE UPPER(BTRIM(COALESCE("subgroup", ''))) = 'CARRETINHA REBOQUE';

SELECT set_config('app.vehicle_audit_source', '', false);
SELECT set_config('app.vehicle_audit_user_name', '', false);
