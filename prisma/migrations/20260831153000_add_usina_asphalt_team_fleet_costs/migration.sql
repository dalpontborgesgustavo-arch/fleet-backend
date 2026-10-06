CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "UsinaAsphaltTeamFleetAssignment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "teamId" TEXT NOT NULL,
  "aethosVehicleId" INTEGER NOT NULL,
  "fleetNumber" TEXT,
  "plate" TEXT,
  "category" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'JR_MANUAL',
  "observation" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UsinaAsphaltTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_vehicle_check" CHECK ("aethosVehicleId" > 0),
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_validity_check" CHECK (
    "validTo" >= "validFrom"
    AND DATE_TRUNC('month', "validFrom")::DATE = "competence"
    AND DATE_TRUNC('month', "validTo")::DATE = "competence"
  ),
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_origin_check" CHECK ("origin" = 'JR_MANUAL'),
  CONSTRAINT "UsinaAsphaltTeamFleetAssignment_category_check" CHECK (
    "category" IN ('VIBROACABADORA', 'ROLO_LISO', 'ROLO_PNEUS', 'MICROONIBUS', 'VEICULO_APOIO')
  )
);

CREATE INDEX "UsinaAsphaltTeamFleetAssignment_context_competence_team_idx"
  ON "UsinaAsphaltTeamFleetAssignment"("companyId", "unitId", "competence", "teamId");
CREATE INDEX "UsinaAsphaltTeamFleetAssignment_vehicle_validity_idx"
  ON "UsinaAsphaltTeamFleetAssignment"("aethosVehicleId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeamFleetAssignment_category_competence_idx"
  ON "UsinaAsphaltTeamFleetAssignment"("category", "competence");
CREATE INDEX "UsinaAsphaltTeamFleetAssignment_deletedAt_idx"
  ON "UsinaAsphaltTeamFleetAssignment"("deletedAt");

ALTER TABLE "UsinaAsphaltTeamFleetAssignment"
  ADD CONSTRAINT "UsinaAsphaltTeamFleetAssignment_no_vehicle_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "unitId" WITH =,
    "aethosVehicleId" WITH =,
    daterange("validFrom", "validTo", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

CREATE TABLE "UsinaAsphaltFleetFreightFact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceInstallmentId" TEXT,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "occurredDate" DATE NOT NULL,
  "competence" DATE NOT NULL,
  "aethosVehicleId" INTEGER NOT NULL,
  "fleetNumber" TEXT,
  "plate" TEXT,
  "freightTypeId" INTEGER NOT NULL,
  "principalItemId" INTEGER,
  "freightTypeDescription" TEXT,
  "quantity" DECIMAL(18,6),
  "unit" TEXT,
  "amount" DECIMAL(18,6) NOT NULL,
  "sourceStatus" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "contentHash" TEXT NOT NULL,
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivationReason" TEXT,
  "lastSeenRunId" TEXT,
  "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltFleetFreightFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaAsphaltFleetFreightFact_vehicle_check" CHECK ("aethosVehicleId" > 0),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_freight_type_check" CHECK ("freightTypeId" > 0),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_status_check" CHECK ("sourceStatus" = 'F'),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_hash_check" CHECK (LENGTH("contentHash") = 64),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_competence_check" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaAsphaltFleetFreightFact_deactivation_check" CHECK (
    ("active" = true AND "deactivatedAt" IS NULL AND "deactivationReason" IS NULL)
    OR ("active" = false AND "deactivatedAt" IS NOT NULL AND "deactivationReason" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "UsinaAsphaltFleetFreightFact_source_dataset_record_key"
  ON "UsinaAsphaltFleetFreightFact"("source", "dataset", "sourceRecordId");
CREATE INDEX "UsinaAsphaltFleetFreightFact_context_competence_active_idx"
  ON "UsinaAsphaltFleetFreightFact"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaAsphaltFleetFreightFact_vehicle_date_active_idx"
  ON "UsinaAsphaltFleetFreightFact"("aethosVehicleId", "occurredDate", "active");
CREATE INDEX "UsinaAsphaltFleetFreightFact_type_competence_idx"
  ON "UsinaAsphaltFleetFreightFact"("freightTypeId", "competence");
CREATE INDEX "UsinaAsphaltFleetFreightFact_document_installment_idx"
  ON "UsinaAsphaltFleetFreightFact"("sourceDocumentId", "sourceInstallmentId");
CREATE INDEX "UsinaAsphaltFleetFreightFact_lastSeenRunId_idx"
  ON "UsinaAsphaltFleetFreightFact"("lastSeenRunId");

CREATE TABLE "UsinaAsphaltFleetFreightFactAudit" (
  "id" BIGSERIAL NOT NULL,
  "factId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltFleetFreightFactAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltFleetFreightFactAudit_factId_fkey" FOREIGN KEY ("factId") REFERENCES "UsinaAsphaltFleetFreightFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "UsinaAsphaltFleetFreightFactAudit_fact_changed_idx"
  ON "UsinaAsphaltFleetFreightFactAudit"("factId", "changedAt");
CREATE INDEX "UsinaAsphaltFleetFreightFactAudit_sync_run_idx"
  ON "UsinaAsphaltFleetFreightFactAudit"("syncRunId");
