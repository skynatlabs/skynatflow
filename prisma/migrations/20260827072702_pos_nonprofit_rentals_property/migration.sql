-- CreateEnum
CREATE TYPE "PosProviderType" AS ENUM ('YOCO', 'IKHOKHA', 'SQUARE', 'ZELLER', 'GENERIC');

-- CreateEnum
CREATE TYPE "InvolvementRole" AS ENUM ('MEMBER', 'VOLUNTEER', 'BOARD', 'STAFF', 'SPONSOR');

-- CreateEnum
CREATE TYPE "RentalRateUnit" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('ACTIVE', 'RETURNED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'LAND');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('AVAILABLE', 'LEASED', 'SOLD', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'ENDED', 'TERMINATED');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PROPERTY_INSPECTION';

-- AlterEnum
ALTER TYPE "NicheSkin" ADD VALUE 'NONPROFIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PartyRole" ADD VALUE 'MEMBER';
ALTER TYPE "PartyRole" ADD VALUE 'SPONSOR';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "isRentable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rentalRateCents" INTEGER,
ADD COLUMN     "rentalRateUnit" "RentalRateUnit";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "tillSessionId" TEXT;

-- CreateTable
CREATE TABLE "till_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openingFloatCents" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closingCountedCents" INTEGER,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "till_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PosProviderType" NOT NULL,
    "region" TEXT NOT NULL,
    "apiKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_involvements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "role" "InvolvementRole" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_involvements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "designatedFund" TEXT,
    "receiptNumber" TEXT,
    "donatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_filings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filingType" TEXT NOT NULL,
    "filingDate" TIMESTAMP(3) NOT NULL,
    "documentDataUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "rateCents" INTEGER NOT NULL,
    "rateUnit" "RentalRateUnit" NOT NULL,
    "depositCents" INTEGER,
    "status" "RentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "transactionId" TEXT,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "ownerPartyId" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "listingPriceCents" INTEGER,
    "rentalRateCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "renterPartyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "monthlyRentCents" INTEGER NOT NULL,
    "depositCents" INTEGER,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "till_sessions_tenantId_idx" ON "till_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "pos_integrations_tenantId_idx" ON "pos_integrations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_integrations_tenantId_provider_key" ON "pos_integrations"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "membership_involvements_tenantId_partyId_idx" ON "membership_involvements"("tenantId", "partyId");

-- CreateIndex
CREATE INDEX "donations_tenantId_donatedAt_idx" ON "donations"("tenantId", "donatedAt");

-- CreateIndex
CREATE INDEX "compliance_filings_tenantId_filingType_idx" ON "compliance_filings"("tenantId", "filingType");

-- CreateIndex
CREATE INDEX "rentals_tenantId_status_idx" ON "rentals"("tenantId", "status");

-- CreateIndex
CREATE INDEX "properties_tenantId_status_idx" ON "properties"("tenantId", "status");

-- CreateIndex
CREATE INDEX "leases_tenantId_status_idx" ON "leases"("tenantId", "status");

-- CreateIndex
CREATE INDEX "leases_propertyId_idx" ON "leases"("propertyId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tillSessionId_fkey" FOREIGN KEY ("tillSessionId") REFERENCES "till_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_integrations" ADD CONSTRAINT "pos_integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_involvements" ADD CONSTRAINT "membership_involvements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_involvements" ADD CONSTRAINT "membership_involvements_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_renterPartyId_fkey" FOREIGN KEY ("renterPartyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
