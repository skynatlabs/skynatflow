-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('COMPLIANCE_FILING', 'LICENCE', 'CERTIFICATE', 'TAX', 'INSURANCE', 'CONTRACT', 'WARRANTY', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ObligationRecurrence" AS ENUM ('NONE', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ObligationSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('OPEN', 'DONE', 'WAIVED');

-- CreateTable
CREATE TABLE "obligations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "reference" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "recurrence" "ObligationRecurrence" NOT NULL DEFAULT 'NONE',
    "severity" "ObligationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "leadDays" INTEGER NOT NULL DEFAULT 30,
    "consequence" TEXT,
    "noticeDays" INTEGER,
    "autoRenews" BOOLEAN NOT NULL DEFAULT false,
    "blocksWork" BOOLEAN NOT NULL DEFAULT false,
    "partyId" TEXT,
    "membershipId" TEXT,
    "itemId" TEXT,
    "transactionId" TEXT,
    "completedAt" TIMESTAMP(3),
    "documentDataUrl" TEXT,
    "notes" TEXT,
    "previousId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obligations_tenantId_status_dueAt_idx" ON "obligations"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "obligations_tenantId_kind_idx" ON "obligations"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "obligations_tenantId_blocksWork_status_idx" ON "obligations"("tenantId", "blocksWork", "status");

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
