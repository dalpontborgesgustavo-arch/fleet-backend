CREATE TABLE "AethosPlanoContaCost" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "idLancamento" TEXT NOT NULL,
    "codigoEmpresa" TEXT,
    "nomeEmpresa" TEXT,
    "codigoPlanoConta" TEXT NOT NULL,
    "nomePlanoConta" TEXT,
    "competencia" TEXT NOT NULL,
    "dataBaseLancamento" TIMESTAMP(3),
    "dataLancamento" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3),
    "valorCusto" DECIMAL(18,2) NOT NULL,
    "valorPago" DECIMAL(18,2),
    "valorSaldo" DECIMAL(18,2),
    "status" TEXT,
    "statusDescricao" TEXT,
    "tipoDocumento" TEXT,
    "tipoDocumentoDescricao" TEXT,
    "origem" TEXT NOT NULL,
    "raw" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AethosPlanoContaCost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AethosPlanoContaCost_matchKey_key" ON "AethosPlanoContaCost"("matchKey");
CREATE UNIQUE INDEX "AethosPlanoContaCost_origem_idLancamento_key" ON "AethosPlanoContaCost"("origem", "idLancamento");
CREATE INDEX "AethosPlanoContaCost_codigoPlanoConta_idx" ON "AethosPlanoContaCost"("codigoPlanoConta");
CREATE INDEX "AethosPlanoContaCost_competencia_idx" ON "AethosPlanoContaCost"("competencia");
CREATE INDEX "AethosPlanoContaCost_origem_idx" ON "AethosPlanoContaCost"("origem");
CREATE INDEX "AethosPlanoContaCost_status_idx" ON "AethosPlanoContaCost"("status");
CREATE INDEX "AethosPlanoContaCost_active_idx" ON "AethosPlanoContaCost"("active");
CREATE INDEX "AethosPlanoContaCost_syncedAt_idx" ON "AethosPlanoContaCost"("syncedAt");
CREATE INDEX "AethosPlanoContaCost_dataBaseLancamento_idx" ON "AethosPlanoContaCost"("dataBaseLancamento");
