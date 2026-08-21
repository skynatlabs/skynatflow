-- CreateTable
CREATE TABLE "proposal_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "introText" TEXT,
    "scopeOfWork" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_templates_tenantId_idx" ON "proposal_templates"("tenantId");

-- AddForeignKey
ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
