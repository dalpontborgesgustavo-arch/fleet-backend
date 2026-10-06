CREATE TABLE "TaxForecast" (
  "id" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "taxType" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "forecastAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "actualAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaxForecast_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxForecast_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaxForecast_company_taxType_year_month_key"
  ON "TaxForecast"("company", "taxType", "year", "month");

CREATE INDEX "TaxForecast_year_month_idx"
  ON "TaxForecast"("year", "month");

CREATE INDEX "TaxForecast_company_idx"
  ON "TaxForecast"("company");

CREATE INDEX "TaxForecast_taxType_idx"
  ON "TaxForecast"("taxType");

CREATE INDEX "TaxForecast_updatedById_idx"
  ON "TaxForecast"("updatedById");
