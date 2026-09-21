-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "agentTier" TEXT NOT NULL DEFAULT 'fast';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aiTier" TEXT;

