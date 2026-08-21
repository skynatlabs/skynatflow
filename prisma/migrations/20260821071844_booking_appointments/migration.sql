-- AlterTable
ALTER TABLE "events" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "bookingConfig" JSONB;

-- CreateIndex
CREATE INDEX "events_tenantId_scheduledAt_idx" ON "events"("tenantId", "scheduledAt");
