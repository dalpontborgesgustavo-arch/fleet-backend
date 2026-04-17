-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OccurrenceSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "checklistId" TEXT,
    "questionId" TEXT,
    "questionLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "OccurrenceSeverity" NOT NULL DEFAULT 'MEDIUM',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrencePhoto" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccurrencePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Occurrence_vehicleId_idx" ON "Occurrence"("vehicleId");

-- CreateIndex
CREATE INDEX "Occurrence_checklistId_idx" ON "Occurrence"("checklistId");

-- CreateIndex
CREATE INDEX "Occurrence_createdBy_idx" ON "Occurrence"("createdBy");

-- CreateIndex
CREATE INDEX "Occurrence_status_idx" ON "Occurrence"("status");

-- CreateIndex
CREATE INDEX "OccurrencePhoto_occurrenceId_idx" ON "OccurrencePhoto"("occurrenceId");

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrencePhoto" ADD CONSTRAINT "OccurrencePhoto_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
