-- AlterTable
ALTER TABLE "items" ADD COLUMN     "category" TEXT,
ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRatePercent" INTEGER;

-- CreateIndex
CREATE INDEX "items_tenantId_isActive_idx" ON "items"("tenantId", "isActive");
