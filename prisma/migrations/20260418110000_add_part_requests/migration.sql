CREATE TYPE "PartRequestStatus" AS ENUM (
  'PENDING_MAINTENANCE_APPROVAL',
  'REJECTED_MAINTENANCE',
  'APPROVED_FOR_PURCHASING',
  'PURCHASED'
);

CREATE TABLE "PartRequest" (
  "id" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "status" "PartRequestStatus" NOT NULL DEFAULT 'PENDING_MAINTENANCE_APPROVAL',
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "purchaseOrder" TEXT,
  "expectedDeliveryAt" TIMESTAMP(3),
  "purchasingNotes" TEXT,
  "purchasedByUserId" TEXT,
  "purchasedAt" TIMESTAMP(3),

  CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartRequest_occurrenceId_idx" ON "PartRequest"("occurrenceId");
CREATE INDEX "PartRequest_status_idx" ON "PartRequest"("status");
CREATE INDEX "PartRequest_requestedByUserId_idx" ON "PartRequest"("requestedByUserId");

ALTER TABLE "PartRequest"
ADD CONSTRAINT "PartRequest_occurrenceId_fkey"
FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
