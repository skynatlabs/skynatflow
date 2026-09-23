-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('DELIVERED', 'REFUSED', 'NOT_HOME', 'WRONG_ADDRESS', 'CANCELLED');

-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codAmountCents" INTEGER,
ADD COLUMN     "codCollectedCents" INTEGER,
ADD COLUMN     "codSettlementId" TEXT,
ADD COLUMN     "riderMembershipId" TEXT;

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "DeliveryOutcome" NOT NULL,
    "collectedCents" INTEGER,
    "riderMembershipId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "riderMembershipId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatCents" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "countedCents" INTEGER,
    "varianceCents" INTEGER,

    CONSTRAINT "cod_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_attempts_tenantId_attemptedAt_idx" ON "delivery_attempts"("tenantId", "attemptedAt");

-- CreateIndex
CREATE INDEX "delivery_attempts_deliveryNoteId_idx" ON "delivery_attempts"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "cod_settlements_tenantId_riderMembershipId_idx" ON "cod_settlements"("tenantId", "riderMembershipId");

-- CreateIndex
CREATE INDEX "cod_settlements_tenantId_closedAt_idx" ON "cod_settlements"("tenantId", "closedAt");

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_codSettlementId_fkey" FOREIGN KEY ("codSettlementId") REFERENCES "cod_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_settlements" ADD CONSTRAINT "cod_settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
