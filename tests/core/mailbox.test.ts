// The mailbox.
//
// Threading is the part that decides whether this reads as a mailbox or as a
// pile: two customers both write "Invoice", a reply arrives as "Re: Invoice",
// and a conversation has to survive both. Sending is checked for the thing
// that matters when it goes wrong — a message that did not send says so
// rather than disappearing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  archiveThread,
  bareAddress,
  listThreads,
  markThreadRead,
  normaliseSubject,
  readThread,
  replyToMessage,
  sendMail,
  threadKeyFor,
} from "../../src/lib/core/mailbox";

let tenantId: string;
let accountId: string;
let partyId: string;

async function arrive(from: string, subject: string, body: string, at = new Date()) {
  return prisma.inboundEmail.create({
    data: {
      tenantId,
      emailAccountId: accountId,
      fromAddress: from,
      subject,
      bodyText: body,
      receivedAt: at,
      threadKey: threadKeyFor(from, subject),
    },
  });
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Mail Co", niche: "SERVICES" } });
  tenantId = t.id;
  const account = await prisma.emailAccount.create({
    data: { tenantId, provider: "IMAP", emailAddress: "accounts@mailco.test", imapHost: "imap.test", imapUser: "u", imapPasswordEnc: "x" },
  });
  accountId = account.id;
  const party = await prisma.party.create({ data: { tenantId, name: "Jabu Traders", role: "CUSTOMER", email: "jabu@example.com" } });
  partyId = party.id;
});

afterEach(async () => {
  await prisma.outboundEmail.deleteMany({ where: { tenantId } });
  await prisma.inboundEmail.deleteMany({ where: { tenantId } });
  await prisma.emailAccount.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("threading", () => {
  it("strips the reply prefixes and keeps the address", () => {
    expect(normaliseSubject("Re: Fwd: RE: Invoice 12")).toBe("invoice 12");
    expect(bareAddress("Jabu Traders <Jabu@Example.com>")).toBe("jabu@example.com");
    expect(threadKeyFor("JABU@example.com", "Re: Invoice 12")).toBe(threadKeyFor("jabu@example.com", "Invoice 12"));
  });

  it("keeps two customers writing the same subject in two conversations", async () => {
    await arrive("jabu@example.com", "Invoice", "Where is it?", new Date(Date.now() - 3600_000));
    await arrive("thabo@other.test", "Invoice", "Mine too", new Date(Date.now() - 1800_000));

    const threads = await listThreads(tenantId);
    expect(threads).toHaveLength(2);
    expect(new Set(threads.map((t) => t.counterpart))).toEqual(new Set(["jabu@example.com", "thabo@other.test"]));
    // The one on file is named rather than shown as an address.
    expect(threads.find((t) => t.counterpart === "jabu@example.com")?.partyName).toBeNull();
  });

  it("reads a conversation in order, both directions, and marks it read", async () => {
    const first = await arrive("jabu@example.com", "Invoice 12", "Can you resend it?", new Date(Date.now() - 7200_000));
    const key = first.threadKey!;

    const reply = await replyToMessage({ tenantId, inboundEmailId: first.id, body: "Attached again." });
    // Nothing is configured to send in a test, and that is reported honestly.
    expect(reply.ok).toBe(false);
    expect(reply.via).toBe("none");

    await arrive("jabu@example.com", "Re: Invoice 12", "Got it, thanks", new Date());

    const { thread, messages } = await readThread(tenantId, key);
    expect(thread?.messages).toBe(3);
    expect(messages.map((m) => m.direction)).toEqual(["in", "out", "in"]);
    // The reply quotes what was written, so the thread reads on its own.
    expect(messages[1].body).toContain("> Can you resend it?");
    expect(messages[1].failed).toBeTruthy();

    expect((await listThreads(tenantId))[0].unread).toBe(2);
    await markThreadRead(tenantId, key);
    expect((await listThreads(tenantId))[0].unread).toBe(0);
  });

  it("puts an archived conversation out of the inbox, and brings it back", async () => {
    const email = await arrive("jabu@example.com", "Statement", "Please send one");
    await archiveThread(tenantId, email.threadKey!);
    expect(await listThreads(tenantId)).toHaveLength(0);
    expect(await listThreads(tenantId, { archived: true })).toHaveLength(1);

    await archiveThread(tenantId, email.threadKey!, false);
    expect(await listThreads(tenantId)).toHaveLength(1);
  });
});

describe("sending", () => {
  it("records a message against the customer it went to, and says how it went", async () => {
    const result = await sendMail({ tenantId, to: "Jabu <JABU@example.com>", subject: "Your statement", body: "Attached." });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured|did not send/i);

    const sent = await prisma.outboundEmail.findFirstOrThrow({ where: { tenantId } });
    expect(sent.toAddress).toBe("jabu@example.com");
    expect(sent.status).toBe("FAILED");
    // Matched to the customer on file by address, so it shows on their record.
    expect(sent.partyId).toBe(partyId);
  });

  it("refuses something that is not an address, and an empty message", async () => {
    await expect(sendMail({ tenantId, to: "not-an-address", subject: "x", body: "y" })).rejects.toThrow(/not an email address/i);
    await expect(sendMail({ tenantId, to: "jabu@example.com", subject: "x", body: "   " })).rejects.toThrow(/nothing in the message/i);
  });

  it("will not reply to another workspace's message", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "RETAIL" } });
    const email = await arrive("jabu@example.com", "Invoice", "hello");
    await expect(replyToMessage({ tenantId: other.id, inboundEmailId: email.id, body: "hi" })).rejects.toThrow(/not in this workspace/i);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
