-- CreateTable
CREATE TABLE "portal_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transactionId" TEXT,
    "body" TEXT,
    "fileName" TEXT,
    "fileDataUrl" TEXT,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_submissions_tenantId_handledAt_idx" ON "portal_submissions"("tenantId", "handledAt");

-- CreateIndex
CREATE INDEX "portal_submissions_tenantId_createdAt_idx" ON "portal_submissions"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

