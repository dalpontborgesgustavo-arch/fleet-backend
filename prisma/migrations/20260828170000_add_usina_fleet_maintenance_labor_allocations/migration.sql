CREATE TABLE "UsinaFleetMaintenanceLaborAllocation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "aethosVehicleId" INTEGER NOT NULL,
  "fleetNumber" INTEGER NOT NULL,
  "targetCostClass" TEXT NOT NULL,
  "vehicleExpenseAmount" DECIMAL(24,12) NOT NULL,
  "rateGroup" TEXT NOT NULL,
  "groupShare" DECIMAL(10,6) NOT NULL,
  "groupExpenseBase" DECIMAL(24,12) NOT NULL,
  "eligibleLaborPoolAmount" DECIMAL(24,12) NOT NULL,
  "allocatedLaborAmount" DECIMAL(24,12) NOT NULL,
  "expectedLineAmount" DECIMAL(24,12) NOT NULL,
  "sourceSentence" TEXT NOT NULL,
  "sourceGeneratedAt" TIMESTAMPTZ(6) NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_target_check" CHECK ("targetCostClass" IN ('CARREGADEIRAS', 'VEICULO_USINA')),
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_group_check" CHECK ("rateGroup" IN ('VEICULOS', 'CAMINHOES', 'MAQUINAS')),
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_amounts_check" CHECK (
    "vehicleExpenseAmount" >= 0 AND
    "groupShare" >= 0 AND "groupShare" <= 1 AND
    "groupExpenseBase" >= 0 AND
    "eligibleLaborPoolAmount" >= 0 AND
    "allocatedLaborAmount" >= 0 AND
    "expectedLineAmount" >= 0
  ),
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_source_check" CHECK ("sourceSentence" = 'IND.BI.0035')
);

CREATE TABLE "UsinaFleetMaintenanceLaborAllocationAudit" (
  "id" BIGSERIAL NOT NULL,
  "allocationId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaFleetMaintenanceLaborAllocationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsinaFleetMaintenanceLaborAllocation_source_sourceRecordId_key"
  ON "UsinaFleetMaintenanceLaborAllocation"("source", "sourceRecordId");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocation_companyId_unitId_competence_active_idx"
  ON "UsinaFleetMaintenanceLaborAllocation"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocation_aethosVehicleId_competence_targetCostClass_active_idx"
  ON "UsinaFleetMaintenanceLaborAllocation"("aethosVehicleId", "competence", "targetCostClass", "active");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocation_lastSeenRunId_idx"
  ON "UsinaFleetMaintenanceLaborAllocation"("lastSeenRunId");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocation_syncedAt_idx"
  ON "UsinaFleetMaintenanceLaborAllocation"("syncedAt");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocationAudit_allocationId_changedAt_idx"
  ON "UsinaFleetMaintenanceLaborAllocationAudit"("allocationId", "changedAt");
CREATE INDEX "UsinaFleetMaintenanceLaborAllocationAudit_syncRunId_idx"
  ON "UsinaFleetMaintenanceLaborAllocationAudit"("syncRunId");

ALTER TABLE "UsinaFleetMaintenanceLaborAllocation"
  ADD CONSTRAINT "UsinaFleetMaintenanceLaborAllocation_lastSeenRunId_fkey"
  FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsinaFleetMaintenanceLaborAllocationAudit"
  ADD CONSTRAINT "UsinaFleetMaintenanceLaborAllocationAudit_allocationId_fkey"
  FOREIGN KEY ("allocationId") REFERENCES "UsinaFleetMaintenanceLaborAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
