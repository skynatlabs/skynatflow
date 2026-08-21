-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED');

-- CreateTable
CREATE TABLE "ai_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "touchNumber" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ai_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_drafts_tenantId_status_idx" ON "ai_drafts"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
