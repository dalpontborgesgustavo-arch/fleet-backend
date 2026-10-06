-- CreateTable
CREATE TABLE "TopographyArrival" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workDate" TEXT NOT NULL,
  "obra" TEXT NOT NULL,
  "arrivalAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TopographyArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopographyArrival_userId_workDate_key" ON "TopographyArrival"("userId", "workDate");

-- CreateIndex
CREATE INDEX "TopographyArrival_userId_idx" ON "TopographyArrival"("userId");

-- CreateIndex
CREATE INDEX "TopographyArrival_workDate_idx" ON "TopographyArrival"("workDate");

-- CreateIndex
CREATE INDEX "TopographyArrival_arrivalAt_idx" ON "TopographyArrival"("arrivalAt");

-- AddForeignKey
ALTER TABLE "TopographyArrival" ADD CONSTRAINT "TopographyArrival_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
