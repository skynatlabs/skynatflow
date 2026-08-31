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
import { sendEmail } from "@/lib/email/client";

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

  // A quote/payment reply might match an open quote or invoice by the
  // sender's email — if so, and the AI found a real timing cue, push
  // that document's next follow-up out to that date instead of leaving
  // it on the default cadence (the same follow-up cron then just picks
  // it up naturally on schedule, no separate reminder system needed).
  let linkedTransactionId: string | null = null;
  if (classification.category === "QUOTE_REPLY" || classification.category === "PAYMENT_REPLY") {
    const matchType = classification.category === "PAYMENT_REPLY" ? "INVOICE" : "QUOTE";
    const openMatch = await prisma.transaction.findFirst({
      where: {
        tenantId: params.tenantId,
        type: matchType,
        status: matchType === "INVOICE" ? { in: ["SENT", "PARTIALLY_PAID"] } : "SENT",
        party: { email: params.fromAddress },
      },
      orderBy: { createdAt: "desc" },
      include: { party: true },
    });

    if (openMatch) {
      linkedTransactionId = openMatch.id;

      if (classification.scheduleFollowUpInDays != null) {
        const nextFollowUpAt = new Date(Date.now() + classification.scheduleFollowUpInDays * 86400000);
        await prisma.transaction.update({ where: { id: openMatch.id }, data: { nextFollowUpAt } });
      } else if (classification.category === "PAYMENT_REPLY" && !classification.looksLikePaymentProof) {
        // A payment promise with no concrete date ("I'll pay soon") isn't
        // enough to schedule a real reminder against — ask for one. This
        // goes out immediately only if the tenant has opted into
        // auto-respond; otherwise it queues in the same AiDraft
        // approval pipeline as every other outbound follow-up.
        await queueAskForPaymentDateReply(params.tenantId, openMatch);
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
      looksLikePaymentProof: classification.looksLikePaymentProof,
      aiSummary: classification.summary,
      linkedTransactionId,
    },
  });

  // Proof of payment needs a human to actually verify the amount/
  // authenticity before it's marked paid — never auto-marked — but it
  // should never sit unnoticed in the inbox either, so this is a
  // dedicated, higher-signal alert rather than folding into the generic
  // "important email" notification below.
  if (classification.looksLikePaymentProof) {
    const ownerPhone = await resolveOwnerPhone(params.tenantId);
    await createNotification({
      tenantId: params.tenantId,
      type: "PAYMENT_PROOF_RECEIVED",
      title: `Possible proof of payment from ${params.fromAddress}`,
      body: linkedTransactionId
        ? `${classification.summary} — check it against the matching invoice and mark it paid if it checks out.`
        : `${classification.summary} — couldn't automatically match this to one of your invoices, check manually.`,
      linkHref: linkedTransactionId
        ? `/dashboard/${params.tenantId}/invoices/${linkedTransactionId}`
        : `/dashboard/${params.tenantId}/inbox`,
      whatsappTo: ownerPhone,
    });
  } else if (classification.isImportant) {
    const ownerPhone = await resolveOwnerPhone(params.tenantId);
    const typeLabel =
      classification.category === "STATEMENT" ? "Statement received" :
      classification.category === "INVOICE" ? "Invoice received" :
      classification.category === "LEGAL" ? "Legal notice received" :
      classification.category === "QUOTE_REPLY" ? "Customer replied about a quote" :
      classification.category === "PAYMENT_REPLY" ? "Customer replied about an invoice" :
      "Important email received";

    await createNotification({
      tenantId: params.tenantId,
      type: "IMPORTANT_EMAIL",
      title: typeLabel,
      body: classification.summary,
      linkHref: `/dashboard/${params.tenantId}/inbox`,
      whatsappTo: ownerPhone,
    });
  }

  return email;
}

// PA job: "kindly give a date" — a payment promise with no firm date
// can't be scheduled against, so ask for one instead of letting it drop.
// Reuses the exact same AiDraft-then-approve pipeline the follow-up
// cron already uses (src/app/api/cron/follow-ups/route.ts), so this
// shows up in the same /ai-drafts approval queue rather than being a
// second, separate outbound-message system to maintain.
async function queueAskForPaymentDateReply(
  tenantId: string,
  invoice: { id: string; partyId: string; party: { name: string; email: string | null } }
) {
  if (!invoice.party.email) return; // nothing to reply to

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const body = `Hi ${invoice.party.name}, thanks for letting us know! Could you give us a specific date we can expect payment by? That way we can make sure everything's in order on our end.`;

  const existingPending = await prisma.aiDraft.findFirst({ where: { transactionId: invoice.id, status: "PENDING" } });
  if (existingPending) return; // don't stack a second ask on top of one already waiting

  const touchNumber = (await prisma.aiDraft.count({ where: { transactionId: invoice.id } })) + 1;

  if (tenant.autoRespondEnabled) {
    await sendEmail({ to: invoice.party.email, subject: "Re: your outstanding invoice", html: `<p>${body}</p>` });
    await prisma.aiDraft.create({
      data: { tenantId, partyId: invoice.partyId, transactionId: invoice.id, touchNumber, body, reasoning: "Customer promised payment without a specific date — asked for one.", status: "SENT", resolvedAt: new Date() },
    });
  } else {
    await prisma.aiDraft.create({
      data: { tenantId, partyId: invoice.partyId, transactionId: invoice.id, touchNumber, body, reasoning: "Customer promised payment without a specific date — asked for one.", status: "PENDING" },
    });
  }
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

export interface PaEmailContext {
  fromLabel: string; // resolved to the customer's name on file when their email matches a Party, else the raw address
  subject: string;
  category: string;
  isImportant: boolean;
  summary: string;
  receivedAt: Date;
}

// PA job: "any important mail?" / "what did [customer] email about?" —
// the classify-and-store pipeline already existed (ingestEmail above);
// this is the missing link that lets the PA actually answer questions
// about it instead of that data sitting unused in the Inbox page. Capped
// and summary-only (never the full body) to keep this cheap to include
// in every voice-assistant/PA-command call.
export async function getRecentEmailsForPa(tenantId: string, limit = 15): Promise<PaEmailContext[]> {
  const emails = await prisma.inboundEmail.findMany({
    where: { tenantId },
    orderBy: [{ isImportant: "desc" }, { receivedAt: "desc" }],
    take: limit,
  });
  if (!emails.length) return [];

  const addresses = [...new Set(emails.map((e) => e.fromAddress))];
  const parties = await prisma.party.findMany({
    where: { tenantId, email: { in: addresses } },
    select: { email: true, name: true },
  });
  const nameByEmail = new Map(parties.map((p) => [p.email, p.name]));

  return emails.map((e) => ({
    fromLabel: nameByEmail.get(e.fromAddress) ?? e.fromAddress,
    subject: e.subject,
    category: e.category,
    isImportant: e.isImportant,
    summary: e.aiSummary ?? e.subject,
    receivedAt: e.receivedAt,
  }));
}

export async function markEmailRead(tenantId: string, emailId: string) {
  const email = await prisma.inboundEmail.findUniqueOrThrow({ where: { id: emailId } });
  if (email.tenantId !== tenantId) throw new Error("Not found.");
  return prisma.inboundEmail.update({ where: { id: emailId }, data: { isRead: true } });
}
