-- AlterTable
ALTER TABLE "job_cards" ADD COLUMN     "budgetCents" INTEGER,
ADD COLUMN     "checklistId" TEXT,
ADD COLUMN     "dependsOnId" TEXT,
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "routeOrder" INTEGER,
ADD COLUMN     "siteAddress" TEXT,
ADD COLUMN     "siteLat" DOUBLE PRECISION,
ADD COLUMN     "siteLng" DOUBLE PRECISION,
ADD COLUMN     "subcontractCents" INTEGER,
ADD COLUMN     "subcontractorId" TEXT;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "jobCardId" TEXT;

-- CreateTable
CREATE TABLE "checklists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "forWork" TEXT,
    "enforced" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "needsPhoto" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobCardId" TEXT,
    "partyId" TEXT,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresOn" TIMESTAMP(3),
    "issuedBy" TEXT,
    "issuerRef" TEXT,
    "signatureDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "clientRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklists_tenantId_idx" ON "checklists"("tenantId");

-- CreateIndex
CREATE INDEX "checklist_items_checklistId_idx" ON "checklist_items"("checklistId");

-- CreateIndex
CREATE INDEX "certificates_tenantId_expiresOn_idx" ON "certificates"("tenantId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenantId_number_key" ON "certificates"("tenantId", "number");

-- CreateIndex
CREATE INDEX "offline_changes_tenantId_appliedAt_idx" ON "offline_changes"("tenantId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "offline_changes_tenantId_clientRef_key" ON "offline_changes"("tenantId", "clientRef");

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_changes" ADD CONSTRAINT "offline_changes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

