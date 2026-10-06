CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurement" (
    "id" TEXT NOT NULL,
    "aethosMeasurementId" TEXT NOT NULL,
    "aethosContractId" TEXT NOT NULL,
    "aethosWorkId" TEXT NOT NULL,
    "workName" TEXT NOT NULL,
    "workContract" TEXT,
    "contractorAethosId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "engineerAethosId" TEXT,
    "engineerName" TEXT,
    "measurementNumber" TEXT,
    "measurementDescription" TEXT,
    "registeredAt" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "competenceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "measurementValue" DECIMAL(18,2),
    "discountValue" DECIMAL(18,2),
    "retentionValue" DECIMAL(18,2),
    "totalValue" DECIMAL(18,2),
    "contractValue" DECIMAL(18,2),
    "totalMeasuredValue" DECIMAL(18,2),
    "contractStatus" TEXT,
    "measurementNotes" TEXT,
    "contractNotes" TEXT,
    "engineerDeliveryDate" TIMESTAMP(3),
    "engineerDeliveryTargetDate" TIMESTAMP(3),
    "engineerDelayReason" TEXT,
    "measurementApproved" BOOLEAN,
    "rejectionReason" TEXT,
    "resolutionDate" TIMESTAMP(3),
    "zanandraDeliveryDate" TIMESTAMP(3),
    "invoiceRequestDate" TIMESTAMP(3),
    "contractorDocumentsDeliveryDate" TIMESTAMP(3),
    "zanandraDeliveryTargetDate" TIMESTAMP(3),
    "invoiceRequestTargetDate" TIMESTAMP(3),
    "contractorDocumentsTargetDate" TIMESTAMP(3),
    "type" TEXT,
    "administrativeNotes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AETHOS',
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdPartyMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementItem" (
    "id" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "aethosMeasurementItemId" TEXT NOT NULL,
    "aethosContractId" TEXT NOT NULL,
    "measurementNumber" TEXT,
    "aethosWorkId" TEXT NOT NULL,
    "aethosContractItemId" TEXT,
    "aethosBudgetItemId" TEXT,
    "itemDescription" TEXT NOT NULL,
    "contractQuantity" DECIMAL(18,4),
    "contractValue" DECIMAL(18,2),
    "measuredQuantity" DECIMAL(18,4),
    "measuredPercentage" DECIMAL(9,4),
    "measuredValue" DECIMAL(18,2),
    "balanceQuantity" DECIMAL(18,4),
    "balanceValue" DECIMAL(18,2),
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdPartyMeasurementItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementHistory" (
    "id" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThirdPartyMeasurementHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementSla" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseDateField" TEXT NOT NULL,
    "targetDateField" TEXT NOT NULL,
    "days" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'BUSINESS_DAYS',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdPartyMeasurementSla_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurement_aethosMeasurementId_key" ON "ThirdPartyMeasurement"("aethosMeasurementId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_aethosContractId_idx" ON "ThirdPartyMeasurement"("aethosContractId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_aethosWorkId_idx" ON "ThirdPartyMeasurement"("aethosWorkId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_contractorAethosId_idx" ON "ThirdPartyMeasurement"("contractorAethosId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_engineerAethosId_idx" ON "ThirdPartyMeasurement"("engineerAethosId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_competenceDate_idx" ON "ThirdPartyMeasurement"("competenceDate");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_dueDate_idx" ON "ThirdPartyMeasurement"("dueDate");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_finalized_idx" ON "ThirdPartyMeasurement"("finalized");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurement_syncedAt_idx" ON "ThirdPartyMeasurement"("syncedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurementItem_aethosMeasurementItemId_key" ON "ThirdPartyMeasurementItem"("aethosMeasurementItemId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementItem_measurementId_idx" ON "ThirdPartyMeasurementItem"("measurementId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementItem_aethosContractId_idx" ON "ThirdPartyMeasurementItem"("aethosContractId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementItem_aethosWorkId_idx" ON "ThirdPartyMeasurementItem"("aethosWorkId");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementItem_aethosContractItemId_idx" ON "ThirdPartyMeasurementItem"("aethosContractItemId");

CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementHistory_measurementId_createdAt_idx" ON "ThirdPartyMeasurementHistory"("measurementId", "createdAt");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementHistory_actorId_idx" ON "ThirdPartyMeasurementHistory"("actorId");

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurementSla_key_key" ON "ThirdPartyMeasurementSla"("key");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementSla_active_idx" ON "ThirdPartyMeasurementSla"("active");

DO $$ BEGIN
  ALTER TABLE "ThirdPartyMeasurementItem"
    ADD CONSTRAINT "ThirdPartyMeasurementItem_measurementId_fkey"
    FOREIGN KEY ("measurementId") REFERENCES "ThirdPartyMeasurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ThirdPartyMeasurementHistory"
    ADD CONSTRAINT "ThirdPartyMeasurementHistory_measurementId_fkey"
    FOREIGN KEY ("measurementId") REFERENCES "ThirdPartyMeasurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "ThirdPartyMeasurementSla" (
  "id", "key", "label", "baseDateField", "targetDateField", "days", "unit", "active", "updatedAt"
) VALUES
  ('third-party-sla-engineer', 'ENGINEER_DELIVERY', 'Entrega ao engenheiro', 'registeredAt', 'engineerDeliveryTargetDate', NULL, 'BUSINESS_DAYS', false, CURRENT_TIMESTAMP),
  ('third-party-sla-zanandra', 'ZANANDRA_DELIVERY', 'Entrega para Zanandra', 'engineerDeliveryDate', 'zanandraDeliveryTargetDate', NULL, 'BUSINESS_DAYS', false, CURRENT_TIMESTAMP),
  ('third-party-sla-invoice', 'INVOICE_REQUEST', 'Solicitação da NF', 'zanandraDeliveryDate', 'invoiceRequestTargetDate', NULL, 'BUSINESS_DAYS', false, CURRENT_TIMESTAMP),
  ('third-party-sla-documents', 'CONTRACTOR_DOCUMENTS', 'Documentos dos empreiteiros', 'invoiceRequestDate', 'contractorDocumentsTargetDate', NULL, 'BUSINESS_DAYS', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
