-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistQuestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistQuestion_templateId_idx" ON "ChecklistQuestion"("templateId");

-- AddForeignKey
ALTER TABLE "ChecklistQuestion" ADD CONSTRAINT "ChecklistQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
