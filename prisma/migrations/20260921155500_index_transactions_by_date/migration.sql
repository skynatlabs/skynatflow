-- CreateIndex
CREATE INDEX "transactions_tenantId_createdAt_idx" ON "transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_tenantId_type_createdAt_idx" ON "transactions"("tenantId", "type", "createdAt");

