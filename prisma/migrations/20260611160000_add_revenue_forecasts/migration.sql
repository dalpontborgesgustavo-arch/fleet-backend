CREATE TABLE "RevenueForecast" (
    "id" TEXT NOT NULL,
    "obra" TEXT NOT NULL,
    "valorPrevisto" DECIMAL(14,2) NOT NULL,
    "mes" INTEGER NOT NULL,
    "ano" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Sem NF',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueForecast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevenueForecast_mes_ano_idx" ON "RevenueForecast"("mes", "ano");
CREATE INDEX "RevenueForecast_status_idx" ON "RevenueForecast"("status");
CREATE INDEX "RevenueForecast_createdById_idx" ON "RevenueForecast"("createdById");

ALTER TABLE "RevenueForecast"
ADD CONSTRAINT "RevenueForecast_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
