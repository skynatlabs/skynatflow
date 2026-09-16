-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "autoMatchAtOrAbove" INTEGER,
ADD COLUMN     "feedConnectedAt" TIMESTAMP(3),
ADD COLUMN     "feedError" TEXT,
ADD COLUMN     "feedLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "feedProvider" TEXT,
ADD COLUMN     "feedRef" TEXT,
ADD COLUMN     "feedSecretEnc" TEXT;

