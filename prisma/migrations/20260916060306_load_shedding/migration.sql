-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "powerAreaLabel" TEXT,
ADD COLUMN     "powerBlocks" JSONB,
ADD COLUMN     "powerStage" INTEGER;

