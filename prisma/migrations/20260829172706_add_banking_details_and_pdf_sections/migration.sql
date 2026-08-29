-- AlterTable
ALTER TABLE "tenant_pdf_templates" ADD COLUMN     "hiddenSections" JSONB,
ADD COLUMN     "sectionOrder" JSONB;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankBranchCode" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankSwift" TEXT,
ADD COLUMN     "whatsappVerifyNumber" TEXT;
