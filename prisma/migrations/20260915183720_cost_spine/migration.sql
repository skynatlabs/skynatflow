-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('DESKTOP', 'CAMERA', 'UPLOAD', 'EMAIL', 'BANK_FEED', 'CARD_STATEMENT', 'STAFF_APP', 'IMPORT', 'AGENT');

-- CreateEnum
CREATE TYPE "CapacityUnit" AS ENUM ('KM', 'HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'UNDERWAY', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripPurpose" AS ENUM ('DELIVERY', 'COLLECTION', 'SITE_VISIT', 'APPOINTMENT', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "DistanceSource" AS ENUM ('ODOMETER', 'GPS', 'TYPED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "ValueKind" AS ENUM ('IDENTIFIED', 'ACCEPTED', 'REALISED', 'COST');

-- AlterEnum
ALTER TYPE "ExpenseStatus" ADD VALUE 'DUPLICATE';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "capacityUnit" "CapacityUnit",
ADD COLUMN     "registration" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "incurredById" TEXT,
ADD COLUMN     "jobCardId" TEXT,
ADD COLUMN     "odometerKm" INTEGER,
ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "receiptReadAt" TIMESTAMP(3),
ADD COLUMN     "receiptReading" JSONB,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "source" "ExpenseSource" NOT NULL DEFAULT 'DESKTOP',
ADD COLUMN     "spentOn" TIMESTAMP(3),
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "supplierName" TEXT,
ADD COLUMN     "taxCents" INTEGER,
ADD COLUMN     "transactionId" TEXT,
ADD COLUMN     "tripId" TEXT,
ADD COLUMN     "unit" TEXT;

-- spentOn: the day the money left. For every expense that predates the
-- column that is the day it was recorded, not the day this migration ran.
UPDATE "expenses" SET "spentOn" = "createdAt" WHERE "spentOn" IS NULL;
ALTER TABLE "expenses" ALTER COLUMN "spentOn" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "spentOn" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "fuel_logs" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "expenseId" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "costRateCents" INTEGER,
ADD COLUMN     "locationConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "obligations" ADD COLUMN     "amountCents" INTEGER,
ADD COLUMN     "assetId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ZAR',
ADD COLUMN     "monthlyFeeCents" INTEGER;

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "itemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "purpose" "TripPurpose" NOT NULL DEFAULT 'OTHER',
    "assetId" TEXT,
    "driverId" TEXT,
    "originText" TEXT,
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "destinationText" TEXT,
    "destinationLat" DOUBLE PRECISION,
    "destinationLng" DOUBLE PRECISION,
    "laneKey" TEXT,
    "plannedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "odometerStartKm" INTEGER,
    "odometerEndKm" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "distanceSource" "DistanceSource",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branchId" TEXT,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "partyId" TEXT,
    "transactionId" TEXT,
    "jobCardId" TEXT,
    "label" TEXT,
    "addressText" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "plannedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "eventId" TEXT,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_points" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,

    CONSTRAINT "trip_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "value_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "officer" "Officer" NOT NULL,
    "kind" "ValueKind" NOT NULL,
    "cents" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observationId" TEXT,
    "method" TEXT,
    "note" TEXT,

    CONSTRAINT "value_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_lines_expenseId_idx" ON "expense_lines"("expenseId");

-- CreateIndex
CREATE INDEX "expense_lines_itemId_idx" ON "expense_lines"("itemId");

-- CreateIndex
CREATE INDEX "trips_tenantId_status_idx" ON "trips"("tenantId", "status");

-- CreateIndex
CREATE INDEX "trips_tenantId_assetId_startedAt_idx" ON "trips"("tenantId", "assetId", "startedAt");

-- CreateIndex
CREATE INDEX "trips_tenantId_driverId_startedAt_idx" ON "trips"("tenantId", "driverId", "startedAt");

-- CreateIndex
CREATE INDEX "trips_tenantId_laneKey_idx" ON "trips"("tenantId", "laneKey");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_eventId_key" ON "trip_stops"("eventId");

-- CreateIndex
CREATE INDEX "trip_stops_tripId_sequence_idx" ON "trip_stops"("tripId", "sequence");

-- CreateIndex
CREATE INDEX "trip_stops_tenantId_transactionId_idx" ON "trip_stops"("tenantId", "transactionId");

-- CreateIndex
CREATE INDEX "trip_stops_tenantId_partyId_idx" ON "trip_stops"("tenantId", "partyId");

-- CreateIndex
CREATE INDEX "trip_points_tripId_at_idx" ON "trip_points"("tripId", "at");

-- CreateIndex
CREATE INDEX "value_entries_tenantId_at_idx" ON "value_entries"("tenantId", "at");

-- CreateIndex
CREATE INDEX "value_entries_tenantId_observationId_kind_idx" ON "value_entries"("tenantId", "observationId", "kind");

-- CreateIndex
CREATE INDEX "expenses_tenantId_spentOn_idx" ON "expenses"("tenantId", "spentOn");

-- CreateIndex
CREATE INDEX "expenses_tenantId_fingerprint_idx" ON "expenses"("tenantId", "fingerprint");

-- CreateIndex
CREATE INDEX "expenses_tenantId_assetId_idx" ON "expenses"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_supplierId_idx" ON "expenses"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_transactionId_idx" ON "expenses"("tenantId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_logs_expenseId_key" ON "fuel_logs"("expenseId");

-- CreateIndex
CREATE INDEX "fuel_logs_tenantId_assetId_idx" ON "fuel_logs"("tenantId", "assetId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_points" ADD CONSTRAINT "trip_points_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_entries" ADD CONSTRAINT "value_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

