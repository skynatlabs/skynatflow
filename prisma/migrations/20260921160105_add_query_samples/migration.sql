-- CreateTable
CREATE TABLE "query_samples" (
    "id" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,
    "slow" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "query_samples_op_at_idx" ON "query_samples"("op", "at");

-- CreateIndex
CREATE INDEX "query_samples_at_idx" ON "query_samples"("at");

