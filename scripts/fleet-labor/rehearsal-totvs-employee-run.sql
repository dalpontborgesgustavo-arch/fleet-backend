-- The existing IND.BI.0025 sync ledger is present in production. The isolated
-- CI database needs only its primary key for the parity receipt foreign key.
CREATE TABLE "TotvsEmployeeSyncRun" ("id" TEXT PRIMARY KEY);
