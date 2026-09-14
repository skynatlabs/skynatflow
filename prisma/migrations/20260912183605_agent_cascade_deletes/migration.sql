-- DropForeignKey
ALTER TABLE "agent_definitions" DROP CONSTRAINT "agent_definitions_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "agent_threads" DROP CONSTRAINT "agent_threads_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "tenant_facts" DROP CONSTRAINT "tenant_facts_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_facts" ADD CONSTRAINT "tenant_facts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

