-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('ACTIVE', 'COMPLETE', 'SETTLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "progress_agreements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalValueCents" INTEGER NOT NULL,
    "retentionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionDueAt" TIMESTAMP(3),
    "status" "AgreementStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_claims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "percentComplete" DOUBLE PRECISION NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "retentionCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progress_agreements_tenantId_status_idx" ON "progress_agreements"("tenantId", "status");

-- CreateIndex
CREATE INDEX "progress_claims_tenantId_idx" ON "progress_claims"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "progress_claims_agreementId_sequence_key" ON "progress_claims"("agreementId", "sequence");

-- AddForeignKey
ALTER TABLE "progress_agreements" ADD CONSTRAINT "progress_agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_agreements" ADD CONSTRAINT "progress_agreements_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_claims" ADD CONSTRAINT "progress_claims_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "progress_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
