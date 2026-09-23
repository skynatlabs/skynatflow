-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PLANNED', 'FILLED', 'ABSENT', 'DONE');

-- CreateEnum
CREATE TYPE "CasualPayKind" AS ENUM ('DAILY', 'PIECE', 'HOURLY');

-- CreateEnum
CREATE TYPE "WorkLogStatus" AS ENUM ('LOGGED', 'APPROVED', 'PAID');

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "distanceMetres" INTEGER,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "shiftId" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workSiteId" TEXT;

-- CreateTable
CREATE TABLE "work_sites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusMetres" INTEGER NOT NULL DEFAULT 150,
    "landmark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workSiteId" TEXT,
    "membershipId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "ratePerHourCents" INTEGER,
    "status" "ShiftStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_workers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "idNumber" TEXT,
    "payKind" "CasualPayKind" NOT NULL DEFAULT 'DAILY',
    "rateCents" INTEGER NOT NULL DEFAULT 0,
    "payoutNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldWorkerId" TEXT NOT NULL,
    "workSiteId" TEXT,
    "workedOn" TIMESTAMP(3) NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "rateCentsAtTime" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "WorkLogStatus" NOT NULL DEFAULT 'LOGGED',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_sites_tenantId_isActive_idx" ON "work_sites"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "shifts_tenantId_startsAt_idx" ON "shifts"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "shifts_tenantId_membershipId_startsAt_idx" ON "shifts"("tenantId", "membershipId", "startsAt");

-- CreateIndex
CREATE INDEX "field_workers_tenantId_isActive_idx" ON "field_workers"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "work_logs_tenantId_workedOn_idx" ON "work_logs"("tenantId", "workedOn");

-- CreateIndex
CREATE INDEX "work_logs_tenantId_status_idx" ON "work_logs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "work_logs_fieldWorkerId_workedOn_idx" ON "work_logs"("fieldWorkerId", "workedOn");

-- CreateIndex
CREATE INDEX "time_entries_tenantId_clockInAt_idx" ON "time_entries"("tenantId", "clockInAt");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "work_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sites" ADD CONSTRAINT "work_sites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sites" ADD CONSTRAINT "work_sites_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "work_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_workers" ADD CONSTRAINT "field_workers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_fieldWorkerId_fkey" FOREIGN KEY ("fieldWorkerId") REFERENCES "field_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
