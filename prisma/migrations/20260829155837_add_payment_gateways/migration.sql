-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('YOCO', 'PAYFAST', 'PEACH_PAYMENTS', 'OZOW', 'IKHOKHA', 'SNAPSCAN', 'PAYSTACK', 'NETCASH', 'STRIPE', 'PAYPAL', 'SQUARE', 'AUTHORIZE_NET', 'BRAINTREE');

-- CreateTable
CREATE TABLE "payment_gateways" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "region" TEXT NOT NULL,
    "publicKey" TEXT,
    "secretKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_checkouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_gateways_tenantId_idx" ON "payment_gateways"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateways_tenantId_provider_key" ON "payment_gateways"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "payment_checkouts_tenantId_idx" ON "payment_checkouts"("tenantId");

-- CreateIndex
CREATE INDEX "payment_checkouts_invoiceId_idx" ON "payment_checkouts"("invoiceId");

-- AddForeignKey
ALTER TABLE "payment_gateways" ADD CONSTRAINT "payment_gateways_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
