CREATE TABLE "PrumareBroker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrumareBroker_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PrumareLot" ADD COLUMN "brokerId" TEXT;

CREATE INDEX "PrumareBroker_active_idx" ON "PrumareBroker"("active");
CREATE INDEX "PrumareBroker_name_idx" ON "PrumareBroker"("name");
CREATE INDEX "PrumareLot_brokerId_idx" ON "PrumareLot"("brokerId");

ALTER TABLE "PrumareLot" ADD CONSTRAINT "PrumareLot_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "PrumareBroker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
