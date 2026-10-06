CREATE TABLE IF NOT EXISTS "AwsInvoiceEmailNotification" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "recipients" TEXT[] NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwsInvoiceEmailNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AwsInvoiceEmailNotification_invoiceId_key"
ON "AwsInvoiceEmailNotification"("invoiceId");

CREATE INDEX IF NOT EXISTS "AwsInvoiceEmailNotification_status_sentAt_idx"
ON "AwsInvoiceEmailNotification"("status", "sentAt");

CREATE INDEX IF NOT EXISTS "AwsInvoiceEmailNotification_billingPeriod_idx"
ON "AwsInvoiceEmailNotification"("billingPeriod");
