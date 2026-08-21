-- CreateEnum
CREATE TYPE "QuoteKind" AS ENUM ('BASIC', 'PROPOSAL');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "introText" TEXT,
ADD COLUMN     "quoteKind" "QuoteKind" DEFAULT 'BASIC',
ADD COLUMN     "scopeOfWork" TEXT;
