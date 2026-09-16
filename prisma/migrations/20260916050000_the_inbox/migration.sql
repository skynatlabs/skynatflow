-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "partyId" TEXT,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "snoozedUntil" TIMESTAMP(3),
    "waitingSince" TIMESTAMP(3),
    "firstReplyMins" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "recordingUrl" TEXT,
    "summary" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedWith" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "fields" JSONB NOT NULL,
    "autoReply" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "partyId" TEXT,
    "source" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_consents_tenantId_channel_state_idx" ON "contact_consents"("tenantId", "channel", "state");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consents_tenantId_partyId_channel_key" ON "contact_consents"("tenantId", "partyId", "channel");

-- CreateIndex
CREATE INDEX "conversations_tenantId_status_idx" ON "conversations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conversations_tenantId_assignedToId_idx" ON "conversations"("tenantId", "assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenantId_threadKey_key" ON "conversations"("tenantId", "threadKey");

-- CreateIndex
CREATE INDEX "conversation_notes_conversationId_idx" ON "conversation_notes"("conversationId");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_startedAt_idx" ON "call_logs"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_status_idx" ON "call_logs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "lead_forms_tenantId_idx" ON "lead_forms"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_forms_tenantId_slug_key" ON "lead_forms"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "lead_submissions_tenantId_handledAt_idx" ON "lead_submissions"("tenantId", "handledAt");

-- CreateIndex
CREATE INDEX "lead_submissions_formId_idx" ON "lead_submissions"("formId");

-- CreateIndex
CREATE INDEX "broadcasts_tenantId_createdAt_idx" ON "broadcasts"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submissions" ADD CONSTRAINT "lead_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submissions" ADD CONSTRAINT "lead_submissions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submissions" ADD CONSTRAINT "lead_submissions_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

