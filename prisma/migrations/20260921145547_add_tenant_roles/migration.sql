-- CreateTable
CREATE TABLE "tenant_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_roles_tenantId_idx" ON "tenant_roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_roles_tenantId_key_key" ON "tenant_roles"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

