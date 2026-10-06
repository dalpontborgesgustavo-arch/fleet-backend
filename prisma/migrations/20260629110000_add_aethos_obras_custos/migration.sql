CREATE TABLE "AethosObraCusto" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "competencia" TEXT NOT NULL,
    "custoTotal" DECIMAL(18,2) NOT NULL,
    "origem" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosObraCusto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosObraCusto_code_competencia_origem_key" ON "AethosObraCusto"("code", "competencia", "origem");
CREATE INDEX "AethosObraCusto_code_idx" ON "AethosObraCusto"("code");
CREATE INDEX "AethosObraCusto_competencia_idx" ON "AethosObraCusto"("competencia");
CREATE INDEX "AethosObraCusto_active_idx" ON "AethosObraCusto"("active");
