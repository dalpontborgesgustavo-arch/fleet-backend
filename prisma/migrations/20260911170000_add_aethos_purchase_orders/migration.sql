CREATE TABLE "AethosPurchaseOrder" (
  "id" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "companyCode" TEXT NOT NULL,
  "companyName" TEXT,
  "supplierName" TEXT,
  "issuedAt" DATE NOT NULL,
  "competence" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sourceStatus" TEXT,
  "approvalStatus" TEXT NOT NULL,
  "sourceApprovalStatus" TEXT,
  "requesterName" TEXT,
  "buyerName" TEXT,
  "pendingApproverName" TEXT,
  "approvedByName" TEXT,
  "approvedAt" TIMESTAMP(3),
  "expectedDeliveryAt" DATE,
  "totalAmount" DECIMAL(18,3) NOT NULL,
  "notes" TEXT,
  "raw" JSONB,
  "sourceUpdatedAt" TIMESTAMP(3),
  "extractedAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "contentHash" TEXT NOT NULL,
  "lastRunId" TEXT NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AethosPurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AethosPurchaseOrder_status_check" CHECK ("status" IN ('DRAFT','OPEN','PARTIALLY_FULFILLED','FULFILLED','COMPLETED','CANCELLED','UNKNOWN')),
  CONSTRAINT "AethosPurchaseOrder_approvalStatus_check" CHECK ("approvalStatus" IN ('APPROVED','PENDING_APPROVAL','REAPPROVAL_REQUIRED','PARTIALLY_APPROVED','REJECTED','NOT_REQUIRED','UNKNOWN'))
);
CREATE UNIQUE INDEX "AethosPurchaseOrder_companyCode_sourceOrderId_key" ON "AethosPurchaseOrder"("companyCode", "sourceOrderId");
CREATE INDEX "AethosPurchaseOrder_competence_active_idx" ON "AethosPurchaseOrder"("competence", "active");
CREATE INDEX "AethosPurchaseOrder_status_idx" ON "AethosPurchaseOrder"("status");
CREATE INDEX "AethosPurchaseOrder_approvalStatus_idx" ON "AethosPurchaseOrder"("approvalStatus");
CREATE INDEX "AethosPurchaseOrder_companyCode_idx" ON "AethosPurchaseOrder"("companyCode");
CREATE INDEX "AethosPurchaseOrder_pendingApproverName_idx" ON "AethosPurchaseOrder"("pendingApproverName");

CREATE TABLE "AethosPurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "lineType" TEXT NOT NULL DEFAULT 'ITEM',
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(18,6),
  "unit" TEXT,
  "unitPrice" DECIMAL(18,6),
  "totalAmount" DECIMAL(18,3) NOT NULL,
  "accountCode" TEXT,
  "accountName" TEXT,
  "pendingAmount" DECIMAL(18,3),
  "approvedAmount" DECIMAL(18,3),
  "openCommitmentAmount" DECIMAL(18,3),
  "raw" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AethosPurchaseOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AethosPurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "AethosPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AethosPurchaseOrderItem_orderId_sourceItemId_key" ON "AethosPurchaseOrderItem"("orderId", "sourceItemId");
CREATE INDEX "AethosPurchaseOrderItem_accountCode_idx" ON "AethosPurchaseOrderItem"("accountCode");
CREATE INDEX "AethosPurchaseOrderItem_orderId_active_idx" ON "AethosPurchaseOrderItem"("orderId", "active");

CREATE TABLE "AethosPurchaseOrderHistory" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sourceStatus" TEXT,
  "approvalStatus" TEXT NOT NULL,
  "sourceApprovalStatus" TEXT,
  "totalAmount" DECIMAL(18,3) NOT NULL,
  "active" BOOLEAN NOT NULL,
  "pendingApproverName" TEXT,
  "contentHash" TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AethosPurchaseOrderHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AethosPurchaseOrderHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "AethosPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AethosPurchaseOrderHistory_orderId_createdAt_idx" ON "AethosPurchaseOrderHistory"("orderId", "createdAt");
CREATE INDEX "AethosPurchaseOrderHistory_runId_idx" ON "AethosPurchaseOrderHistory"("runId");

CREATE TABLE "AethosPurchaseOrderSyncRun" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL,
  "receivedCount" INTEGER NOT NULL,
  "appliedCount" INTEGER NOT NULL,
  "staleCount" INTEGER NOT NULL,
  "unchangedCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AethosPurchaseOrderSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AethosPurchaseOrderSyncRun_runId_key" ON "AethosPurchaseOrderSyncRun"("runId");
