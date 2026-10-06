CREATE TABLE "UsinaPhysicalMaterialMovement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "aethosCompanyId" INTEGER NOT NULL,
  "aethosItemId" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "competence" DATE NOT NULL,
  "movementType" TEXT NOT NULL,
  "quantityOriginal" DECIMAL(18,6) NOT NULL,
  "quantityUnit" TEXT NOT NULL,
  "densityTonPerM3" DECIMAL(18,6),
  "quantityTon" DECIMAL(18,6) NOT NULL,
  "sourceWeighingId" BIGINT,
  "sourceItemId" BIGINT,
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
  CONSTRAINT "UsinaPhysicalMaterialMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaPhysicalMaterialMovement_type_check" CHECK ("movementType" IN ('ENTRY', 'DIRECT_SALE')),
  CONSTRAINT "UsinaPhysicalMaterialMovement_quantity_check" CHECK ("quantityOriginal" >= 0 AND "quantityTon" >= 0),
  CONSTRAINT "UsinaPhysicalMaterialMovement_density_check" CHECK ("densityTonPerM3" IS NULL OR "densityTonPerM3" > 0)
);

CREATE TABLE "UsinaPhysicalMaterialMovementAudit" (
  "id" BIGSERIAL NOT NULL,
  "movementId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaPhysicalMaterialMovementAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsinaPhysicalMaterialMovement_source_sourceRecordId_key"
  ON "UsinaPhysicalMaterialMovement"("source", "sourceRecordId");
CREATE INDEX "UsinaPhysicalMaterialMovement_companyId_unitId_competence_active_idx"
  ON "UsinaPhysicalMaterialMovement"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaPhysicalMaterialMovement_aethosCompanyId_aethosItemId_competence_movementType_active_idx"
  ON "UsinaPhysicalMaterialMovement"("aethosCompanyId", "aethosItemId", "competence", "movementType", "active");
CREATE INDEX "UsinaPhysicalMaterialMovement_lastSeenRunId_idx"
  ON "UsinaPhysicalMaterialMovement"("lastSeenRunId");
CREATE INDEX "UsinaPhysicalMaterialMovement_syncedAt_idx"
  ON "UsinaPhysicalMaterialMovement"("syncedAt");
CREATE INDEX "UsinaPhysicalMaterialMovementAudit_movementId_changedAt_idx"
  ON "UsinaPhysicalMaterialMovementAudit"("movementId", "changedAt");
CREATE INDEX "UsinaPhysicalMaterialMovementAudit_syncRunId_idx"
  ON "UsinaPhysicalMaterialMovementAudit"("syncRunId");

ALTER TABLE "UsinaPhysicalMaterialMovement"
  ADD CONSTRAINT "UsinaPhysicalMaterialMovement_lastSeenRunId_fkey"
  FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsinaPhysicalMaterialMovementAudit"
  ADD CONSTRAINT "UsinaPhysicalMaterialMovementAudit_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "UsinaPhysicalMaterialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
