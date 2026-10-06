CREATE TABLE "VehicleRegistrationAudit" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "changed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "before_data" JSONB,
    "after_data" JSONB,
    "changed_by_user_id" TEXT,
    "changed_by_name" TEXT,
    "changed_by_email" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleRegistrationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleRegistrationAudit_vehicle_id_changed_at_idx"
    ON "VehicleRegistrationAudit"("vehicle_id", "changed_at");

CREATE INDEX "VehicleRegistrationAudit_changed_at_idx"
    ON "VehicleRegistrationAudit"("changed_at");

COMMENT ON TABLE "VehicleRegistrationAudit" IS
    'Trilha imutavel das alteracoes cadastrais de veiculos, independentemente da origem.';

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

INSERT INTO "VehicleRegistrationAudit" (
    "vehicle_id",
    "operation",
    "source",
    "changed_fields",
    "after_data",
    "changed_by_name"
)
SELECT
    vehicle."id",
    'BASELINE',
    'MIGRATION',
    ARRAY(
        SELECT jsonb_object_keys(public.vehicle_registration_audit_snapshot(vehicle))
        ORDER BY 1
    ),
    public.vehicle_registration_audit_snapshot(vehicle),
    'Implantacao da auditoria cadastral'
FROM "Vehicle" vehicle;

CREATE OR REPLACE FUNCTION public.audit_vehicle_registration_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_snapshot JSONB;
    new_snapshot JSONB;
    fields TEXT[];
    audit_source TEXT;
    actor_user_id TEXT;
    actor_name TEXT;
    actor_email TEXT;
    record_id TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_snapshot := public.vehicle_registration_audit_snapshot(OLD);
    END IF;

    IF TG_OP <> 'DELETE' THEN
        new_snapshot := public.vehicle_registration_audit_snapshot(NEW);
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::TEXT[])
        INTO fields
        FROM jsonb_object_keys(new_snapshot) AS key
        WHERE old_snapshot -> key IS DISTINCT FROM new_snapshot -> key;

        IF cardinality(fields) = 0 THEN
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        SELECT array_agg(key ORDER BY key)
        INTO fields
        FROM jsonb_object_keys(new_snapshot) AS key;
    ELSE
        SELECT array_agg(key ORDER BY key)
        INTO fields
        FROM jsonb_object_keys(old_snapshot) AS key;
    END IF;

    audit_source := COALESCE(
        NULLIF(current_setting('app.vehicle_audit_source', true), ''),
        'DATABASE'
    );
    actor_user_id := NULLIF(current_setting('app.vehicle_audit_user_id', true), '');
    actor_name := NULLIF(current_setting('app.vehicle_audit_user_name', true), '');
    actor_email := NULLIF(current_setting('app.vehicle_audit_user_email', true), '');

    IF actor_name IS NULL THEN
        actor_name := CASE
            WHEN audit_source = 'AETHOS' THEN 'Integracao Aethos'
            WHEN audit_source = 'MIGRATION' THEN 'Migracao de banco'
            ELSE current_user
        END;
    END IF;

    record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;

    INSERT INTO "VehicleRegistrationAudit" (
        "vehicle_id",
        "operation",
        "source",
        "changed_fields",
        "before_data",
        "after_data",
        "changed_by_user_id",
        "changed_by_name",
        "changed_by_email",
        "changed_at"
    ) VALUES (
        record_id,
        TG_OP,
        audit_source,
        fields,
        old_snapshot,
        new_snapshot,
        actor_user_id,
        actor_name,
        actor_email,
        clock_timestamp()
    );

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "Vehicle_registration_audit_trigger" ON "Vehicle";

CREATE TRIGGER "Vehicle_registration_audit_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "Vehicle"
FOR EACH ROW
EXECUTE FUNCTION public.audit_vehicle_registration_changes();
