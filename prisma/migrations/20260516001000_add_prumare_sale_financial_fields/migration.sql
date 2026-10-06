ALTER TABLE "PrumareLot" ADD COLUMN "saleContractNumber" TEXT;
ALTER TABLE "PrumareLot" ADD COLUMN "saleDownPayment" DECIMAL(14, 2);
ALTER TABLE "PrumareLot" ADD COLUMN "saleInstallments" INTEGER;
ALTER TABLE "PrumareLot" ADD COLUMN "saleFirstInstallmentDate" TIMESTAMP(3);
ALTER TABLE "PrumareLot" ADD COLUMN "saleDueDay" INTEGER;
ALTER TABLE "PrumareLot" ADD COLUMN "saleAnnualReinforcement" DECIMAL(14, 2);
ALTER TABLE "PrumareLot" ADD COLUMN "saleMonthlyRatePercent" DECIMAL(8, 4);

CREATE INDEX "PrumareLot_saleFirstInstallmentDate_idx" ON "PrumareLot"("saleFirstInstallmentDate");
