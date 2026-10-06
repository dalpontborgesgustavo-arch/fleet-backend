CREATE TABLE "EnvironmentalEmissionFactor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope" INTEGER NOT NULL,
    "gas" TEXT NOT NULL DEFAULT 'CO2e',
    "factorValue" DECIMAL(20,10) NOT NULL,
    "activityUnit" TEXT NOT NULL,
    "emissionUnit" TEXT NOT NULL DEFAULT 'kgCO2e',
    "source" TEXT NOT NULL,
    "version" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnvironmentalEmissionFactor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnvironmentalRecord" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT 'JR_CONSTRUCOES',
    "competence" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3),
    "site" TEXT,
    "asset" TEXT,
    "amount" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "co2eKg" DECIMAL(20,6),
    "factorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "details" JSONB NOT NULL DEFAULT '{}',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalKey" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnvironmentalRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnvironmentalRecord_externalKey_key" ON "EnvironmentalRecord"("externalKey");
CREATE INDEX "EnvironmentalEmissionFactor_active_category_idx" ON "EnvironmentalEmissionFactor"("active", "category");
CREATE INDEX "EnvironmentalEmissionFactor_scope_idx" ON "EnvironmentalEmissionFactor"("scope");
CREATE INDEX "EnvironmentalEmissionFactor_createdById_idx" ON "EnvironmentalEmissionFactor"("createdById");
CREATE INDEX "EnvironmentalRecord_domain_competence_idx" ON "EnvironmentalRecord"("domain", "competence");
CREATE INDEX "EnvironmentalRecord_company_competence_idx" ON "EnvironmentalRecord"("company", "competence");
CREATE INDEX "EnvironmentalRecord_metric_competence_idx" ON "EnvironmentalRecord"("metric", "competence");
CREATE INDEX "EnvironmentalRecord_site_idx" ON "EnvironmentalRecord"("site");
CREATE INDEX "EnvironmentalRecord_factorId_idx" ON "EnvironmentalRecord"("factorId");
CREATE INDEX "EnvironmentalRecord_createdById_idx" ON "EnvironmentalRecord"("createdById");
CREATE INDEX "EnvironmentalRecord_updatedById_idx" ON "EnvironmentalRecord"("updatedById");
CREATE INDEX "EnvironmentalRecord_active_idx" ON "EnvironmentalRecord"("active");

ALTER TABLE "EnvironmentalEmissionFactor"
ADD CONSTRAINT "EnvironmentalEmissionFactor_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnvironmentalRecord"
ADD CONSTRAINT "EnvironmentalRecord_factorId_fkey"
FOREIGN KEY ("factorId") REFERENCES "EnvironmentalEmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnvironmentalRecord"
ADD CONSTRAINT "EnvironmentalRecord_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnvironmentalRecord"
ADD CONSTRAINT "EnvironmentalRecord_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnvironmentalEmissionFactor"
ADD CONSTRAINT "EnvironmentalEmissionFactor_scope_check" CHECK ("scope" BETWEEN 1 AND 3);

ALTER TABLE "EnvironmentalRecord"
ADD CONSTRAINT "EnvironmentalRecord_amount_nonnegative_check" CHECK ("amount" >= 0);

ALTER TABLE "EnvironmentalRecord"
ADD CONSTRAINT "EnvironmentalRecord_co2e_nonnegative_check" CHECK ("co2eKg" IS NULL OR "co2eKg" >= 0);
