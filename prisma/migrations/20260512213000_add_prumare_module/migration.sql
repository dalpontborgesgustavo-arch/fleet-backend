CREATE TYPE "PrumareSimulationKind" AS ENUM ('PRICE', 'TABLE');

CREATE TABLE "PrumareEnterprise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableName" TEXT,
    "registry" TEXT,
    "location" TEXT,
    "city" TEXT,
    "mapUrl" TEXT,
    "status" TEXT,
    "deliveryForecast" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrumareEnterprise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrumareLot" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "lot" TEXT NOT NULL,
    "areaM2" DECIMAL(12,2),
    "price" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Disponivel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrumareLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrumareSimulation" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "lotId" TEXT,
    "kind" "PrumareSimulationKind" NOT NULL,
    "title" TEXT,
    "createdBy" TEXT,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrumareSimulation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrumareLot_enterpriseId_block_lot_key" ON "PrumareLot"("enterpriseId", "block", "lot");
CREATE INDEX "PrumareLot_enterpriseId_idx" ON "PrumareLot"("enterpriseId");
CREATE INDEX "PrumareLot_status_idx" ON "PrumareLot"("status");
CREATE INDEX "PrumareSimulation_enterpriseId_idx" ON "PrumareSimulation"("enterpriseId");
CREATE INDEX "PrumareSimulation_lotId_idx" ON "PrumareSimulation"("lotId");
CREATE INDEX "PrumareSimulation_createdBy_idx" ON "PrumareSimulation"("createdBy");
CREATE INDEX "PrumareSimulation_kind_idx" ON "PrumareSimulation"("kind");

ALTER TABLE "PrumareLot" ADD CONSTRAINT "PrumareLot_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "PrumareEnterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrumareSimulation" ADD CONSTRAINT "PrumareSimulation_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "PrumareEnterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrumareSimulation" ADD CONSTRAINT "PrumareSimulation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "PrumareLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
