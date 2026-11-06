-- The existing IND.BI.0025 ledger and aggregate tables are present in
-- production. The isolated CI database needs only their referenced keys.
CREATE TABLE "TotvsEmployeeSyncRun" (
    "id" TEXT PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "queryCode" TEXT NOT NULL,
    "contextCode" TEXT NOT NULL,
    "status" TEXT NOT NULL
);
CREATE TABLE "TotvsEmployeeCostAggregate" (
    "id" TEXT PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "queryCode" TEXT NOT NULL,
    "competence" DATE NOT NULL
);
