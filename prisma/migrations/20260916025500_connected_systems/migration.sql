-- CreateTable
CREATE TABLE "connected_systems" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "systemKey" TEXT NOT NULL,
    "label" TEXT,
    "category" TEXT NOT NULL,
    "isSystemOfRecord" BOOLEAN NOT NULL DEFAULT true,
    "lastImportAt" TIMESTAMP(3),
    "importedRecords" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_systems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connected_systems_tenantId_idx" ON "connected_systems"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "connected_systems_tenantId_systemKey_key" ON "connected_systems"("tenantId", "systemKey");

-- AddForeignKey
ALTER TABLE "connected_systems" ADD CONSTRAINT "connected_systems_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

