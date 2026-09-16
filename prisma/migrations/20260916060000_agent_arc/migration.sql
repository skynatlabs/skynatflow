-- CreateTable
CREATE TABLE "agent_undo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT,
    "tool" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "compensation" JSONB NOT NULL,
    "actedById" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "failedReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_undo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_spend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT,
    "agentId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_spend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "schedule" TEXT,
    "tools" TEXT[],
    "niches" TEXT[],
    "installs" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_undo_tenantId_createdAt_idx" ON "agent_undo"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_undo_tenantId_undoneAt_idx" ON "agent_undo"("tenantId", "undoneAt");

-- CreateIndex
CREATE INDEX "agent_spend_tenantId_at_idx" ON "agent_spend"("tenantId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_recipes_slug_key" ON "agent_recipes"("slug");

-- CreateIndex
CREATE INDEX "agent_recipes_tenantId_idx" ON "agent_recipes"("tenantId");

-- AddForeignKey
ALTER TABLE "agent_undo" ADD CONSTRAINT "agent_undo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_spend" ADD CONSTRAINT "agent_spend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_recipes" ADD CONSTRAINT "agent_recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

