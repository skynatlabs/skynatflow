-- AlterEnum
ALTER TYPE "EmailCategory" ADD VALUE 'PAYMENT_REPLY';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_PROOF_RECEIVED';

-- AlterTable
ALTER TABLE "inbound_emails" ADD COLUMN     "looksLikePaymentProof" BOOLEAN NOT NULL DEFAULT false;
