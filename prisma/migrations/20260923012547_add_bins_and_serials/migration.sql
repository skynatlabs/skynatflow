-- CreateTable
CREATE TABLE "stock_bins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT,
    "pickSequence" INTEGER NOT NULL DEFAULT 0,
    "isPickable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_placements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "countedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_serials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT,
    "code" TEXT NOT NULL,
    "batchId" TEXT,
    "soldToPartyId" TEXT,
    "soldAt" TIMESTAMP(3),
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_serial_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serialId" TEXT,
    "codeTried" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "checkedByPhone" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_serial_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_bins_tenantId_pickSequence_idx" ON "stock_bins"("tenantId", "pickSequence");

-- CreateIndex
CREATE UNIQUE INDEX "stock_bins_tenantId_code_key" ON "stock_bins"("tenantId", "code");

-- CreateIndex
CREATE INDEX "stock_placements_tenantId_itemId_idx" ON "stock_placements"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_placements_binId_itemId_batchId_key" ON "stock_placements"("binId", "itemId", "batchId");

-- CreateIndex
CREATE INDEX "product_serials_tenantId_itemId_idx" ON "product_serials"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "product_serials_tenantId_code_key" ON "product_serials"("tenantId", "code");

-- CreateIndex
CREATE INDEX "product_serial_checks_tenantId_checkedAt_idx" ON "product_serial_checks"("tenantId", "checkedAt");

-- CreateIndex
CREATE INDEX "product_serial_checks_tenantId_verdict_idx" ON "product_serial_checks"("tenantId", "verdict");

-- AddForeignKey
ALTER TABLE "stock_bins" ADD CONSTRAINT "stock_bins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_placements" ADD CONSTRAINT "stock_placements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_placements" ADD CONSTRAINT "stock_placements_binId_fkey" FOREIGN KEY ("binId") REFERENCES "stock_bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_placements" ADD CONSTRAINT "stock_placements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serial_checks" ADD CONSTRAINT "product_serial_checks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serial_checks" ADD CONSTRAINT "product_serial_checks_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "product_serials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
