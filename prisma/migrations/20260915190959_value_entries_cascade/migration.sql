-- DropForeignKey
ALTER TABLE "value_entries" DROP CONSTRAINT "value_entries_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "value_entries" ADD CONSTRAINT "value_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

