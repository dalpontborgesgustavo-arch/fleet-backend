CREATE TABLE "RncItem" (
  "id" TEXT NOT NULL,
  "rncId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,2) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitValue" DECIMAL(14,2) NOT NULL,
  "totalValue" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "includedAt" TIMESTAMP(3),
  "includedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RncItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RncItem_rncId_idx" ON "RncItem"("rncId");
CREATE INDEX "RncItem_status_idx" ON "RncItem"("status");
CREATE INDEX "RncItem_includedById_idx" ON "RncItem"("includedById");

ALTER TABLE "RncItem" ADD CONSTRAINT "RncItem_rncId_fkey" FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RncItem" ADD CONSTRAINT "RncItem_includedById_fkey" FOREIGN KEY ("includedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
