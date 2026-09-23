-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('ORDER', 'NO_ORDER', 'CLOSED', 'NOT_FOUND');

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "code" TEXT,
    "channel" TEXT,
    "tier" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "landmark" TEXT,
    "visitFrequencyDays" INTEGER,
    "routeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVisitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_routes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "membershipId" TEXT,
    "dayOfWeek" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlet_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departedAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "distanceMetres" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "VisitOutcome",
    "transactionId" TEXT,
    "photoUrl" TEXT,
    "note" TEXT,

    CONSTRAINT "outlet_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlets_partyId_key" ON "outlets"("partyId");

-- CreateIndex
CREATE INDEX "outlets_tenantId_isActive_idx" ON "outlets"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "outlets_tenantId_routeId_idx" ON "outlets"("tenantId", "routeId");

-- CreateIndex
CREATE INDEX "sales_routes_tenantId_idx" ON "sales_routes"("tenantId");

-- CreateIndex
CREATE INDEX "outlet_visits_tenantId_arrivedAt_idx" ON "outlet_visits"("tenantId", "arrivedAt");

-- CreateIndex
CREATE INDEX "outlet_visits_outletId_arrivedAt_idx" ON "outlet_visits"("outletId", "arrivedAt");

-- CreateIndex
CREATE INDEX "outlet_visits_tenantId_membershipId_arrivedAt_idx" ON "outlet_visits"("tenantId", "membershipId", "arrivedAt");

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "sales_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_visits" ADD CONSTRAINT "outlet_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_visits" ADD CONSTRAINT "outlet_visits_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
