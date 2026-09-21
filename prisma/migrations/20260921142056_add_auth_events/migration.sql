-- CreateTable
CREATE TABLE "auth_events" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_events_email_at_idx" ON "auth_events"("email", "at");

-- CreateIndex
CREATE INDEX "auth_events_userId_at_idx" ON "auth_events"("userId", "at");

-- CreateIndex
CREATE INDEX "auth_events_at_idx" ON "auth_events"("at");

