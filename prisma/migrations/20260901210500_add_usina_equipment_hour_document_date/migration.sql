BEGIN;

ALTER TABLE "UsinaAsphaltEquipmentHourFact"
ADD COLUMN "documentDate" DATE;

CREATE INDEX "UsinaAsphaltEquipmentHourFact_document_date_idx"
ON "UsinaAsphaltEquipmentHourFact"("documentDate");

COMMIT;
