BEGIN;

CREATE TABLE "UsinaAsphaltEquipmentHourFact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceBranch" TEXT NOT NULL,
    "sourceCompanyId" INTEGER NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "sourceDate" DATE,
    "competence" DATE,
    "aethosVehicleId" INTEGER,
    "fleetNumber" TEXT,
    "plate" TEXT,
    "category" TEXT NOT NULL,
    "hourType" TEXT NOT NULL,
    "classifierKind" TEXT NOT NULL,
    "classifierId" INTEGER NOT NULL,
    "quantityHours" DECIMAL(18,6) NOT NULL,
    "sourceAmount" DECIMAL(18,6),
    "sourceStatus" TEXT NOT NULL,
    "cancelReasonPresent" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" TEXT,
    "classificationStatus" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMPTZ(6),
    "sourceUpdatedAt" TIMESTAMPTZ(6),
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "lastSeenRunId" TEXT,
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_branch_check" CHECK ("sourceBranch" IN ('ENTRADASIMPLESITEM', 'NFENTRADAITEM', 'ENTRADASIMPLESFRETE', 'NFENTRADAFRETE', 'FRETE')),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_category_check" CHECK ("category" IN ('VIBROACABADORA', 'ROLO_LISO', 'ROLO_PNEUS')),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_hour_type_check" CHECK ("hourType" IN ('PRODUTIVA', 'IMPRODUTIVA')),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_classifier_kind_check" CHECK ("classifierKind" IN ('ID_ITEM', 'ID_TIPOFRETE')),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_source_status_check" CHECK ("sourceStatus" = 'F'),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_classification_check" CHECK ("classificationStatus" IN ('ELIGIBLE', 'SEM_DATA_COMPETENCIA', 'SEM_ID_VEICULO', 'CONFLITO_CATEGORIA')),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_competence_check" CHECK ("competence" IS NULL OR EXTRACT(DAY FROM "competence") = 1),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_date_pair_check" CHECK (("sourceDate" IS NULL AND "competence" IS NULL) OR ("sourceDate" IS NOT NULL AND "competence" IS NOT NULL)),
    CONSTRAINT "UsinaAsphaltEquipmentHourFact_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "UsinaSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaAsphaltEquipmentHourFactAudit" (
    "id" BIGSERIAL NOT NULL,
    "factId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsinaAsphaltEquipmentHourFactAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsinaAsphaltEquipmentHourFactAudit_factId_fkey" FOREIGN KEY ("factId") REFERENCES "UsinaAsphaltEquipmentHourFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaAsphaltEquipmentHourFact_source_dataset_record_key" ON "UsinaAsphaltEquipmentHourFact"("source", "dataset", "sourceRecordId");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_scope_competence_active_idx" ON "UsinaAsphaltEquipmentHourFact"("companyId", "unitId", "competence", "active");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_vehicle_date_category_idx" ON "UsinaAsphaltEquipmentHourFact"("aethosVehicleId", "sourceDate", "category", "active");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_category_type_competence_idx" ON "UsinaAsphaltEquipmentHourFact"("category", "hourType", "competence", "active");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_classification_active_idx" ON "UsinaAsphaltEquipmentHourFact"("classificationStatus", "active");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_document_line_idx" ON "UsinaAsphaltEquipmentHourFact"("sourceDocumentId", "sourceLineId");
CREATE INDEX "UsinaAsphaltEquipmentHourFact_last_seen_run_idx" ON "UsinaAsphaltEquipmentHourFact"("lastSeenRunId");
CREATE INDEX "UsinaAsphaltEquipmentHourFactAudit_fact_changed_idx" ON "UsinaAsphaltEquipmentHourFactAudit"("factId", "changedAt");
CREATE INDEX "UsinaAsphaltEquipmentHourFactAudit_sync_run_idx" ON "UsinaAsphaltEquipmentHourFactAudit"("syncRunId");

COMMIT;
