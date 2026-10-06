-- CreateEnum
CREATE TYPE "RncStatus" AS ENUM (
  'PENDING_MANAGER_APPROVAL',
  'RETURNED_FOR_ADJUSTMENT',
  'REJECTED',
  'IN_PROGRESS',
  'COMPLETED'
);

-- CreateEnum
CREATE TYPE "RncHistoryAction" AS ENUM (
  'CREATED',
  'RESUBMITTED',
  'UPDATED_PROGRESS',
  'APPROVED',
  'REJECTED',
  'RETURNED'
);

-- CreateTable
CREATE TABLE "Rnc" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "cliente" TEXT NOT NULL,
  "obra" TEXT NOT NULL,
  "dataEntrada" TIMESTAMP(3) NOT NULL,
  "dataLimiteRetorno" TIMESTAMP(3) NOT NULL,
  "etapaObra" TEXT NOT NULL,
  "enquadramentoMotivo" TEXT NOT NULL,
  "valorRetidoInicial" DECIMAL(14,2) NOT NULL,
  "respondido" BOOLEAN NOT NULL DEFAULT false,
  "planoAcaoSolucao" TEXT,
  "status" "RncStatus" NOT NULL DEFAULT 'PENDING_MANAGER_APPROVAL',
  "valorRetido" DECIMAL(14,2),
  "dataAssinatura" TIMESTAMP(3),
  "obs" TEXT,
  "engineerId" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Rnc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RncHistory" (
  "id" TEXT NOT NULL,
  "rncId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" "RncHistoryAction" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rnc_number_key" ON "Rnc"("number");

-- CreateIndex
CREATE INDEX "Rnc_engineerId_idx" ON "Rnc"("engineerId");

-- CreateIndex
CREATE INDEX "Rnc_reviewedById_idx" ON "Rnc"("reviewedById");

-- CreateIndex
CREATE INDEX "Rnc_status_idx" ON "Rnc"("status");

-- CreateIndex
CREATE INDEX "Rnc_dataLimiteRetorno_idx" ON "Rnc"("dataLimiteRetorno");

-- CreateIndex
CREATE INDEX "RncHistory_rncId_idx" ON "RncHistory"("rncId");

-- CreateIndex
CREATE INDEX "RncHistory_actorId_idx" ON "RncHistory"("actorId");

-- AddForeignKey
ALTER TABLE "Rnc" ADD CONSTRAINT "Rnc_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rnc" ADD CONSTRAINT "Rnc_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RncHistory" ADD CONSTRAINT "RncHistory_rncId_fkey" FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RncHistory" ADD CONSTRAINT "RncHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
