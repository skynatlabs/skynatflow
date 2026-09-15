-- AlterEnum
ALTER TYPE "PartyRole" ADD VALUE 'SUBCONTRACTOR';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "lastServiceKm" INTEGER,
ADD COLUMN     "maxGrossKg" INTEGER,
ADD COLUMN     "serviceIntervalKm" INTEGER,
ADD COLUMN     "tareKg" INTEGER;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "arrivalShownAt" TIMESTAMP(3),
ADD COLUMN     "detentionFreeMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "detentionRateCents" INTEGER,
ADD COLUMN     "firstAuditAt" TIMESTAMP(3),
ADD COLUMN     "turnaroundMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxRateToBase" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "loadKg" INTEGER;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "plannedKm" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "assetId" TEXT,
    "driverId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "otherParty" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_tenantId_at_idx" ON "incidents"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

