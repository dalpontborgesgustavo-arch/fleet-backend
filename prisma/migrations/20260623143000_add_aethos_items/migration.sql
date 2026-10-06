CREATE TABLE "AethosItem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "unit" TEXT,
  "rawId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AethosItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosItem_code_key" ON "AethosItem"("code");
CREATE INDEX "AethosItem_description_idx" ON "AethosItem"("description");
CREATE INDEX "AethosItem_active_idx" ON "AethosItem"("active");
