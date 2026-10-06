CREATE TABLE "PrumarePriceAdjustment" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "percent" DECIMAL(8,4) NOT NULL,
    "affectedLots" INTEGER NOT NULL,
    "previousTotal" DECIMAL(14,2) NOT NULL,
    "newTotal" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrumarePriceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrumarePriceAdjustment_enterpriseId_idx" ON "PrumarePriceAdjustment"("enterpriseId");
CREATE INDEX "PrumarePriceAdjustment_createdAt_idx" ON "PrumarePriceAdjustment"("createdAt");
CREATE INDEX "PrumarePriceAdjustment_createdBy_idx" ON "PrumarePriceAdjustment"("createdBy");

ALTER TABLE "PrumarePriceAdjustment"
ADD CONSTRAINT "PrumarePriceAdjustment_enterpriseId_fkey"
FOREIGN KEY ("enterpriseId") REFERENCES "PrumareEnterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
