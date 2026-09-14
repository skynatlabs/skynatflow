
-- AlterTable
ALTER TABLE "tenant_pdf_templates" ADD COLUMN     "backgroundHex" TEXT,
ADD COLUMN     "marginBottomIn" DOUBLE PRECISION,
ADD COLUMN     "marginLeftIn" DOUBLE PRECISION,
ADD COLUMN     "marginRightIn" DOUBLE PRECISION,
ADD COLUMN     "marginTopIn" DOUBLE PRECISION,
ADD COLUMN     "orientation" TEXT;

