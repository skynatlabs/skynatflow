-- CreateEnum
CREATE TYPE "ObligationTemplateSource" AS ENUM ('CURATED', 'DOCUMENT', 'RESEARCH', 'USER');

-- AlterTable
ALTER TABLE "obligations" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "regionCode" TEXT;

-- CreateTable
CREATE TABLE "obligation_templates" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "kind" "ObligationKind" NOT NULL,
    "recurrence" "ObligationRecurrence" NOT NULL DEFAULT 'ANNUAL',
    "severity" "ObligationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "leadDays" INTEGER NOT NULL DEFAULT 30,
    "consequence" TEXT,
    "noticeDays" INTEGER,
    "blocksWork" BOOLEAN NOT NULL DEFAULT false,
    "source" "ObligationTemplateSource" NOT NULL DEFAULT 'RESEARCH',
    "dueMonth" INTEGER,
    "dueDay" INTEGER,
    "fromRegistrationAnniversary" BOOLEAN NOT NULL DEFAULT false,
    "requiresCompany" BOOLEAN,
    "requiresVat" BOOLEAN,
    "requiresEmployees" BOOLEAN,
    "requiresVehicles" BOOLEAN,
    "adoptedCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "dismissedCount" INTEGER NOT NULL DEFAULT 0,
    "contributedByTenantId" TEXT,
    "sourceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_coverage" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "templateCount" INTEGER NOT NULL DEFAULT 0,
    "researchedAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obligation_templates_countryCode_regionCode_idx" ON "obligation_templates"("countryCode", "regionCode");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_templates_countryCode_regionCode_title_key" ON "obligation_templates"("countryCode", "regionCode", "title");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_coverage_countryCode_regionCode_key" ON "jurisdiction_coverage"("countryCode", "regionCode");
