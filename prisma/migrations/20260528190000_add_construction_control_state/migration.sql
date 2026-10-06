CREATE TABLE "ConstructionControlState" (
  "id" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConstructionControlState_pkey" PRIMARY KEY ("id")
);
