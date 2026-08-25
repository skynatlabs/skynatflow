-- CreateTable
CREATE TABLE "item_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_batches_tenantId_idx" ON "item_batches"("tenantId");

-- CreateIndex
CREATE INDEX "item_batches_itemId_expiresAt_idx" ON "item_batches"("itemId", "expiresAt");

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
