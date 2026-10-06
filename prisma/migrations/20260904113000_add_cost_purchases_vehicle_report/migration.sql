ALTER TABLE "Vehicle"
ADD COLUMN "manter_relatorio_mensal" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CostPurchaseVehicleExpenseFact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "aethosVehicleId" INTEGER NOT NULL,
    "documentDate" DATE,
    "documentNumber" TEXT,
    "amount" DECIMAL(24,12) NOT NULL,
    "desiredAverage" DECIMAL(24,12),
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostPurchaseVehicleExpenseFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseVehicleExpenseFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchaseVehicleExpenseFactAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseVehicleFuelFact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "aethosVehicleId" INTEGER NOT NULL,
    "documentDate" DATE,
    "fuelAmount" DECIMAL(24,12) NOT NULL,
    "liters" DECIMAL(24,12) NOT NULL,
    "initialKm" DECIMAL(24,12),
    "currentKm" DECIMAL(24,12),
    "desiredAverage" DECIMAL(24,12),
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostPurchaseVehicleFuelFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseVehicleFuelFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchaseVehicleFuelFactAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseReportException" (
    "id" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "identifierValue" TEXT NOT NULL,
    "displayFleet" TEXT,
    "displayModel" TEXT,
    "displayType" TEXT,
    "includeInReport" BOOLEAN NOT NULL DEFAULT true,
    "includeInAllocation" BOOLEAN NOT NULL DEFAULT true,
    "rateGroup" TEXT,
    "reason" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CostPurchaseReportException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseReportExceptionAudit" (
    "id" BIGSERIAL NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "actorId" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchaseReportExceptionAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseAllocationPolicy" (
    "id" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "vehicleShare" DECIMAL(10,6) NOT NULL,
    "truckShare" DECIMAL(10,6) NOT NULL,
    "machineShare" DECIMAL(10,6) NOT NULL,
    "maintenanceVehicleFixed" DECIMAL(24,12) NOT NULL,
    "comboioPlateFixed" DECIMAL(24,12) NOT NULL,
    "vehicleKeywords" TEXT[] NOT NULL,
    "truckKeywords" TEXT[] NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CostPurchaseAllocationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostPurchaseAllocationPolicyAudit" (
    "id" BIGSERIAL NOT NULL,
    "policyId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "actorId" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPurchaseAllocationPolicyAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostPurchaseVehicleExpenseFact_source_sourceRecordId_key" ON "CostPurchaseVehicleExpenseFact"("source", "sourceRecordId");
CREATE INDEX "CostPurchaseVehicleExpenseFact_companyId_competence_active_idx" ON "CostPurchaseVehicleExpenseFact"("companyId", "competence", "active");
CREATE INDEX "CostPurchaseVehicleExpenseFact_aethosVehicleId_competence_active_idx" ON "CostPurchaseVehicleExpenseFact"("aethosVehicleId", "competence", "active");
CREATE INDEX "CostPurchaseVehicleExpenseFact_lastSeenRunId_idx" ON "CostPurchaseVehicleExpenseFact"("lastSeenRunId");
CREATE INDEX "CostPurchaseVehicleExpenseFactAudit_factId_changedAt_idx" ON "CostPurchaseVehicleExpenseFactAudit"("factId", "changedAt");
CREATE INDEX "CostPurchaseVehicleExpenseFactAudit_syncRunId_idx" ON "CostPurchaseVehicleExpenseFactAudit"("syncRunId");

CREATE UNIQUE INDEX "CostPurchaseVehicleFuelFact_source_sourceRecordId_key" ON "CostPurchaseVehicleFuelFact"("source", "sourceRecordId");
CREATE INDEX "CostPurchaseVehicleFuelFact_companyId_competence_active_idx" ON "CostPurchaseVehicleFuelFact"("companyId", "competence", "active");
CREATE INDEX "CostPurchaseVehicleFuelFact_aethosVehicleId_competence_active_idx" ON "CostPurchaseVehicleFuelFact"("aethosVehicleId", "competence", "active");
CREATE INDEX "CostPurchaseVehicleFuelFact_lastSeenRunId_idx" ON "CostPurchaseVehicleFuelFact"("lastSeenRunId");
CREATE INDEX "CostPurchaseVehicleFuelFactAudit_factId_changedAt_idx" ON "CostPurchaseVehicleFuelFactAudit"("factId", "changedAt");
CREATE INDEX "CostPurchaseVehicleFuelFactAudit_syncRunId_idx" ON "CostPurchaseVehicleFuelFactAudit"("syncRunId");

CREATE UNIQUE INDEX "CostPurchaseReportException_identifierType_identifierValue_validFrom_key" ON "CostPurchaseReportException"("identifierType", "identifierValue", "validFrom");
CREATE INDEX "CostPurchaseReportException_identifierType_identifierValue_active_idx" ON "CostPurchaseReportException"("identifierType", "identifierValue", "active");
CREATE INDEX "CostPurchaseReportException_validFrom_validTo_active_idx" ON "CostPurchaseReportException"("validFrom", "validTo", "active");
CREATE INDEX "CostPurchaseReportExceptionAudit_exceptionId_changedAt_idx" ON "CostPurchaseReportExceptionAudit"("exceptionId", "changedAt");
CREATE INDEX "CostPurchaseAllocationPolicy_validFrom_validTo_active_idx" ON "CostPurchaseAllocationPolicy"("validFrom", "validTo", "active");
CREATE INDEX "CostPurchaseAllocationPolicyAudit_policyId_changedAt_idx" ON "CostPurchaseAllocationPolicyAudit"("policyId", "changedAt");

ALTER TABLE "CostPurchaseVehicleExpenseFact" ADD CONSTRAINT "CostPurchaseVehicleExpenseFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseVehicleExpenseFactAudit" ADD CONSTRAINT "CostPurchaseVehicleExpenseFactAudit_factId_fkey" FOREIGN KEY ("factId") REFERENCES "CostPurchaseVehicleExpenseFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseVehicleFuelFact" ADD CONSTRAINT "CostPurchaseVehicleFuelFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseVehicleFuelFactAudit" ADD CONSTRAINT "CostPurchaseVehicleFuelFactAudit_factId_fkey" FOREIGN KEY ("factId") REFERENCES "CostPurchaseVehicleFuelFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseReportExceptionAudit" ADD CONSTRAINT "CostPurchaseReportExceptionAudit_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "CostPurchaseReportException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostPurchaseAllocationPolicyAudit" ADD CONSTRAINT "CostPurchaseAllocationPolicyAudit_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CostPurchaseAllocationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CostPurchaseAllocationPolicy" (
    "id", "validFrom", "validTo", "vehicleShare", "truckShare", "machineShare",
    "maintenanceVehicleFixed", "comboioPlateFixed", "vehicleKeywords", "truckKeywords",
    "sourceNote", "active", "createdBy", "updatedBy", "updatedAt"
) VALUES (
    'd51c4c4b-8a30-4ee9-a354-f05651c88f10', DATE '2000-01-01', NULL,
    0.050000, 0.475000, 0.475000, 900.000000000000, 3500.000000000000,
    ARRAY['BALSA','CARRO','CAMINHONET','CAMIONET','ONIBUS','LABORAT','SINALIZA'],
    ARRAY['CAMINH','TRUCK','CARRETA','PRANCHA','PIPA','COMBOIO','ESPARGID','MUNCK','PLATAFORM','VOLVO'],
    'Regra vigente da pagina Relatorio Mensal do FROTA NOVO.pbip', true,
    'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP
);

INSERT INTO "CostPurchaseAllocationPolicyAudit" ("policyId", "operation", "afterData", "actorId")
SELECT "id", 'SEED', to_jsonb(p), 'MIGRATION_20260904113000'
FROM "CostPurchaseAllocationPolicy" p
WHERE "id" = 'd51c4c4b-8a30-4ee9-a354-f05651c88f10';

INSERT INTO "CostPurchaseReportException" (
    "id", "identifierType", "identifierValue", "displayFleet", "displayModel", "displayType",
    "includeInReport", "includeInAllocation", "rateGroup", "reason", "validFrom", "validTo",
    "active", "createdBy", "updatedBy", "updatedAt"
) VALUES
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e101', 'PLATE', 'USI2018', NULL, NULL, 'USINAS', true, false, NULL, 'Usina incluida no relatorio e fora do rateio', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP),
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e102', 'PLATE', 'USI2025', NULL, NULL, 'USINAS', true, false, NULL, 'Usina incluida no relatorio e fora do rateio', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP),
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e103', 'PLATE', 'SWX4A45', 'EDER', NULL, 'CAMINHONETAS', true, true, 'VEICULOS', 'Excecao de exibicao e grupo vigente no PBIP', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP),
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e104', 'PLATE', 'CVE2E80', NULL, 'SPRINTER', 'CAMINHAO ALUGADO', true, false, NULL, 'Terceiro explicitamente incluido e fora do rateio', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP),
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e105', 'FLEET', '809', NULL, NULL, 'ESCAVADEIRA ALUGADO', true, false, NULL, 'Terceiro explicitamente incluido e fora do rateio', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP),
    ('1f2dc4c0-7d8d-4a21-a682-83f83794e106', 'FLEET', '288', NULL, NULL, NULL, true, false, NULL, 'Frota fora do rateio conforme PBIP', DATE '2000-01-01', NULL, true, 'MIGRATION_20260904113000', 'MIGRATION_20260904113000', CURRENT_TIMESTAMP);

INSERT INTO "CostPurchaseReportExceptionAudit" ("exceptionId", "operation", "afterData", "actorId")
SELECT "id", 'SEED', to_jsonb(e), 'MIGRATION_20260904113000'
FROM "CostPurchaseReportException" e
WHERE "createdBy" = 'MIGRATION_20260904113000';
