CREATE TABLE "FleetResultMonthlyWorkforce" (
    "id" TEXT NOT NULL,
    "competence" DATE NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignments" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FleetResultMonthlyWorkforce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FleetResultMonthlyWorkforceAudit" (
    "id" BIGSERIAL NOT NULL,
    "workforceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetResultMonthlyWorkforceAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetResultMonthlyWorkforce_competence_vehicleId_key" ON "FleetResultMonthlyWorkforce"("competence", "vehicleId");
CREATE INDEX "FleetResultMonthlyWorkforce_competence_idx" ON "FleetResultMonthlyWorkforce"("competence");
CREATE INDEX "FleetResultMonthlyWorkforceAudit_workforceId_createdAt_idx" ON "FleetResultMonthlyWorkforceAudit"("workforceId", "createdAt");

ALTER TABLE "FleetResultMonthlyWorkforce" ADD CONSTRAINT "FleetResultMonthlyWorkforce_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetResultMonthlyWorkforceAudit" ADD CONSTRAINT "FleetResultMonthlyWorkforceAudit_workforceId_fkey" FOREIGN KEY ("workforceId") REFERENCES "FleetResultMonthlyWorkforce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
