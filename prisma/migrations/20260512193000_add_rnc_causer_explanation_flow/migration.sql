-- Add RNC causer explanation workflow.
ALTER TYPE "RncStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CAUSER_EXPLANATION';
ALTER TYPE "RncStatus" ADD VALUE IF NOT EXISTS 'CAUSER_EXPLANATION_RECEIVED';

ALTER TYPE "RncHistoryAction" ADD VALUE IF NOT EXISTS 'DIRECTED';
ALTER TYPE "RncHistoryAction" ADD VALUE IF NOT EXISTS 'EXPLANATION_SUBMITTED';

CREATE TYPE "RncAssignmentStatus" AS ENUM ('PENDING', 'ANSWERED', 'CANCELLED');

CREATE TABLE "RncAssignment" (
  "id" TEXT NOT NULL,
  "rncId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedToId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "response" TEXT,
  "status" "RncAssignmentStatus" NOT NULL DEFAULT 'PENDING',
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RncAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RncAssignment_rncId_idx" ON "RncAssignment"("rncId");
CREATE INDEX "RncAssignment_assignedById_idx" ON "RncAssignment"("assignedById");
CREATE INDEX "RncAssignment_assignedToId_idx" ON "RncAssignment"("assignedToId");
CREATE INDEX "RncAssignment_status_idx" ON "RncAssignment"("status");

ALTER TABLE "RncAssignment"
  ADD CONSTRAINT "RncAssignment_rncId_fkey"
  FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RncAssignment"
  ADD CONSTRAINT "RncAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RncAssignment"
  ADD CONSTRAINT "RncAssignment_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
