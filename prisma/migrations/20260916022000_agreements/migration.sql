-- CreateEnum
CREATE TYPE "AgreementKind" AS ENUM ('PROPOSAL', 'SERVICE', 'RETAINER', 'SUPPLY', 'NDA', 'SUBCONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "AgreementState" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "agreements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL DEFAULT 'PROPOSAL',
    "status" "AgreementState" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "clauses" JSONB NOT NULL,
    "valueCents" INTEGER,
    "recurrence" TEXT,
    "currency" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "transactionId" TEXT,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signatureDataUrl" TEXT,
    "signerName" TEXT,
    "signerIp" TEXT,
    "acceptanceHash" TEXT,
    "declinedAt" TIMESTAMP(3),
    "ourSignerName" TEXT,
    "ourSignatureDataUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agreements_tenantId_status_idx" ON "agreements"("tenantId", "status");

-- CreateIndex
CREATE INDEX "agreements_tenantId_partyId_idx" ON "agreements"("tenantId", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_tenantId_number_key" ON "agreements"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

