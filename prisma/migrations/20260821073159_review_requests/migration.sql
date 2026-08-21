-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "googleReviewUrl" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "reviewRequestSentAt" TIMESTAMP(3);
