-- AlterTable
ALTER TABLE "payment_checkouts" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "webhookEventId" TEXT;

-- AlterTable
ALTER TABLE "payment_gateways" ADD COLUMN     "webhookSecret" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payment_checkouts_webhookEventId_key" ON "payment_checkouts"("webhookEventId");

-- CreateIndex
CREATE INDEX "payment_checkouts_reference_idx" ON "payment_checkouts"("reference");

