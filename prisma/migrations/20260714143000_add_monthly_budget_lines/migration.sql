CREATE TABLE "BudgetMonthlyLine" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetMonthlyLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetMonthlyLine_lineId_year_month_key"
ON "BudgetMonthlyLine"("lineId", "year", "month");

CREATE INDEX "BudgetMonthlyLine_year_month_idx"
ON "BudgetMonthlyLine"("year", "month");

CREATE INDEX "BudgetMonthlyLine_lineId_idx"
ON "BudgetMonthlyLine"("lineId");

ALTER TABLE "BudgetMonthlyLine"
ADD CONSTRAINT "BudgetMonthlyLine_lineId_fkey"
FOREIGN KEY ("lineId") REFERENCES "BudgetLine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Materializa a base atual em 12 competencias independentes. Alterar um mes
-- depois desta migracao nao afeta os demais.
INSERT INTO "BudgetMonthlyLine" (
  "id",
  "lineId",
  "year",
  "month",
  "amount",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT(line."id", ':', line."referenceYear", ':', month_number),
  line."id",
  line."referenceYear",
  month_number,
  line."monthlyCost",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "BudgetLine" AS line
CROSS JOIN generate_series(1, 12) AS month_number;
