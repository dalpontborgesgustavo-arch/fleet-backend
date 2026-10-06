ALTER TABLE "Vehicle"
ADD COLUMN "monthly_checklist_responsible_id" TEXT;

CREATE INDEX "Vehicle_monthly_checklist_responsible_id_idx"
ON "Vehicle"("monthly_checklist_responsible_id");

ALTER TABLE "Vehicle"
ADD CONSTRAINT "Vehicle_monthly_checklist_responsible_id_fkey"
FOREIGN KEY ("monthly_checklist_responsible_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
