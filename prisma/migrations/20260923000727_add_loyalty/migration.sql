-- CreateEnum
CREATE TYPE "LoyaltyEntryKind" AS ENUM ('EARNED', 'REDEEMED', 'ADJUSTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Rewards',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "earnPointsPerUnit" INTEGER NOT NULL DEFAULT 1,
    "redeemCentsPerPoint" INTEGER NOT NULL DEFAULT 10,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 50,
    "expireAfterDays" INTEGER,
    "autoEnrol" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePointsEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpendCents" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LoyaltyEntryKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "transactionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "loyalty_programs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_partyId_key" ON "loyalty_accounts"("partyId");

-- CreateIndex
CREATE INDEX "loyalty_accounts_tenantId_pointsBalance_idx" ON "loyalty_accounts"("tenantId", "pointsBalance");

-- CreateIndex
CREATE INDEX "loyalty_accounts_tenantId_lastActivityAt_idx" ON "loyalty_accounts"("tenantId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_tenantId_partyId_key" ON "loyalty_accounts"("tenantId", "partyId");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_createdAt_idx" ON "loyalty_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entries_accountId_createdAt_idx" ON "loyalty_entries"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
