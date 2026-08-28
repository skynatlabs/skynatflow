// Built-in mail client — BlueMail-style: a tenant connects one of three
// account types (Google OAuth is coming-soon/stubbed, IMAP is real today,
// flow-hosted forwarding address is real today with zero credentials to
// store). Every ingested email runs through the same classify-and-alert
// pipeline regardless of which connection type it came from.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { classifyInboundEmail } from "@/lib/ai/emailClassifier";
import { createNotification, resolveOwnerPhone } from "@/lib/core/notifications2";

export async function connectImapAccount(params: {
  tenantId: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
}) {
  return prisma.emailAccount.create({
    data: {
      tenantId: params.tenantId,
      provider: "IMAP",
      emailAddress: params.emailAddress,
      imapHost: params.imapHost,
      imapPort: params.imapPort,
      imapUser: params.imapUser,
      imapPasswordEnc: encryptSecret(params.imapPassword),
    },
  });
}

export async function connectFlowHostedAccount(tenantId: string, emailAddress: string) {
  const slug = tenantId.slice(-8).toLowerCase();
  return prisma.emailAccount.create({
    data: {
      tenantId,
      provider: "FLOW_HOSTED",
      emailAddress,
      flowInboundAddress: `${slug}@mail.flow.skynat.co`,
    },
  });
}

export async function listEmailAccounts(tenantId: string) {
  return prisma.emailAccount.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

export async function disconnectEmailAccount(tenantId: string, accountId: string) {
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.tenantId !== tenantId) throw new Error("Not found.");
  return prisma.emailAccount.update({ where: { id: accountId }, data: { isActive: false } });
}

// The shared ingest pipeline — runs after IMAP fetch OR the flow-hosted
// webhook, whichever brought the email in. Classifies it, records it,
// notifies the dashboard, WhatsApp-alerts the owner if important, and
// reschedules the follow-up cron if the sender gave a real timing cue.
export async function ingestEmail(params: {
  tenantId: string;
  emailAccountId: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
}) {
  const classification = await classifyInboundEmail({
    fromAddress: params.fromAddress,
    subject: params.subject,
    bodyText: params.bodyText,
  });

  // A quote reply might match an open quote by the sender's email — if
  // so, and the AI found a real timing cue, push that quote's next
  // follow-up out instead of leaving it on the default cadence.
  let linkedTransactionId: string | null = null;
  if (classification.category === "QUOTE_REPLY") {
    const openQuote = await prisma.transaction.findFirst({
      where: { tenantId: params.tenantId, type: "QUOTE", status: "SENT", party: { email: params.fromAddress } },
      orderBy: { createdAt: "desc" },
    });
    if (openQuote) {
      linkedTransactionId = openQuote.id;
      if (classification.scheduleFollowUpInDays != null) {
        const nextFollowUpAt = new Date(Date.now() + classification.scheduleFollowUpInDays * 86400000);
        await prisma.transaction.update({ where: { id: openQuote.id }, data: { nextFollowUpAt } });
      }
    }
  }

  const email = await prisma.inboundEmail.create({
    data: {
      tenantId: params.tenantId,
      emailAccountId: params.emailAccountId,
      fromAddress: params.fromAddress,
      subject: params.subject,
      bodyText: params.bodyText,
      receivedAt: params.receivedAt,
      category: classification.category,
      isImportant: classification.isImportant,
      aiSummary: classification.summary,
      linkedTransactionId,
    },
  });

  if (classification.isImportant) {
    const ownerPhone = await resolveOwnerPhone(params.tenantId);
    const typeLabel =
      classification.category === "STATEMENT" ? "Statement received" :
      classification.category === "INVOICE" ? "Invoice received" :
      classification.category === "LEGAL" ? "Legal notice received" :
      classification.category === "QUOTE_REPLY" ? "Customer replied about a quote" :
      "Important email received";

    await createNotification({
      tenantId: params.tenantId,
      type: classification.category === "QUOTE_REPLY" ? "IMPORTANT_EMAIL" : "IMPORTANT_EMAIL",
      title: typeLabel,
      body: classification.summary,
      linkHref: `/dashboard/${params.tenantId}/inbox`,
      whatsappTo: ownerPhone,
    });
  }

  return email;
}

// Polls one IMAP account for messages since the last check — called by
// the fetch-emails cron for every active IMAP EmailAccount.
export async function fetchNewImapEmails(accountId: string) {
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.provider !== "IMAP" || !account.imapHost || !account.imapUser || !account.imapPasswordEnc) {
    return { fetched: 0 };
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort ?? 993,
    secure: true,
    auth: { user: account.imapUser, pass: decryptSecret(account.imapPasswordEnc) },
    logger: false,
  });

  let fetched = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = account.lastCheckedAt ?? new Date(Date.now() - 24 * 3600000);
      for await (const message of client.fetch({ since }, { source: true, envelope: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const fromAddress = parsed.from?.value[0]?.address ?? "unknown";
        await ingestEmail({
          tenantId: account.tenantId,
          emailAccountId: account.id,
          fromAddress,
          subject: parsed.subject ?? "(no subject)",
          bodyText: parsed.text ?? "",
          receivedAt: parsed.date ?? new Date(),
        });
        fetched++;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  await prisma.emailAccount.update({ where: { id: accountId }, data: { lastCheckedAt: new Date() } });
  return { fetched };
}

export async function listInboundEmails(tenantId: string, onlyImportant = false) {
  return prisma.inboundEmail.findMany({
    where: { tenantId, ...(onlyImportant ? { isImportant: true } : {}) },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
}

export async function markEmailRead(tenantId: string, emailId: string) {
  const email = await prisma.inboundEmail.findUniqueOrThrow({ where: { id: emailId } });
  if (email.tenantId !== tenantId) throw new Error("Not found.");
  return prisma.inboundEmail.update({ where: { id: emailId }, data: { isRead: true } });
}
