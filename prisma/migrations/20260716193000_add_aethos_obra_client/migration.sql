ALTER TABLE "AethosObra"
ADD COLUMN "clientName" TEXT;

CREATE INDEX "AethosObra_clientName_idx" ON "AethosObra"("clientName");
