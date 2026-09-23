-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dishItemId" TEXT NOT NULL,
    "yieldQty" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantityThousandths" INTEGER NOT NULL,

    CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_carries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "carryThousandths" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_carries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_dishItemId_key" ON "recipes"("dishItemId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_idx" ON "recipes"("tenantId");

-- CreateIndex
CREATE INDEX "recipe_components_tenantId_idx" ON "recipe_components"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_components_recipeId_componentItemId_key" ON "recipe_components"("recipeId", "componentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_carries_tenantId_componentItemId_key" ON "recipe_carries"("tenantId", "componentItemId");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_dishItemId_fkey" FOREIGN KEY ("dishItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_carries" ADD CONSTRAINT "recipe_carries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
