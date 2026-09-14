-- AlterTable
ALTER TABLE "tenant_pdf_templates" ADD COLUMN     "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "fontScale" DOUBLE PRECISION,
ADD COLUMN     "mutedColorHex" TEXT,
ADD COLUMN     "pageMargin" TEXT,
ADD COLUMN     "pageSize" TEXT,
ADD COLUMN     "sections" JSONB,
ADD COLUMN     "textColorHex" TEXT;

