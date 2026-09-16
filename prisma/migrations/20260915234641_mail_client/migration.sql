-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEnc" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smtpUser" TEXT;

-- AlterTable
ALTER TABLE "inbound_emails" ADD COLUMN     "inReplyTo" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "threadKey" TEXT,
ADD COLUMN     "toAddress" TEXT;

-- AlterTable
ALTER TABLE "notes" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "outbound_emails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailAccountId" TEXT,
    "toAddress" TEXT NOT NULL,
    "ccAddress" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "threadKey" TEXT,
    "inReplyTo" TEXT,
    "messageId" TEXT,
    "partyId" TEXT,
    "sentById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_emails_tenantId_sentAt_idx" ON "outbound_emails"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "outbound_emails_tenantId_threadKey_idx" ON "outbound_emails"("tenantId", "threadKey");

-- CreateIndex
CREATE INDEX "inbound_emails_tenantId_threadKey_idx" ON "inbound_emails"("tenantId", "threadKey");

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

