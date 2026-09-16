
-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "currency" TEXT;

-- CreateTable
CREATE TABLE "payment_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "agreedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_plan_instalments" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_plan_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "onDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "reference" TEXT,
    "issuedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "taxCents" INTEGER,
    "currency" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentRunId" TEXT,
    "purchaseOrderId" TEXT,
    "expenseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_returns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "boxes" JSONB NOT NULL,
    "outputCents" INTEGER NOT NULL,
    "inputCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filedAt" TIMESTAMP(3),
    "filedById" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "body" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_coding_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchOn" TEXT NOT NULL,
    "accountId" TEXT,
    "category" TEXT,
    "isOwnerDrawing" BOOLEAN,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_coding_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_plans_transactionId_key" ON "payment_plans"("transactionId");

-- CreateIndex
CREATE INDEX "payment_plans_tenantId_idx" ON "payment_plans"("tenantId");

-- CreateIndex
CREATE INDEX "payment_plan_instalments_planId_idx" ON "payment_plan_instalments"("planId");

-- CreateIndex
CREATE INDEX "fx_rates_base_quote_idx" ON "fx_rates"("base", "quote");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_quote_onDate_key" ON "fx_rates"("base", "quote", "onDate");

-- CreateIndex
CREATE INDEX "supplier_bills_tenantId_status_idx" ON "supplier_bills"("tenantId", "status");

-- CreateIndex
CREATE INDEX "supplier_bills_tenantId_dueOn_idx" ON "supplier_bills"("tenantId", "dueOn");

-- CreateIndex
CREATE INDEX "supplier_bills_tenantId_supplierId_idx" ON "supplier_bills"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "payment_runs_tenantId_status_idx" ON "payment_runs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "vat_returns_tenantId_status_idx" ON "vat_returns"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vat_returns_tenantId_periodStart_periodEnd_key" ON "vat_returns"("tenantId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "collection_attempts_tenantId_transactionId_idx" ON "collection_attempts"("tenantId", "transactionId");

-- CreateIndex
CREATE INDEX "collection_attempts_tenantId_sentAt_idx" ON "collection_attempts"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "expense_coding_rules_tenantId_idx" ON "expense_coding_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_coding_rules_tenantId_matchOn_key" ON "expense_coding_rules"("tenantId", "matchOn");

-- AddForeignKey
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan_instalments" ADD CONSTRAINT "payment_plan_instalments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "payment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_paymentRunId_fkey" FOREIGN KEY ("paymentRunId") REFERENCES "payment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_coding_rules" ADD CONSTRAINT "expense_coding_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

