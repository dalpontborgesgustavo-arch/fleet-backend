-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "plate" TEXT NOT NULL,
    "model" TEXT,
    "fleet" TEXT,
    "type" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "tipoFrota" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
