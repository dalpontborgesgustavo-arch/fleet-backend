ALTER TABLE "Rnc" ADD COLUMN "systemItemStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Rnc" ADD COLUMN "systemItemIncludedAt" TIMESTAMP(3);
ALTER TABLE "Rnc" ADD COLUMN "systemItemIncludedById" TEXT;

UPDATE "Rnc"
SET "systemItemStatus" = 'PENDING'
WHERE "colocarItemSistema" = true;

CREATE INDEX "Rnc_systemItemIncludedById_idx" ON "Rnc"("systemItemIncludedById");
CREATE INDEX "Rnc_systemItemStatus_idx" ON "Rnc"("systemItemStatus");

ALTER TABLE "Rnc"
ADD CONSTRAINT "Rnc_systemItemIncludedById_fkey"
FOREIGN KEY ("systemItemIncludedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
