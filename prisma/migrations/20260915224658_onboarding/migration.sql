-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedById" TEXT,
ADD COLUMN     "firstQuoteSentAt" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" TEXT;

-- CreateTable
CREATE TABLE "intake_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT,
    "reading" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READ',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_documents_tenantId_createdAt_idx" ON "intake_documents"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "intake_documents" ADD CONSTRAINT "intake_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every workspace that exists already has moved in: only businesses created
-- through the new setup are asked to finish it.
UPDATE "tenants" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
