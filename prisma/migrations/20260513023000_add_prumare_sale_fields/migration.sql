ALTER TABLE "PrumareLot" ADD COLUMN "buyerName" TEXT;
ALTER TABLE "PrumareLot" ADD COLUMN "soldAt" TIMESTAMP(3);
ALTER TABLE "PrumareLot" ADD COLUMN "salePrice" DECIMAL(14, 2);
ALTER TABLE "PrumareLot" ADD COLUMN "paymentCondition" TEXT;
ALTER TABLE "PrumareLot" ADD COLUMN "saleNotes" TEXT;

CREATE INDEX "PrumareLot_soldAt_idx" ON "PrumareLot"("soldAt");
