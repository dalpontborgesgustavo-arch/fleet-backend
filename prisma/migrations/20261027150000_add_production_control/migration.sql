ALTER TABLE "User" ADD COLUMN "canManageProductionControl" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProductionControlLine" (
  "id" TEXT NOT NULL,
  "competence" VARCHAR(7) NOT NULL,
  "engineer" TEXT NOT NULL,
  "municipality" TEXT,
  "workCode" TEXT,
  "workName" TEXT NOT NULL,
  "activity" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "unitPrice" DECIMAL(24,15),
  "sourceSheet" TEXT,
  "sourceExcelRow" INTEGER,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ProductionControlLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionControlLine_competence_sourceSheet_sourceExcelRow_key"
  ON "ProductionControlLine"("competence", "sourceSheet", "sourceExcelRow");
CREATE INDEX "ProductionControlLine_competence_engineer_activity_idx"
  ON "ProductionControlLine"("competence", "engineer", "activity");

CREATE TABLE "ProductionControlDaily" (
  "id" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "productionDate" DATE NOT NULL,
  "quantity" DECIMAL(16,3) NOT NULL,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ProductionControlDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionControlDaily_lineId_productionDate_key"
  ON "ProductionControlDaily"("lineId", "productionDate");
CREATE INDEX "ProductionControlDaily_productionDate_idx"
  ON "ProductionControlDaily"("productionDate");
ALTER TABLE "ProductionControlDaily" ADD CONSTRAINT "ProductionControlDaily_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "ProductionControlLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionControlWeek" (
  "id" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "weekIndex" INTEGER NOT NULL,
  "weeklyPlanQuantity" DECIMAL(16,3),
  "monthPlanQuantity" DECIMAL(16,3),
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ProductionControlWeek_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionControlWeek_lineId_weekIndex_key"
  ON "ProductionControlWeek"("lineId", "weekIndex");
ALTER TABLE "ProductionControlWeek" ADD CONSTRAINT "ProductionControlWeek_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "ProductionControlLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionControlRevision" (
  "id" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionControlRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionControlRevision_lineId_changedAt_idx"
  ON "ProductionControlRevision"("lineId", "changedAt");
ALTER TABLE "ProductionControlRevision" ADD CONSTRAINT "ProductionControlRevision_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "ProductionControlLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
