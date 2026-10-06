CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "baseRevenue" DECIMAL(18,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "idSubgrupo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "annualCost" DECIMAL(18,2) NOT NULL,
    "monthlyCost" DECIMAL(18,2) NOT NULL,
    "referenceYear" INTEGER NOT NULL,
    "comparisonValue" DECIMAL(18,2),
    "responsible" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetScenario" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revenue" DECIMAL(18,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetScenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AethosSubgroupActual" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "idSubgrupo" TEXT NOT NULL,
    "descricao" TEXT,
    "competencia" TEXT NOT NULL,
    "valorRealizado" DECIMAL(18,2) NOT NULL,
    "origem" TEXT NOT NULL,
    "obra" TEXT,
    "centroCusto" TEXT,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosSubgroupActual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetVersion_year_name_key" ON "BudgetVersion"("year", "name");
CREATE INDEX "BudgetVersion_year_active_idx" ON "BudgetVersion"("year", "active");

CREATE UNIQUE INDEX "BudgetLine_versionId_idSubgrupo_descricao_key" ON "BudgetLine"("versionId", "idSubgrupo", "descricao");
CREATE INDEX "BudgetLine_versionId_idx" ON "BudgetLine"("versionId");
CREATE INDEX "BudgetLine_idSubgrupo_idx" ON "BudgetLine"("idSubgrupo");
CREATE INDEX "BudgetLine_responsible_idx" ON "BudgetLine"("responsible");
CREATE INDEX "BudgetLine_active_idx" ON "BudgetLine"("active");

CREATE INDEX "BudgetScenario_versionId_idx" ON "BudgetScenario"("versionId");
CREATE INDEX "BudgetScenario_year_month_idx" ON "BudgetScenario"("year", "month");
CREATE INDEX "BudgetScenario_createdById_idx" ON "BudgetScenario"("createdById");

CREATE UNIQUE INDEX "AethosSubgroupActual_matchKey_key" ON "AethosSubgroupActual"("matchKey");
CREATE INDEX "AethosSubgroupActual_idSubgrupo_idx" ON "AethosSubgroupActual"("idSubgrupo");
CREATE INDEX "AethosSubgroupActual_competencia_idx" ON "AethosSubgroupActual"("competencia");
CREATE INDEX "AethosSubgroupActual_active_idx" ON "AethosSubgroupActual"("active");
CREATE INDEX "AethosSubgroupActual_syncedAt_idx" ON "AethosSubgroupActual"("syncedAt");

ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetScenario" ADD CONSTRAINT "BudgetScenario_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetScenario" ADD CONSTRAINT "BudgetScenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
