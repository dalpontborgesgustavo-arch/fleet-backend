-- CreateTable
CREATE TABLE "SsmaLicense" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "issuingAgency" TEXT,
    "licenseNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "responsible" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsmaLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsmaLicenseRenewal" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Planejada',
    "protocolNumber" TEXT,
    "requestedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsmaLicenseRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsmaLicense_company_idx" ON "SsmaLicense"("company");

-- CreateIndex
CREATE INDEX "SsmaLicense_expiryDate_idx" ON "SsmaLicense"("expiryDate");

-- CreateIndex
CREATE INDEX "SsmaLicense_active_idx" ON "SsmaLicense"("active");

-- CreateIndex
CREATE INDEX "SsmaLicense_createdById_idx" ON "SsmaLicense"("createdById");

-- CreateIndex
CREATE INDEX "SsmaLicenseRenewal_licenseId_idx" ON "SsmaLicenseRenewal"("licenseId");

-- CreateIndex
CREATE INDEX "SsmaLicenseRenewal_status_idx" ON "SsmaLicenseRenewal"("status");

-- CreateIndex
CREATE INDEX "SsmaLicenseRenewal_createdById_idx" ON "SsmaLicenseRenewal"("createdById");

-- AddForeignKey
ALTER TABLE "SsmaLicense" ADD CONSTRAINT "SsmaLicense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsmaLicenseRenewal" ADD CONSTRAINT "SsmaLicenseRenewal_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "SsmaLicense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsmaLicenseRenewal" ADD CONSTRAINT "SsmaLicenseRenewal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
