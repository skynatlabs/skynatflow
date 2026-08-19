-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "portalToken" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "firstOpenedAt" TIMESTAMP(3),
ADD COLUMN     "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN     "openCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "signatureDataUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "parties_portalToken_key" ON "parties"("portalToken");

