ALTER TABLE "AethosPurchaseOrder"
ADD COLUMN "pendingApproval" JSONB;

ALTER TABLE "AethosPurchaseOrderHistory"
ADD COLUMN "pendingApproval" JSONB;

CREATE INDEX "AethosPurchaseOrder_pendingApproval_idx"
ON "AethosPurchaseOrder" USING GIN ("pendingApproval");
