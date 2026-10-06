BEGIN;

CREATE TABLE "UsinaAsphaltEquipmentHourlyRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "productiveRate" DECIMAL(18,6) NOT NULL,
    "unproductiveRate" DECIMAL(18,6) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "changeReason" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRate_category_check"
      CHECK ("category" IN ('VIBROACABADORA', 'ROLO_LISO', 'ROLO_PNEUS')),
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRate_productive_check"
      CHECK ("productiveRate" >= 0),
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRate_unproductive_check"
      CHECK ("unproductiveRate" >= 0),
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRate_competence_check"
      CHECK (EXTRACT(DAY FROM "competence") = 1)
);

CREATE TABLE "UsinaAsphaltEquipmentHourlyRateAudit" (
    "id" BIGSERIAL NOT NULL,
    "rateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRateAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsinaAsphaltEquipmentHourlyRateAudit_rateId_fkey"
      FOREIGN KEY ("rateId") REFERENCES "UsinaAsphaltEquipmentHourlyRate"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaAsphaltEquipmentHourlyRate_scope_version_key"
  ON "UsinaAsphaltEquipmentHourlyRate"("companyId", "unitId", "competence", "category", "version");

CREATE UNIQUE INDEX "UsinaAsphaltEquipmentHourlyRate_current_key"
  ON "UsinaAsphaltEquipmentHourlyRate"("companyId", "unitId", "competence", "category")
  WHERE "isCurrent" = true AND "deletedAt" IS NULL;

CREATE INDEX "UsinaAsphaltEquipmentHourlyRate_scope_current_idx"
  ON "UsinaAsphaltEquipmentHourlyRate"("companyId", "unitId", "competence", "category", "isCurrent");

CREATE INDEX "UsinaAsphaltEquipmentHourlyRate_deletedAt_idx"
  ON "UsinaAsphaltEquipmentHourlyRate"("deletedAt");

CREATE INDEX "UsinaAsphaltEquipmentHourlyRateAudit_rate_created_idx"
  ON "UsinaAsphaltEquipmentHourlyRateAudit"("rateId", "createdAt");

CREATE INDEX "UsinaAsphaltEquipmentHourlyRateAudit_actor_created_idx"
  ON "UsinaAsphaltEquipmentHourlyRateAudit"("actorId", "createdAt");

COMMIT;
