CREATE TYPE "RncType" AS ENUM ('EXTERNAL', 'INTERNAL');

ALTER TABLE "Rnc"
ADD COLUMN "type" "RncType" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN "internalMotivo" TEXT,
ADD COLUMN "internalCausador" TEXT,
ADD COLUMN "internalNomeColaborador" TEXT,
ADD COLUMN "valorNc" DECIMAL(14, 2),
ADD COLUMN "colocarItemSistema" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "internalDescricao" TEXT,
ADD COLUMN "internalQuantidade" DECIMAL(14, 2),
ADD COLUMN "internalUnidadeMedida" TEXT,
ADD COLUMN "internalValorUnitario" DECIMAL(14, 2),
ADD COLUMN "internalValorTotal" DECIMAL(14, 2),
ADD COLUMN "photoUrl" TEXT;

CREATE INDEX "Rnc_type_idx" ON "Rnc"("type");
