-- AlterTable
ALTER TABLE "obligations" ADD COLUMN     "lastNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastNotifiedState" TEXT;
