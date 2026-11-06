-- Runs only in the disposable CI migration-rehearsal database.
INSERT INTO "TotvsEmployeeSyncRun" (
    "id", "companyId", "unitId", "queryCode", "contextCode", "status"
) VALUES (
    'fleet-labor-baseline-test', 'JR_TEST', 'UNIT_TEST',
    'IND.BI.0025', '0/P', 'RUNNING'
), (
    'fleet-labor-baseline-wrong-query', 'JR_TEST', 'UNIT_TEST',
    'IND.BI.0039', '0/P', 'RUNNING'
);
INSERT INTO "TotvsEmployeeCostAggregate" (
    "id", "companyId", "unitId", "source", "queryCode", "competence"
) VALUES (
    'fleet-labor-baseline-aggregate-test', 'JR_TEST', 'UNIT_TEST',
    'TOTVS_RM', 'IND.BI.0025', DATE '2026-09-01'
), (
    'fleet-labor-baseline-late-test', 'JR_TEST', 'UNIT_TEST',
    'TOTVS_RM', 'IND.BI.0025', DATE '2026-09-01'
);
INSERT INTO "TotvsEmployeeCostRunManifest" (
    "id", "syncRunId", "competence", "rowCount", "contentHash"
) VALUES (
    'fleet-labor-manifest-test', 'fleet-labor-baseline-test',
    DATE '2026-09-01', 1, repeat('a', 64)
);
INSERT INTO "TotvsEmployeeCostRunMembership" ("id", "manifestId", "aggregateId")
VALUES ('fleet-labor-membership-test', 'fleet-labor-manifest-test',
    'fleet-labor-baseline-aggregate-test');
UPDATE "TotvsEmployeeSyncRun" SET "status" = 'SUCCEEDED'
WHERE "id" = 'fleet-labor-baseline-test';
INSERT INTO "TotvsFleetLaborSyncRun" (
    "id", "companyId", "unitId", "queryCode", "ruleVersion", "status",
    "finishedAt", "acceptedRows", "sourceHash"
) VALUES (
    'fleet-labor-run-test', 'JR_TEST', 'UNIT_TEST', 'IND.BI.0039',
    'IND.BI.0025_RATEADO_V1', 'STAGED', CURRENT_TIMESTAMP, 1, 'source-test'
);
INSERT INTO "TotvsFleetLaborApproval" (
    "id", "companyId", "unitId", "competence", "syncRunId", "sourceHash",
    "rowCount", "totalCost", "evidenceRef", "baselineSyncRunId",
    "baselineHash", "candidateHash", "parityVerifiedAt"
) VALUES (
    'fleet-labor-approval-test', 'JR_TEST', 'UNIT_TEST', DATE '2026-09-01',
    'fleet-labor-run-test', 'source-test', 1, 100.000000, 'ci-rehearsal',
    'fleet-labor-baseline-test', 'baseline-test', 'candidate-test', CURRENT_TIMESTAMP
);
INSERT INTO "TotvsFleetLaborCost" (
    "id", "companyId", "unitId", "queryCode", "ruleVersion", "companyCode",
    "employeeNumber", "employeeKey", "competence", "period",
    "totalGeneralRateado", "cardinalityOk", "contentHash", "syncRunId",
    "updatedAt"
) VALUES (
    'fleet-labor-cost-test', 'JR_TEST', 'UNIT_TEST', 'IND.BI.0039',
    'IND.BI.0025_RATEADO_V1', '1', '0001', '1-0001', DATE '2026-09-01',
    20, 100.000000, true, 'content-test', 'fleet-labor-run-test', CURRENT_TIMESTAMP
);

DO $$
DECLARE
    blocked BOOLEAN := false;
BEGIN
    BEGIN
        INSERT INTO "TotvsEmployeeCostRunManifest" (
            "id", "syncRunId", "competence", "rowCount", "contentHash"
        ) VALUES (
            'fleet-labor-manifest-wrong-query',
            'fleet-labor-baseline-wrong-query', DATE '2026-09-01', 0,
            repeat('b', 64)
        );
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'TOTVS employee cost manifest requires a running 0025 run';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Non-0025 manifest was not blocked'; END IF;

    blocked := false;
    BEGIN
        INSERT INTO "TotvsEmployeeCostRunMembership" ("id", "manifestId", "aggregateId")
        VALUES ('fleet-labor-membership-late-test', 'fleet-labor-manifest-test',
            'fleet-labor-baseline-late-test');
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'TOTVS employee cost membership must match its running 0025 manifest';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Late 0025 membership was not blocked'; END IF;

    blocked := false;
    BEGIN
        UPDATE "TotvsEmployeeCostRunManifest" SET "rowCount" = 2
        WHERE "id" = 'fleet-labor-manifest-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'TOTVS employee cost run manifests are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION '0025 run manifest mutation was not blocked'; END IF;

    blocked := false;
    BEGIN
        UPDATE "TotvsEmployeeCostRunMembership"
        SET "aggregateId" = 'tampered'
        WHERE "id" = 'fleet-labor-membership-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'TOTVS employee cost run memberships are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION '0025 run membership mutation was not blocked'; END IF;

    blocked := false;
    BEGIN
        DELETE FROM "TotvsEmployeeCostRunMembership"
        WHERE "id" = 'fleet-labor-membership-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'TOTVS employee cost run memberships are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION '0025 run membership deletion was not blocked'; END IF;

    blocked := false;
    BEGIN
        UPDATE "TotvsFleetLaborCost" SET "totalGeneralRateado" = 101
        WHERE "id" = 'fleet-labor-cost-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Fleet labor facts are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Staged fact mutation was not blocked'; END IF;

    blocked := false;
    BEGIN
        DELETE FROM "TotvsFleetLaborCost" WHERE "id" = 'fleet-labor-cost-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Fleet labor facts are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Staged fact deletion was not blocked'; END IF;

    blocked := false;
    BEGIN
        UPDATE "TotvsFleetLaborSyncRun" SET "sourceHash" = 'tampered'
        WHERE "id" = 'fleet-labor-run-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Completed fleet labor runs are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Completed run mutation was not blocked'; END IF;

    UPDATE "TotvsFleetLaborCost"
    SET "approvalId" = 'fleet-labor-approval-test', "isCurrent" = true
    WHERE "id" = 'fleet-labor-cost-test';
    IF NOT EXISTS (
        SELECT 1 FROM "TotvsFleetLaborCost" WHERE "id" = 'fleet-labor-cost-test'
        AND "isCurrent" = true AND "approvalId" = 'fleet-labor-approval-test'
    ) THEN RAISE EXCEPTION 'Approval transition failed'; END IF;

    blocked := false;
    BEGIN
        UPDATE "TotvsFleetLaborCost" SET "totalGeneralRateado" = 102
        WHERE "id" = 'fleet-labor-cost-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Fleet labor facts are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Approved fact mutation was not blocked'; END IF;

    UPDATE "TotvsFleetLaborCost" SET "isCurrent" = false
    WHERE "id" = 'fleet-labor-cost-test';
    IF NOT EXISTS (
        SELECT 1 FROM "TotvsFleetLaborCost" WHERE "id" = 'fleet-labor-cost-test'
        AND "isCurrent" = false AND "approvalId" = 'fleet-labor-approval-test'
        AND "totalGeneralRateado" = 100.000000
    ) THEN RAISE EXCEPTION 'Audited retirement transition failed'; END IF;

    INSERT INTO "TotvsFleetLaborReversal" ("id", "approvalId", "reason")
    VALUES ('fleet-labor-reversal-test', 'fleet-labor-approval-test', 'ci-rehearsal');
    blocked := false;
    BEGIN
        UPDATE "TotvsFleetLaborReversal" SET "reason" = 'tampered'
        WHERE "id" = 'fleet-labor-reversal-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Fleet labor reversal receipts are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Reversal receipt mutation was not blocked'; END IF;

    blocked := false;
    BEGIN
        DELETE FROM "TotvsFleetLaborApproval" WHERE "id" = 'fleet-labor-approval-test';
    EXCEPTION WHEN raise_exception THEN
        blocked := SQLERRM = 'Fleet labor approval receipts are immutable';
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Approval receipt deletion was not blocked'; END IF;
END;
$$;
