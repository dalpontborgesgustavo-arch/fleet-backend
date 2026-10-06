CREATE TABLE "AethosObra" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rawId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AethosObra_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosObra_code_key" ON "AethosObra"("code");
CREATE INDEX "AethosObra_name_idx" ON "AethosObra"("name");
CREATE INDEX "AethosObra_active_idx" ON "AethosObra"("active");
