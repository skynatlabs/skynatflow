-- CreateTable
CREATE TABLE "rate_events" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_events_bucket_at_idx" ON "rate_events"("bucket", "at");

-- CreateIndex
CREATE INDEX "rate_events_at_idx" ON "rate_events"("at");

