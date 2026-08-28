-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aiProposalGenerationsResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "aiProposalGenerationsUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "performanceExpectancy" TEXT,
ADD COLUMN     "projectLocation" TEXT,
ADD COLUMN     "projectTimeline" TEXT,
ADD COLUMN     "systemInfo" TEXT;

-- CreateTable
CREATE TABLE "tenant_pdf_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "styleKey" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "accentColorHex" TEXT,
    "logoDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pdf_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_pdf_templates_tenantId_idx" ON "tenant_pdf_templates"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_pdf_templates" ADD CONSTRAINT "tenant_pdf_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
