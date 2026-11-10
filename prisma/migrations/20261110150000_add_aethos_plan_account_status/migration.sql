CREATE TABLE "AethosPlanoConta" (
    "idSubnivel" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosPlanoConta_pkey" PRIMARY KEY ("idSubnivel")
);

CREATE TABLE "AethosPlanoContaStatusEvent" (
    "id" SERIAL NOT NULL,
    "idSubnivel" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL,
    "effectiveAt" DATE NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "AethosPlanoContaStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AethosPlanoConta_ativo_idx" ON "AethosPlanoConta"("ativo");
CREATE INDEX "AethosPlanoContaStatusEvent_idSubnivel_effectiveAt_observedAt_idx" ON "AethosPlanoContaStatusEvent"("idSubnivel", "effectiveAt", "observedAt");
CREATE INDEX "AethosPlanoContaStatusEvent_effectiveAt_idx" ON "AethosPlanoContaStatusEvent"("effectiveAt");

ALTER TABLE "AethosPlanoContaStatusEvent"
    ADD CONSTRAINT "AethosPlanoContaStatusEvent_idSubnivel_fkey"
    FOREIGN KEY ("idSubnivel") REFERENCES "AethosPlanoConta"("idSubnivel")
    ON DELETE RESTRICT ON UPDATE CASCADE;
