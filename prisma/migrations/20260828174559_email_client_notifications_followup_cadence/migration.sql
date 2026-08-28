-- CreateEnum
CREATE TYPE "EmailProviderType" AS ENUM ('GOOGLE', 'IMAP', 'FLOW_HOSTED');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('STATEMENT', 'INVOICE', 'LEGAL', 'QUOTE_REPLY', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('HOT_LEAD', 'IMPORTANT_EMAIL', 'AUTO_FOLLOW_UP_SENT', 'FOLLOW_UP_NEEDS_APPROVAL', 'GENERAL');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "autoRespondEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpRepeatDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "followUpWindowDays" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "EmailProviderType" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapUser" TEXT,
    "imapPasswordEnc" TEXT,
    "flowInboundAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "category" "EmailCategory" NOT NULL DEFAULT 'OTHER',
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "linkedTransactionId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkHref" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "sentViaWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_flowInboundAddress_key" ON "email_accounts"("flowInboundAddress");

-- CreateIndex
CREATE INDEX "email_accounts_tenantId_idx" ON "email_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "inbound_emails_tenantId_isRead_idx" ON "inbound_emails"("tenantId", "isRead");

-- CreateIndex
CREATE INDEX "inbound_emails_tenantId_category_idx" ON "inbound_emails"("tenantId", "category");

-- CreateIndex
CREATE INDEX "notifications_tenantId_isRead_idx" ON "notifications"("tenantId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_tenantId_membershipId_isRead_idx" ON "notifications"("tenantId", "membershipId", "isRead");

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "email_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
