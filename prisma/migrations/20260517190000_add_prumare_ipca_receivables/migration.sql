CREATE TYPE "PrumareReceivableType" AS ENUM ('ENTRADA', 'PARCELA', 'REFORCO');

CREATE TABLE "PrumareIpcaIndex" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "percent" DECIMAL(8,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrumareIpcaIndex_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrumareReceivable" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" "PrumareReceivableType" NOT NULL,
    "installmentNo" INTEGER,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "baseValue" DECIMAL(14,2) NOT NULL,
    "correctedValue" DECIMAL(14,2) NOT NULL,
    "appliedIpcaRate" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "ipcaSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrumareReceivable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrumareIpcaIndex_year_month_key" ON "PrumareIpcaIndex"("year", "month");
CREATE INDEX "PrumareIpcaIndex_year_month_idx" ON "PrumareIpcaIndex"("year", "month");
CREATE INDEX "PrumareReceivable_enterpriseId_idx" ON "PrumareReceivable"("enterpriseId");
CREATE INDEX "PrumareReceivable_lotId_idx" ON "PrumareReceivable"("lotId");
CREATE INDEX "PrumareReceivable_dueDate_idx" ON "PrumareReceivable"("dueDate");
CREATE INDEX "PrumareReceivable_type_idx" ON "PrumareReceivable"("type");

ALTER TABLE "PrumareReceivable" ADD CONSTRAINT "PrumareReceivable_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "PrumareEnterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrumareReceivable" ADD CONSTRAINT "PrumareReceivable_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "PrumareLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
