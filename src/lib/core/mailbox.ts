// The mailbox, inside the workspace.
//
// Mail already arrives here — it is read, classified and linked to quotes.
// What was missing is the other half: reading a conversation as a
// conversation and replying to it without leaving for Gmail, from the
// business's own address rather than ours.
//
// Two decisions worth stating. Replies go out over the business's own SMTP
// where one is configured, because a customer who wrote to
// accounts@theirshop.co.za should get the answer from that address, not from
// a platform domain that lands in spam. And threading is done on the mail
// headers first and the subject only as a fallback: two customers both write
// "Invoice", and grouping on subject alone puts their conversations in one
// pile.

import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { weAnswered } from "./conversations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sendEmail as sendPlatformEmail } from "@/lib/email/client";

export interface MailMessage {
  id: string;
  direction: "in" | "out";
  address: string;
  subject: string;
  body: string;
  at: Date;
  isRead: boolean;
  category?: string;
  authorName?: string | null;
  failed?: string | null;
}

export interface MailThread {
  key: string;
  subject: string;
  /** The person on the other end. */
  counterpart: string;
  partyId: string | null;
  partyName: string | null;
  lastAt: Date;
  unread: number;
  messages: number;
  preview: string;
}

/** The address, lowercased, with any display name stripped. */
export function bareAddress(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const angled = /<([^>]+)>/.exec(raw);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

/** Re:/Fwd: and the like, stripped, so a reply stays in its own conversation. */
export function normaliseSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .replace(/^(\s*(re|fw|fwd|aw|antw|vs|sv)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * The key that groups a conversation: the other party's address plus the
 * subject it started with. Header threading refines it where the headers are
 * there, and most mail from small businesses has none worth trusting.
 */
export function threadKeyFor(counterpart: string, subject: string | null | undefined): string {
  return `${bareAddress(counterpart)}|${normaliseSubject(subject) || "(no subject)"}`;
}

/** Every conversation in the mailbox, most recent first. */
export async function listThreads(tenantId: string, opts: { archived?: boolean; take?: number } = {}): Promise<MailThread[]> {
  const [inbound, outbound] = await Promise.all([
    prisma.inboundEmail.findMany({
      where: { tenantId, isArchived: opts.archived ?? false },
      orderBy: { receivedAt: "desc" },
      take: 500,
      include: { party: { select: { id: true, name: true } } },
    }),
    prisma.outboundEmail.findMany({ where: { tenantId }, orderBy: { sentAt: "desc" }, take: 500, include: { party: { select: { id: true, name: true } } } }),
  ]);

  const threads = new Map<string, MailThread>();
  const touch = (key: string, subject: string, counterpart: string, at: Date, party: { id: string; name: string } | null, preview: string, unread: boolean) => {
    const current = threads.get(key);
    if (!current) {
      threads.set(key, {
        key,
        subject: subject || "(no subject)",
        counterpart,
        partyId: party?.id ?? null,
        partyName: party?.name ?? null,
        lastAt: at,
        unread: unread ? 1 : 0,
        messages: 1,
        preview,
      });
      return;
    }
    current.messages += 1;
    if (unread) current.unread += 1;
    current.partyId ??= party?.id ?? null;
    current.partyName ??= party?.name ?? null;
    if (at > current.lastAt) {
      current.lastAt = at;
      current.preview = preview;
    }
  };

  for (const email of inbound) {
    const key = email.threadKey ?? threadKeyFor(email.fromAddress, email.subject);
    touch(key, email.subject, bareAddress(email.fromAddress), email.receivedAt, email.party, email.bodyText.slice(0, 160), !email.isRead);
  }
  for (const email of outbound) {
    const key = email.threadKey ?? threadKeyFor(email.toAddress, email.subject);
    touch(key, email.subject, bareAddress(email.toAddress), email.sentAt, email.party, email.bodyText.slice(0, 160), false);
  }

  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, opts.take ?? 100);
}

/** One conversation, in order, both directions. */
export async function readThread(tenantId: string, key: string): Promise<{ thread: MailThread | null; messages: MailMessage[] }> {
  const [inbound, outbound] = await Promise.all([
    prisma.inboundEmail.findMany({ where: { tenantId, threadKey: key }, include: { party: { select: { id: true, name: true } } } }),
    prisma.outboundEmail.findMany({ where: { tenantId, threadKey: key }, include: { party: { select: { id: true, name: true } } } }),
  ]);
  if (inbound.length === 0 && outbound.length === 0) return { thread: null, messages: [] };

  const senderIds = [...new Set(outbound.map((o) => o.sentById).filter((id): id is string => Boolean(id)))];
  const senders = senderIds.length
    ? await prisma.membership.findMany({ where: { id: { in: senderIds } }, include: { user: true } })
    : [];
  const senderName = new Map(senders.map((m) => [m.id, m.user.name ?? m.user.email]));

  const messages: MailMessage[] = [
    ...inbound.map((e) => ({
      id: e.id,
      direction: "in" as const,
      address: bareAddress(e.fromAddress),
      subject: e.subject,
      body: e.bodyText,
      at: e.receivedAt,
      isRead: e.isRead,
      category: e.category,
    })),
    ...outbound.map((e) => ({
      id: e.id,
      direction: "out" as const,
      address: bareAddress(e.toAddress),
      subject: e.subject,
      body: e.bodyText,
      at: e.sentAt,
      isRead: true,
      authorName: e.sentById ? senderName.get(e.sentById) ?? null : null,
      failed: e.status === "SENT" ? null : e.error ?? "It did not send.",
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const first = inbound[0] ?? outbound[0];
  const party = (inbound.find((e) => e.party)?.party ?? outbound.find((e) => e.party)?.party) ?? null;
  const counterpart = messages.find((m) => m.direction === "in")?.address ?? messages[0]?.address ?? "";

  return {
    thread: {
      key,
      subject: first?.subject ?? "(no subject)",
      counterpart,
      partyId: party?.id ?? null,
      partyName: party?.name ?? null,
      lastAt: messages.at(-1)?.at ?? new Date(),
      unread: inbound.filter((e) => !e.isRead).length,
      messages: messages.length,
      preview: messages.at(-1)?.body.slice(0, 160) ?? "",
    },
    messages,
  };
}

export async function markThreadRead(tenantId: string, key: string) {
  await prisma.inboundEmail.updateMany({ where: { tenantId, threadKey: key, isRead: false }, data: { isRead: true } });
}

export async function archiveThread(tenantId: string, key: string, archived = true) {
  await prisma.inboundEmail.updateMany({ where: { tenantId, threadKey: key }, data: { isArchived: archived } });
}

export interface SendMailParams {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  /** The conversation it belongs to; a new one is started when absent. */
  threadKey?: string | null;
  inReplyTo?: string | null;
  accountId?: string | null;
  sentById?: string | null;
  partyId?: string | null;
}

export interface SendMailResult {
  ok: boolean;
  id: string;
  via: "smtp" | "platform" | "none";
  message: string;
}

/** The account a reply should go out from: the one it arrived on, or the first that can send. */
export async function sendingAccount(tenantId: string, accountId?: string | null) {
  if (accountId) {
    const chosen = await prisma.emailAccount.findFirst({ where: { id: accountId, tenantId } });
    if (chosen) return chosen;
  }
  return prisma.emailAccount.findFirst({
    where: { tenantId, isActive: true, smtpHost: { not: null } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Send, and record what happened either way.
 *
 * Over the business's own SMTP when it is configured; otherwise over the
 * platform's sender, which is honest but lands in more spam folders, and the
 * result says which was used. A failure is written down as a failure rather
 * than thrown away — an email that silently did not send is the worst
 * outcome available here.
 */
export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  const to = bareAddress(params.to);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("That is not an email address.");
  const subject = params.subject.trim() || "(no subject)";
  const body = params.body.trim();
  if (!body) throw new Error("There is nothing in the message.");

  const account = await sendingAccount(params.tenantId, params.accountId);
  const threadKey = params.threadKey ?? threadKeyFor(to, subject);
  const messageId = `<${crypto.randomUUID()}@skynat.ai>`;

  // The customer this is going to, when they are on file — so the
  // conversation shows up on their record too.
  const partyId =
    params.partyId ??
    (await prisma.party.findFirst({ where: { tenantId: params.tenantId, email: { equals: to, mode: "insensitive" } }, select: { id: true } }))?.id ??
    null;

  let via: SendMailResult["via"] = "none";
  let error: string | null = null;

  if (account?.smtpHost && account.smtpUser && account.smtpPasswordEnc) {
    try {
      const transport = nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort ?? (account.smtpSecure ? 465 : 587),
        secure: account.smtpSecure,
        auth: { user: account.smtpUser, pass: decryptSecret(account.smtpPasswordEnc) },
      });
      await transport.sendMail({
        from: account.fromName ? `"${account.fromName}" <${account.emailAddress}>` : account.emailAddress,
        to,
        subject,
        text: body,
        messageId,
        ...(params.inReplyTo ? { inReplyTo: params.inReplyTo, references: params.inReplyTo } : {}),
      });
      via = "smtp";
    } catch (err) {
      error = err instanceof Error ? err.message : "The mail server refused it.";
    }
  }

  if (via === "none") {
    // No mailbox of their own, or it refused: the platform sender still gets
    // the message there, and the record says how it went.
    const result = await sendPlatformEmail({
      to,
      subject,
      html: `<pre style="font: 14px/1.5 -apple-system, sans-serif; white-space: pre-wrap;">${body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</pre>`,
    });
    if (!(result as { stub?: boolean }).stub) {
      via = "platform";
      error = null;
    } else if (!error) {
      error = "No mailbox is connected and the platform sender is not configured.";
    }
  }

  const record = await prisma.outboundEmail.create({
    data: {
      tenantId: params.tenantId,
      emailAccountId: account?.id ?? null,
      toAddress: to,
      subject,
      bodyText: body,
      threadKey,
      inReplyTo: params.inReplyTo ?? null,
      messageId,
      partyId,
      sentById: params.sentById ?? null,
      status: via === "none" ? "FAILED" : "SENT",
      error,
    },
  });

  // The clock on this conversation stops when somebody actually answers, and
  // a message that did not send is not an answer — so only a real one does.
  if (via !== "none") {
    await weAnswered({ tenantId: params.tenantId, threadKey }).catch(() => {});
  }

  return {
    ok: via !== "none",
    id: record.id,
    via,
    message:
      via === "smtp"
        ? `Sent from ${account?.emailAddress}.`
        : via === "platform"
          ? "Sent — though from the platform's address, because no mailbox of yours is connected for sending."
          : error ?? "It did not send.",
  };
}

/** Reply to a message in a thread, quoting what was written. */
export async function replyToMessage(params: {
  tenantId: string;
  inboundEmailId: string;
  body: string;
  sentById?: string | null;
  quote?: boolean;
}): Promise<SendMailResult> {
  const email = await prisma.inboundEmail.findFirst({
    where: { id: params.inboundEmailId, tenantId: params.tenantId },
    select: { fromAddress: true, subject: true, bodyText: true, threadKey: true, messageId: true, emailAccountId: true, partyId: true, receivedAt: true },
  });
  if (!email) throw new Error("That message is not in this workspace.");

  const quoted =
    params.quote === false
      ? params.body
      : `${params.body}\n\n---\nOn ${email.receivedAt.toLocaleString()}, ${bareAddress(email.fromAddress)} wrote:\n` +
        email.bodyText
          .split("\n")
          .slice(0, 40)
          .map((l) => `> ${l}`)
          .join("\n");

  return sendMail({
    tenantId: params.tenantId,
    to: email.fromAddress,
    subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
    body: quoted,
    threadKey: email.threadKey ?? threadKeyFor(email.fromAddress, email.subject),
    inReplyTo: email.messageId,
    accountId: email.emailAccountId,
    partyId: email.partyId,
    sentById: params.sentById ?? null,
  });
}

/** Store SMTP details for an account, encrypted like every other credential. */
export async function setSmtp(
  tenantId: string,
  accountId: string,
  params: { host: string; port: number; user: string; password?: string; secure: boolean; fromName?: string | null }
) {
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
  if (!account) throw new Error("That mailbox is not in this workspace.");
  return prisma.emailAccount.update({
    where: { id: accountId },
    data: {
      smtpHost: params.host.trim() || null,
      smtpPort: params.port || null,
      smtpUser: params.user.trim() || null,
      smtpSecure: params.secure,
      fromName: params.fromName?.trim() || null,
      ...(params.password ? { smtpPasswordEnc: encryptSecret(params.password) } : {}),
    },
  });
}
