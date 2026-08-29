-- CreateEnum
CREATE TYPE "EcommercePlatform" AS ENUM ('WOOCOMMERCE');

-- CreateTable
CREATE TABLE "ecommerce_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" "EcommercePlatform" NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "consumerKey" TEXT,
    "consumerSecretEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastProductSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ecommerce_integrations_tenantId_idx" ON "ecommerce_integrations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_integrations_tenantId_platform_key" ON "ecommerce_integrations"("tenantId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_orders_invoiceId_key" ON "ecommerce_orders"("invoiceId");

-- CreateIndex
CREATE INDEX "ecommerce_orders_tenantId_idx" ON "ecommerce_orders"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_orders_integrationId_externalOrderId_key" ON "ecommerce_orders"("integrationId", "externalOrderId");

-- AddForeignKey
ALTER TABLE "ecommerce_integrations" ADD CONSTRAINT "ecommerce_integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ecommerce_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
