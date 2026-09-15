-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE INDEX "transactions_tenantId_type_externalRef_idx" ON "transactions"("tenantId", "type", "externalRef");

