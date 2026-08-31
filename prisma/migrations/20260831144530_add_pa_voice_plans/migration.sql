-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "voiceProvider" TEXT NOT NULL DEFAULT 'browser';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "voicePlan" TEXT NOT NULL DEFAULT 'free';

-- CreateTable
CREATE TABLE "voice_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "charactersUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_usage_tenantId_period_key" ON "voice_usage"("tenantId", "period");
