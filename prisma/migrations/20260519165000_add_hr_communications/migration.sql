CREATE TABLE "HrCommunication" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "body" TEXT,
  "company" TEXT,
  "department" TEXT,
  "city" TEXT,
  "position" TEXT,
  "requirements" TEXT,
  "benefits" TEXT,
  "contact" TEXT,
  "employeeName" TEXT,
  "previousRole" TEXT,
  "newRole" TEXT,
  "promotionDate" TIMESTAMP(3),
  "imageUrl" TEXT,
  "priority" BOOLEAN NOT NULL DEFAULT false,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HrCommunication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrCommunication_type_idx" ON "HrCommunication"("type");
CREATE INDEX "HrCommunication_status_idx" ON "HrCommunication"("status");
CREATE INDEX "HrCommunication_priority_idx" ON "HrCommunication"("priority");
CREATE INDEX "HrCommunication_promotionDate_idx" ON "HrCommunication"("promotionDate");
CREATE INDEX "HrCommunication_startAt_idx" ON "HrCommunication"("startAt");
CREATE INDEX "HrCommunication_endAt_idx" ON "HrCommunication"("endAt");

ALTER TABLE "HrCommunication"
  ADD CONSTRAINT "HrCommunication_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
