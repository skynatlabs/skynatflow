-- AlterTable
ALTER TABLE "items" ADD COLUMN     "hsnCode" TEXT;

-- AlterTable
ALTER TABLE "transaction_lines" ADD COLUMN     "discountPercent" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "taxRatePercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "discountPercent" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "subject" TEXT;
