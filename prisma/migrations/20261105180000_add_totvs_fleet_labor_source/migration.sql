CREATE TABLE "TotvsFleetLaborSyncRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "queryCode" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedById" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "receivedRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateKeys" INTEGER NOT NULL DEFAULT 0,
    "responseBytes" INTEGER NOT NULL DEFAULT 0,
    "sourceHash" TEXT,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    CONSTRAINT "TotvsFleetLaborSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TotvsFleetLaborApproval" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalCost" DECIMAL(28,6) NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TotvsFleetLaborApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TotvsFleetLaborCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "queryCode" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "employeeKey" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "period" INTEGER NOT NULL,
    "totalGeneralRateado" DECIMAL(28,6) NOT NULL,
    "cardinalityOk" BOOLEAN NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncRunId" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "TotvsFleetLaborCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TotvsFleetLaborSyncRun_companyId_unitId_startedAt_idx" ON "TotvsFleetLaborSyncRun"("companyId", "unitId", "startedAt");
CREATE INDEX "TotvsFleetLaborSyncRun_queryCode_status_startedAt_idx" ON "TotvsFleetLaborSyncRun"("queryCode", "status", "startedAt");
CREATE UNIQUE INDEX "TotvsFleetLaborSyncRun_one_running_idx" ON "TotvsFleetLaborSyncRun"("companyId", "unitId", "queryCode") WHERE "status" = 'RUNNING';
CREATE UNIQUE INDEX "TotvsFleetLaborApproval_companyId_unitId_competence_syncRunId_key" ON "TotvsFleetLaborApproval"("companyId", "unitId", "competence", "syncRunId");
CREATE INDEX "TotvsFleetLaborApproval_companyId_unitId_competence_approvedAt_idx" ON "TotvsFleetLaborApproval"("companyId", "unitId", "competence", "approvedAt");
CREATE UNIQUE INDEX "TotvsFleetLaborCost_companyId_unitId_employeeKey_competence_period_syncRunId_key" ON "TotvsFleetLaborCost"("companyId", "unitId", "employeeKey", "competence", "period", "syncRunId");
CREATE INDEX "TotvsFleetLaborCost_companyId_unitId_competence_isCurrent_active_idx" ON "TotvsFleetLaborCost"("companyId", "unitId", "competence", "isCurrent", "active");
CREATE INDEX "TotvsFleetLaborCost_employeeKey_competence_period_idx" ON "TotvsFleetLaborCost"("employeeKey", "competence", "period");
CREATE INDEX "TotvsFleetLaborCost_syncRunId_idx" ON "TotvsFleetLaborCost"("syncRunId");
CREATE INDEX "TotvsFleetLaborCost_approvalId_idx" ON "TotvsFleetLaborCost"("approvalId");
CREATE UNIQUE INDEX "TotvsFleetLaborCost_one_current_idx" ON "TotvsFleetLaborCost"("companyId", "unitId", "employeeKey", "competence", "period") WHERE "isCurrent" = true AND "active" = true;

ALTER TABLE "TotvsFleetLaborApproval" ADD CONSTRAINT "TotvsFleetLaborApproval_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "TotvsFleetLaborSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TotvsFleetLaborCost" ADD CONSTRAINT "TotvsFleetLaborCost_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "TotvsFleetLaborSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TotvsFleetLaborCost" ADD CONSTRAINT "TotvsFleetLaborCost_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "TotvsFleetLaborApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Approved facts cannot be silently edited or deleted. A later approved run
-- may only retire them by changing isCurrent from true to false.
CREATE FUNCTION "reject_approved_fleet_labor_fact_mutation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."approvalId" IS NOT NULL THEN
            RAISE EXCEPTION 'Approved fleet labor facts are immutable';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."approvalId" IS NOT NULL AND (
        NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
        NEW."unitId" IS DISTINCT FROM OLD."unitId" OR
        NEW."queryCode" IS DISTINCT FROM OLD."queryCode" OR
        NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion" OR
        NEW."companyCode" IS DISTINCT FROM OLD."companyCode" OR
        NEW."employeeNumber" IS DISTINCT FROM OLD."employeeNumber" OR
        NEW."employeeKey" IS DISTINCT FROM OLD."employeeKey" OR
        NEW."competence" IS DISTINCT FROM OLD."competence" OR
        NEW."period" IS DISTINCT FROM OLD."period" OR
        NEW."totalGeneralRateado" IS DISTINCT FROM OLD."totalGeneralRateado" OR
        NEW."cardinalityOk" IS DISTINCT FROM OLD."cardinalityOk" OR
        NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR
        NEW."syncRunId" IS DISTINCT FROM OLD."syncRunId" OR
        NEW."approvalId" IS DISTINCT FROM OLD."approvalId" OR
        NEW."active" IS DISTINCT FROM OLD."active" OR
        (OLD."isCurrent" = false AND NEW."isCurrent" = true)
    ) THEN
        RAISE EXCEPTION 'Approved fleet labor facts are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TotvsFleetLaborCost_approved_immutable"
BEFORE UPDATE OR DELETE ON "TotvsFleetLaborCost"
FOR EACH ROW EXECUTE FUNCTION "reject_approved_fleet_labor_fact_mutation"();

CREATE FUNCTION "reject_fleet_labor_approval_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Fleet labor approval receipts are immutable';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TotvsFleetLaborApproval_immutable"
BEFORE UPDATE OR DELETE ON "TotvsFleetLaborApproval"
FOR EACH ROW EXECUTE FUNCTION "reject_fleet_labor_approval_mutation"();
