ALTER TYPE "PrumareReceivableType" ADD VALUE IF NOT EXISTS 'COMISSAO';

ALTER TABLE "PrumareLot" ADD COLUMN "saleBrokerCommission" DECIMAL(14, 2);
ALTER TABLE "PrumareLot" ADD COLUMN "saleReinforcementMonths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "PrumareIpcaIndex" SET "percent" = 0 WHERE "percent" < 0;
