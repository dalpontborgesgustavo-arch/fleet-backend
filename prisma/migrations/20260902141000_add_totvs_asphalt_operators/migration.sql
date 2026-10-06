CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "TotvsEmployeeSyncRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "queryCode" TEXT NOT NULL,
  "contextCode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedById" TEXT,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),
  "receivedRows" INTEGER NOT NULL DEFAULT 0,
  "acceptedRows" INTEGER NOT NULL DEFAULT 0,
  "rejectedRows" INTEGER NOT NULL DEFAULT 0,
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "aggregateCount" INTEGER NOT NULL DEFAULT 0,
  "responseBytes" INTEGER NOT NULL DEFAULT 0,
  "replayed" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,
  "errorDetail" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotvsEmployeeSyncRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TotvsEmployeeSyncRun_query_check" CHECK ("queryCode" = 'IND.BI.0025'),
  CONSTRAINT "TotvsEmployeeSyncRun_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED'))
);

CREATE INDEX "TotvsEmployeeSyncRun_context_started_idx" ON "TotvsEmployeeSyncRun"("companyId", "unitId", "startedAt");
CREATE INDEX "TotvsEmployeeSyncRun_query_status_started_idx" ON "TotvsEmployeeSyncRun"("queryCode", "status", "startedAt");

CREATE TABLE "TotvsEmployeeSnapshot" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'TOTVS_RM',
  "queryCode" TEXT NOT NULL DEFAULT 'IND.BI.0025',
  "companyCode" TEXT NOT NULL,
  "employeeNumber" TEXT NOT NULL,
  "employeeKey" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "period" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "displayName" TEXT NOT NULL,
  "jobName" TEXT,
  "departmentName" TEXT,
  "employmentStatus" TEXT,
  "admissionDate" DATE,
  "dismissalDate" DATE,
  "contentHash" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotvsEmployeeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TotvsEmployeeSnapshot_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "TotvsEmployeeSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TotvsEmployeeSnapshot_query_check" CHECK ("queryCode" = 'IND.BI.0025'),
  CONSTRAINT "TotvsEmployeeSnapshot_employee_key_check" CHECK ("employeeKey" = "companyCode" || '-' || "employeeNumber"),
  CONSTRAINT "TotvsEmployeeSnapshot_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "TotvsEmployeeSnapshot_period_check" CHECK ("period" IN (20, 30, 40)),
  CONSTRAINT "TotvsEmployeeSnapshot_hash_check" CHECK (LENGTH("contentHash") = 64)
);

CREATE UNIQUE INDEX "TotvsEmployeeSnapshot_scope_version_key" ON "TotvsEmployeeSnapshot"("companyId", "unitId", "employeeKey", "competence", "period", "version");
CREATE UNIQUE INDEX "TotvsEmployeeSnapshot_one_current_key" ON "TotvsEmployeeSnapshot"("companyId", "unitId", "employeeKey", "competence", "period") WHERE "isCurrent" = true;
CREATE INDEX "TotvsEmployeeSnapshot_current_idx" ON "TotvsEmployeeSnapshot"("companyId", "unitId", "competence", "isCurrent", "active");
CREATE INDEX "TotvsEmployeeSnapshot_employee_competence_period_idx" ON "TotvsEmployeeSnapshot"("employeeKey", "competence", "period");
CREATE INDEX "TotvsEmployeeSnapshot_syncRunId_idx" ON "TotvsEmployeeSnapshot"("syncRunId");

CREATE TABLE "TotvsEmployeeCostAggregate" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'TOTVS_RM',
  "queryCode" TEXT NOT NULL DEFAULT 'IND.BI.0025',
  "companyCode" TEXT NOT NULL,
  "employeeNumber" TEXT NOT NULL,
  "employeeKey" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "period" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "sourceRows" INTEGER NOT NULL,
  "allocationRows" INTEGER,
  "fixedAllocationValue" DECIMAL(18,6),
  "totalGeneralLine" DECIMAL(18,6),
  "allocationClosed" BOOLEAN NOT NULL DEFAULT false,
  "officialCostEligible" BOOLEAN NOT NULL DEFAULT false,
  "pendingReason" TEXT,
  "contentHash" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotvsEmployeeCostAggregate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TotvsEmployeeCostAggregate_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "TotvsEmployeeSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TotvsEmployeeCostAggregate_query_check" CHECK ("queryCode" = 'IND.BI.0025'),
  CONSTRAINT "TotvsEmployeeCostAggregate_employee_key_check" CHECK ("employeeKey" = "companyCode" || '-' || "employeeNumber"),
  CONSTRAINT "TotvsEmployeeCostAggregate_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "TotvsEmployeeCostAggregate_period_check" CHECK ("period" IN (20, 30, 40)),
  CONSTRAINT "TotvsEmployeeCostAggregate_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "TotvsEmployeeCostAggregate_no_official_cost_check" CHECK ("officialCostEligible" = false)
);

CREATE UNIQUE INDEX "TotvsEmployeeCostAggregate_scope_version_key" ON "TotvsEmployeeCostAggregate"("companyId", "unitId", "employeeKey", "competence", "period", "version");
CREATE UNIQUE INDEX "TotvsEmployeeCostAggregate_one_current_key" ON "TotvsEmployeeCostAggregate"("companyId", "unitId", "employeeKey", "competence", "period") WHERE "isCurrent" = true;
CREATE INDEX "TotvsEmployeeCostAggregate_current_idx" ON "TotvsEmployeeCostAggregate"("companyId", "unitId", "competence", "isCurrent", "active");
CREATE INDEX "TotvsEmployeeCostAggregate_employee_competence_period_idx" ON "TotvsEmployeeCostAggregate"("employeeKey", "competence", "period");
CREATE INDEX "TotvsEmployeeCostAggregate_syncRunId_idx" ON "TotvsEmployeeCostAggregate"("syncRunId");

CREATE TABLE "UsinaAsphaltFleetOperatorAssignment" (
  "id" TEXT NOT NULL,
  "fleetAssignmentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "employeeKey" TEXT NOT NULL,
  "employeeDisplayName" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'TOTVS_IND_BI_0025',
  "observation" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "deletedById" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_fleetAssignmentId_fkey" FOREIGN KEY ("fleetAssignmentId") REFERENCES "UsinaAsphaltTeamFleetAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_validity_check" CHECK ("validTo" >= "validFrom"),
  CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_origin_check" CHECK ("origin" = 'TOTVS_IND_BI_0025')
);

CREATE INDEX "UsinaAsphaltFleetOperatorAssignment_fleet_period_idx" ON "UsinaAsphaltFleetOperatorAssignment"("fleetAssignmentId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltFleetOperatorAssignment_employee_period_idx" ON "UsinaAsphaltFleetOperatorAssignment"("companyId", "unitId", "employeeKey", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltFleetOperatorAssignment_deletedAt_idx" ON "UsinaAsphaltFleetOperatorAssignment"("deletedAt");

ALTER TABLE "UsinaAsphaltFleetOperatorAssignment"
  ADD CONSTRAINT "UsinaAsphaltFleetOperatorAssignment_no_fleet_overlap"
  EXCLUDE USING gist (
    "fleetAssignmentId" WITH =,
    daterange("validFrom", "validTo", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);
