BEGIN;

CREATE TABLE "UsinaOperationalCostFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceDocumentId" TEXT,
  "aethosVehicleId" INTEGER,
  "fleetNumber" INTEGER,
  "accountPlanId" INTEGER,
  "accountPlanDescription" TEXT,
  "costClass" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "occurredDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL,
  "quantity" DECIMAL(18,6),
  "quantityUnit" TEXT,
  "aethosCompanyId" INTEGER,
  "supplierId" INTEGER,
  "debitCreditFlag" TEXT,
  "sourceStatus" TEXT NOT NULL,
  "limitationNote" TEXT,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaOperationalCostFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaOperationalCostFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaOperationalCostFact_source_check" CHECK ("source" IN ('AETHOS', 'TOTVS_IND_BI_0036')),
  CONSTRAINT "UsinaOperationalCostFact_dataset_check" CHECK ("dataset" IN ('VEHICLE_EXPENSES', 'PAYABLE_EXPENSES', 'LABOR_COSTS')),
  CONSTRAINT "UsinaOperationalCostFact_class_check" CHECK ("costClass" IN ('DIESEL_USINA', 'MANUTENCAO_USINA', 'VEHICLE_EXPENSE', 'OLEO_RESIVALE', 'CAL_CH1', 'DOP', 'MATERIAL_EXPEDIENTE', 'ENERGIA', 'MAO_DE_OBRA')),
  CONSTRAINT "UsinaOperationalCostFact_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaOperationalCostFact_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "UsinaOperationalCostFact_vehicle_check" CHECK (
    "dataset" <> 'VEHICLE_EXPENSES' OR (
      "source" = 'AETHOS' AND "aethosVehicleId" IS NOT NULL AND "accountPlanId" IS NOT NULL
    )
  ),
  CONSTRAINT "UsinaOperationalCostFact_payable_check" CHECK (
    "dataset" <> 'PAYABLE_EXPENSES' OR (
      "source" = 'AETHOS' AND "accountPlanId" IS NOT NULL AND "debitCreditFlag" = 'D' AND "sourceStatus" = 'BXD'
    )
  ),
  CONSTRAINT "UsinaOperationalCostFact_labor_check" CHECK (
    "dataset" <> 'LABOR_COSTS' OR (
      "source" = 'TOTVS_IND_BI_0036' AND "costClass" = 'MAO_DE_OBRA' AND "limitationNote" IS NOT NULL
    )
  ),
  CONSTRAINT "UsinaOperationalCostFact_deactivation_check" CHECK ("active" = TRUE OR "deactivatedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "UsinaOperationalCostFact_source_dataset_record_key"
  ON "UsinaOperationalCostFact"("source", "dataset", "sourceRecordId");
CREATE INDEX "UsinaOperationalCostFact_context_competence_dataset_active_idx"
  ON "UsinaOperationalCostFact"("companyId", "unitId", "competence", "dataset", "active");
CREATE INDEX "UsinaOperationalCostFact_class_competence_active_idx"
  ON "UsinaOperationalCostFact"("costClass", "competence", "active");
CREATE INDEX "UsinaOperationalCostFact_vehicle_competence_idx"
  ON "UsinaOperationalCostFact"("aethosVehicleId", "competence");
CREATE INDEX "UsinaOperationalCostFact_plan_competence_idx"
  ON "UsinaOperationalCostFact"("accountPlanId", "competence");
CREATE INDEX "UsinaOperationalCostFact_last_seen_run_idx"
  ON "UsinaOperationalCostFact"("lastSeenRunId");
CREATE INDEX "UsinaOperationalCostFact_synced_at_idx"
  ON "UsinaOperationalCostFact"("syncedAt");

COMMIT;
