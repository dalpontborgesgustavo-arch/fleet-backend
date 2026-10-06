CREATE TYPE "AcceleratorIdeaStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'VALIDATED',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE "AcceleratorRedemptionStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'DELIVERED'
);

CREATE TABLE "AcceleratorTeam" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "leaderId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcceleratorTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcceleratorIdea" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "teamId" TEXT NOT NULL,
  "leaderId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "currentState" TEXT,
  "rootCause" TEXT,
  "proposedImprovement" TEXT NOT NULL,
  "expectedBenefit" TEXT,
  "benefitType" TEXT,
  "impactedArea" TEXT,
  "responsibleName" TEXT,
  "dueDate" TIMESTAMP(3),
  "estimatedCost" DECIMAL(14,2),
  "estimatedGain" DECIMAL(14,2),
  "status" "AcceleratorIdeaStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "managerDecisionNote" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcceleratorIdea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcceleratorIdeaHistory" (
  "id" TEXT NOT NULL,
  "ideaId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "fromStatus" "AcceleratorIdeaStatus",
  "toStatus" "AcceleratorIdeaStatus",
  "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AcceleratorIdeaHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcceleratorCoinTransaction" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "ideaId" TEXT,
  "redemptionId" TEXT,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AcceleratorCoinTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcceleratorStoreProduct" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "photoUrl" TEXT,
  "coinPrice" INTEGER NOT NULL,
  "stock" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcceleratorStoreProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcceleratorRedemption" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "requestedById" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "coinsCost" INTEGER NOT NULL,
  "status" "AcceleratorRedemptionStatus" NOT NULL DEFAULT 'PENDING',
  "voucherCode" TEXT,
  "adminNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcceleratorRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcceleratorIdea_number_key" ON "AcceleratorIdea"("number");
CREATE INDEX "AcceleratorTeam_leaderId_idx" ON "AcceleratorTeam"("leaderId");
CREATE INDEX "AcceleratorTeam_managerId_idx" ON "AcceleratorTeam"("managerId");
CREATE INDEX "AcceleratorTeam_active_idx" ON "AcceleratorTeam"("active");
CREATE INDEX "AcceleratorIdea_teamId_idx" ON "AcceleratorIdea"("teamId");
CREATE INDEX "AcceleratorIdea_leaderId_idx" ON "AcceleratorIdea"("leaderId");
CREATE INDEX "AcceleratorIdea_managerId_idx" ON "AcceleratorIdea"("managerId");
CREATE INDEX "AcceleratorIdea_status_idx" ON "AcceleratorIdea"("status");
CREATE INDEX "AcceleratorIdea_createdAt_idx" ON "AcceleratorIdea"("createdAt");
CREATE INDEX "AcceleratorIdeaHistory_ideaId_idx" ON "AcceleratorIdeaHistory"("ideaId");
CREATE INDEX "AcceleratorIdeaHistory_actorId_idx" ON "AcceleratorIdeaHistory"("actorId");
CREATE INDEX "AcceleratorIdeaHistory_createdAt_idx" ON "AcceleratorIdeaHistory"("createdAt");
CREATE INDEX "AcceleratorCoinTransaction_teamId_idx" ON "AcceleratorCoinTransaction"("teamId");
CREATE INDEX "AcceleratorCoinTransaction_ideaId_idx" ON "AcceleratorCoinTransaction"("ideaId");
CREATE INDEX "AcceleratorCoinTransaction_redemptionId_idx" ON "AcceleratorCoinTransaction"("redemptionId");
CREATE INDEX "AcceleratorCoinTransaction_createdAt_idx" ON "AcceleratorCoinTransaction"("createdAt");
CREATE INDEX "AcceleratorStoreProduct_active_idx" ON "AcceleratorStoreProduct"("active");
CREATE INDEX "AcceleratorStoreProduct_name_idx" ON "AcceleratorStoreProduct"("name");
CREATE INDEX "AcceleratorRedemption_teamId_idx" ON "AcceleratorRedemption"("teamId");
CREATE INDEX "AcceleratorRedemption_productId_idx" ON "AcceleratorRedemption"("productId");
CREATE INDEX "AcceleratorRedemption_requestedById_idx" ON "AcceleratorRedemption"("requestedById");
CREATE INDEX "AcceleratorRedemption_status_idx" ON "AcceleratorRedemption"("status");

ALTER TABLE "AcceleratorTeam" ADD CONSTRAINT "AcceleratorTeam_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcceleratorTeam" ADD CONSTRAINT "AcceleratorTeam_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcceleratorIdea" ADD CONSTRAINT "AcceleratorIdea_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AcceleratorTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcceleratorIdea" ADD CONSTRAINT "AcceleratorIdea_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcceleratorIdea" ADD CONSTRAINT "AcceleratorIdea_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcceleratorIdeaHistory" ADD CONSTRAINT "AcceleratorIdeaHistory_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "AcceleratorIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcceleratorIdeaHistory" ADD CONSTRAINT "AcceleratorIdeaHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AcceleratorCoinTransaction" ADD CONSTRAINT "AcceleratorCoinTransaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AcceleratorTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcceleratorCoinTransaction" ADD CONSTRAINT "AcceleratorCoinTransaction_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "AcceleratorIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AcceleratorRedemption" ADD CONSTRAINT "AcceleratorRedemption_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AcceleratorTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcceleratorRedemption" ADD CONSTRAINT "AcceleratorRedemption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AcceleratorStoreProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcceleratorRedemption" ADD CONSTRAINT "AcceleratorRedemption_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
