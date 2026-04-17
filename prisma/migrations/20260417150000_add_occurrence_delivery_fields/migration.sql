-- AlterTable
ALTER TABLE "Occurrence"
ADD COLUMN "entregaLimiteEm" TIMESTAMP(3),
ADD COLUMN "entregueEm" TIMESTAMP(3),
ADD COLUMN "entreguePorUserId" TEXT;

-- CreateIndex
CREATE INDEX "Occurrence_entregaLimiteEm_idx" ON "Occurrence"("entregaLimiteEm");
