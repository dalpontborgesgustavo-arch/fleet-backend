CREATE TABLE "AsphaltProductionDay" (
 "id" TEXT PRIMARY KEY, "lineId" TEXT REFERENCES "ProductionControlLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "workKey" TEXT NOT NULL, "manualWorkName" TEXT, "manualEngineer" TEXT, "manualMunicipality" TEXT,
 CHECK (("lineId" IS NULL) = ("manualWorkName" IS NOT NULL)),
 "teamId" TEXT NOT NULL REFERENCES "UsinaAsphaltTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "date" DATE NOT NULL, "plannedTon" DECIMAL(16,3) NOT NULL CHECK ("plannedTon" >= 0),
 "plantKey" TEXT NOT NULL DEFAULT 'ICARA', "plantName" TEXT NOT NULL DEFAULT 'Içara',
 "externalTon" DECIMAL(16,3) CHECK ("externalTon" >= 0 AND "plantKey" <> 'ICARA'),
 "reason" TEXT, "details" TEXT, "productionBy" TEXT NOT NULL, "productionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "laboratory" JSONB, "laboratoryBy" TEXT, "laboratoryAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AsphaltProductionDay_workKey_teamId_date_plantKey_key" ON "AsphaltProductionDay"("workKey","teamId","date","plantKey");
CREATE INDEX "AsphaltProductionDay_date_teamId_idx" ON "AsphaltProductionDay"("date","teamId");
CREATE TABLE "AsphaltProductionAccess" ("userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE, "production" BOOLEAN NOT NULL DEFAULT false, "laboratory" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "AsphaltDestination" (
 "factId" TEXT PRIMARY KEY REFERENCES "UsinaProductionFact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "dayId" TEXT NOT NULL REFERENCES "AsphaltProductionDay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
