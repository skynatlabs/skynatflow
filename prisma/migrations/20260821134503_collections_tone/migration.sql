-- CreateEnum
CREATE TYPE "CollectionsTone" AS ENUM ('GENTLE', 'STANDARD', 'FIRM');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "collectionsTone" "CollectionsTone" NOT NULL DEFAULT 'STANDARD';
