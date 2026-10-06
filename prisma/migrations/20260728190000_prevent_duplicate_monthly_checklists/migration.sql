CREATE UNIQUE INDEX "Checklist_monthly_vehicle_period_key"
ON "Checklist" ("vehicleId", "year", "month")
WHERE "type" = 'MONTHLY' AND "vehicleId" IS NOT NULL;
