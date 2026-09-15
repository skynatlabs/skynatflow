-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastStatementBalanceCents" INTEGER,
    "lastStatementAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postedOn" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amountCents" INTEGER NOT NULL,
    "balanceCents" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedEntryId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchText" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "timesOverruled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_idx" ON "bank_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "bank_transactions_tenantId_status_idx" ON "bank_transactions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_postedOn_idx" ON "bank_transactions"("bankAccountId", "postedOn");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_fingerprint_key" ON "bank_transactions"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "reconciliation_rules_tenantId_idx" ON "reconciliation_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_rules_tenantId_matchText_key" ON "reconciliation_rules"("tenantId", "matchText");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matchedEntryId_fkey" FOREIGN KEY ("matchedEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
