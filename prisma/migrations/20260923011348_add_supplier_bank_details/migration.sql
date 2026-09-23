-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- CreateTable
CREATE TABLE "party_bank_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "fromAccountNumber" TEXT,
    "toAccountNumber" TEXT,
    "fromBankName" TEXT,
    "toBankName" TEXT,
    "fromHolder" TEXT,
    "toHolder" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_bank_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "party_bank_changes_tenantId_changedAt_idx" ON "party_bank_changes"("tenantId", "changedAt");

-- CreateIndex
CREATE INDEX "party_bank_changes_partyId_changedAt_idx" ON "party_bank_changes"("partyId", "changedAt");

-- AddForeignKey
ALTER TABLE "party_bank_changes" ADD CONSTRAINT "party_bank_changes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_bank_changes" ADD CONSTRAINT "party_bank_changes_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
