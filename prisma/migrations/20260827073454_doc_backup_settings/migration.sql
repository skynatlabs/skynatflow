-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "docBackupConnected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "docBackupProvider" TEXT;
