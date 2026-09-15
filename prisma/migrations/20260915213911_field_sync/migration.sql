-- CreateTable
CREATE TABLE "field_syncs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT,

    CONSTRAINT "field_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_syncs_tenantId_appliedAt_idx" ON "field_syncs"("tenantId", "appliedAt");

-- AddForeignKey
ALTER TABLE "field_syncs" ADD CONSTRAINT "field_syncs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

