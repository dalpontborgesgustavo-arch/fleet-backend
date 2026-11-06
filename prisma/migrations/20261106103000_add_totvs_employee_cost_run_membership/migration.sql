CREATE TABLE "TotvsEmployeeCostRunManifest" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TotvsEmployeeCostRunManifest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TotvsEmployeeCostRunManifest_competence_check"
        CHECK (EXTRACT(DAY FROM "competence") = 1),
    CONSTRAINT "TotvsEmployeeCostRunManifest_row_count_check"
        CHECK ("rowCount" >= 0),
    CONSTRAINT "TotvsEmployeeCostRunManifest_hash_check"
        CHECK (LENGTH("contentHash") = 64)
);

CREATE TABLE "TotvsEmployeeCostRunMembership" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TotvsEmployeeCostRunMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TotvsEmployeeCostRunManifest_run_competence_key"
ON "TotvsEmployeeCostRunManifest"("syncRunId", "competence");
CREATE INDEX "TotvsEmployeeCostRunManifest_syncRunId_idx"
ON "TotvsEmployeeCostRunManifest"("syncRunId");
CREATE INDEX "TotvsEmployeeCostRunManifest_competence_idx"
ON "TotvsEmployeeCostRunManifest"("competence");
CREATE UNIQUE INDEX "TotvsEmployeeCostRunMembership_manifest_aggregate_key"
ON "TotvsEmployeeCostRunMembership"("manifestId", "aggregateId");
CREATE INDEX "TotvsEmployeeCostRunMembership_manifestId_idx"
ON "TotvsEmployeeCostRunMembership"("manifestId");
CREATE INDEX "TotvsEmployeeCostRunMembership_aggregateId_idx"
ON "TotvsEmployeeCostRunMembership"("aggregateId");

ALTER TABLE "TotvsEmployeeCostRunManifest"
ADD CONSTRAINT "TotvsEmployeeCostRunManifest_syncRunId_fkey"
FOREIGN KEY ("syncRunId") REFERENCES "TotvsEmployeeSyncRun"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TotvsEmployeeCostRunMembership"
ADD CONSTRAINT "TotvsEmployeeCostRunMembership_manifestId_fkey"
FOREIGN KEY ("manifestId") REFERENCES "TotvsEmployeeCostRunManifest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TotvsEmployeeCostRunMembership"
ADD CONSTRAINT "TotvsEmployeeCostRunMembership_aggregateId_fkey"
FOREIGN KEY ("aggregateId") REFERENCES "TotvsEmployeeCostAggregate"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "guard_totvs_employee_cost_run_manifest"() RETURNS trigger AS $$
DECLARE
    run_status TEXT;
    run_query_code TEXT;
    run_context_code TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "status", "queryCode", "contextCode"
        INTO run_status, run_query_code, run_context_code
        FROM "TotvsEmployeeSyncRun"
        WHERE "id" = NEW."syncRunId";
        IF run_status IS DISTINCT FROM 'RUNNING' OR
           run_query_code IS DISTINCT FROM 'IND.BI.0025' OR
           run_context_code IS DISTINCT FROM '0/P' THEN
            RAISE EXCEPTION 'TOTVS employee cost manifest requires a running 0025 run';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'TOTVS employee cost run manifests are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TotvsEmployeeCostRunManifest_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "TotvsEmployeeCostRunManifest"
FOR EACH ROW EXECUTE FUNCTION "guard_totvs_employee_cost_run_manifest"();

CREATE FUNCTION "guard_totvs_employee_cost_run_membership"() RETURNS trigger AS $$
DECLARE
    run_status TEXT;
    run_company_id TEXT;
    run_unit_id TEXT;
    run_query_code TEXT;
    run_context_code TEXT;
    manifest_competence DATE;
    aggregate_company_id TEXT;
    aggregate_unit_id TEXT;
    aggregate_source TEXT;
    aggregate_query_code TEXT;
    aggregate_competence DATE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT r."status", r."companyId", r."unitId", r."queryCode",
               r."contextCode", m."competence"
        INTO run_status, run_company_id, run_unit_id, run_query_code,
             run_context_code, manifest_competence
        FROM "TotvsEmployeeCostRunManifest" m
        JOIN "TotvsEmployeeSyncRun" r ON r."id" = m."syncRunId"
        WHERE m."id" = NEW."manifestId";
        SELECT "companyId", "unitId", "source", "queryCode", "competence"
        INTO aggregate_company_id, aggregate_unit_id, aggregate_source,
             aggregate_query_code, aggregate_competence
        FROM "TotvsEmployeeCostAggregate" WHERE "id" = NEW."aggregateId";
        IF run_status IS DISTINCT FROM 'RUNNING' OR
           run_query_code IS DISTINCT FROM 'IND.BI.0025' OR
           run_context_code IS DISTINCT FROM '0/P' OR
           run_company_id IS DISTINCT FROM aggregate_company_id OR
           run_unit_id IS DISTINCT FROM aggregate_unit_id OR
           manifest_competence IS DISTINCT FROM aggregate_competence OR
           aggregate_source IS DISTINCT FROM 'TOTVS_RM' OR
           aggregate_query_code IS DISTINCT FROM 'IND.BI.0025' THEN
            RAISE EXCEPTION 'TOTVS employee cost membership must match its running 0025 manifest';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'TOTVS employee cost run memberships are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TotvsEmployeeCostRunMembership_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "TotvsEmployeeCostRunMembership"
FOR EACH ROW EXECUTE FUNCTION "guard_totvs_employee_cost_run_membership"();
