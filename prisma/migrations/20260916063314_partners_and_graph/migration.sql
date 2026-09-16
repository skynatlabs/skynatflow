-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "listedInGraph" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referredByCode" TEXT;

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bookkeeper',
    "contactEmail" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_ownerUserId_idx" ON "partners"("ownerUserId");

