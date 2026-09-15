-- CreateEnum
CREATE TYPE "Officer" AS ENUM ('CEO', 'CFO', 'COO', 'LEGAL', 'SALES', 'EFFICIENCY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('OPEN', 'RAISED', 'ACTIONED', 'DISMISSED', 'SUPERSEDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "officer" "Officer" NOT NULL,
    "headline" TEXT NOT NULL,
    "detail" TEXT,
    "moneyCents" INTEGER,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "urgentBy" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "evidence" JSONB,
    "proposedAction" TEXT,
    "handedTo" "Officer",
    "status" "ObservationStatus" NOT NULL DEFAULT 'OPEN',
    "raisedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officer_autonomy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "officer" "Officer" NOT NULL,
    "ceiling" TEXT NOT NULL DEFAULT 'SUGGEST',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "officer_autonomy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observations_tenantId_status_createdAt_idx" ON "observations"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "observations_tenantId_dedupeKey_idx" ON "observations"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "officer_autonomy_tenantId_officer_key" ON "officer_autonomy"("tenantId", "officer");

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_autonomy" ADD CONSTRAINT "officer_autonomy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
