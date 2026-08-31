-- CreateEnum
CREATE TYPE "JobCardStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "job_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" "JobCardStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "notes" TEXT,
    "completionPhotoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_card_tasks" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_card_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_cards_tenantId_idx" ON "job_cards"("tenantId");

-- CreateIndex
CREATE INDEX "job_cards_tenantId_status_idx" ON "job_cards"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_card_tasks" ADD CONSTRAINT "job_card_tasks_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
