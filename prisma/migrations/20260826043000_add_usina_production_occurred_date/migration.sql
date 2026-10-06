BEGIN;

ALTER TABLE "UsinaProductionFact"
  ADD COLUMN "occurredDate" DATE;

UPDATE "UsinaProductionFact"
SET "occurredDate" = ("occurredAt" AT TIME ZONE 'America/Sao_Paulo')::DATE
WHERE "occurredDate" IS NULL;

ALTER TABLE "UsinaProductionFact"
  ALTER COLUMN "occurredDate" SET NOT NULL;

ALTER TABLE "UsinaProductionFact"
  ADD CONSTRAINT "UsinaProductionFact_competence_date_check" CHECK (
    "competence" = DATE_TRUNC('month', "occurredDate")::DATE
  );

CREATE INDEX "UsinaProductionFact_occurred_date_idx"
  ON "UsinaProductionFact"("companyId", "unitId", "occurredDate", "active");

COMMIT;
