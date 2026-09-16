// The inbox: timeline, consent, conversations, calls, enquiries, broadcast.
//
// The property that decides whether any of this is safe is the consent check,
// so it gets the most attention: a business that sends marketing to somebody
// who never opted in loses the channel, and one that ignores a STOP loses
// more than that. Everything else here is about not losing people — a
// conversation nobody owns, a missed call nobody answers, an enquiry that
// sits for a day.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { customerTimeline } from "../../src/lib/core/timeline";
import { consentSummary, filterByConsent, mayContact, readsAsOptOut, setConsent, withdrawByReply } from "../../src/lib/core/consent";
import {
  addConversationNote,
  assign,
  closeConversation,
  customerWrote,
  listConversations,
  responseHealth,
  snooze,
  wakeSnoozed,
  weAnswered,
} from "../../src/lib/core/conversations";
import { callHealth, handleMissedCall, logCall, markCallResponded, unansweredMissedCalls } from "../../src/lib/core/calls";
import { createLeadForm, leadResponseHealth, markLeadHandled, publicForm, submitLeadForm } from "../../src/lib/core/leadForms";
import { draftBroadcast, previewAudience } from "../../src/lib/core/broadcast";

const DAY = 86_400_000;

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let membershipId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const user = await prisma.user.create({ data: { email: `owner-${t.id}@example.test`, name: "Kagiso" } });
  membershipId = (await prisma.membership.create({ data: { tenantId, userId: user.id, role: "OWNER" } })).id;

  partyId = (
    await prisma.party.create({
      data: { tenantId, name: "Jabu Ndlovu", role: "CUSTOMER", phone: "+27821234567", email: "jabu@example.test" },
    })
  ).id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.conversationNote.deleteMany({ where: { conversation: { tenantId: id } } });
    await prisma.conversation.deleteMany({ where: { tenantId: id } });
    await prisma.contactConsent.deleteMany({ where: { tenantId: id } });
    await prisma.callLog.deleteMany({ where: { tenantId: id } });
    await prisma.leadSubmission.deleteMany({ where: { tenantId: id } });
    await prisma.leadForm.deleteMany({ where: { tenantId: id } });
    await prisma.broadcast.deleteMany({ where: { tenantId: id } });
    await prisma.notification.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id, parentId: { not: null } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    const members = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
    await prisma.membership.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
    for (const m of members) await prisma.user.delete({ where: { id: m.userId } }).catch(() => {});
  }
});

describe("consent", () => {
  it("lets service through without an opt-in and stops marketing without one", async () => {
    const service = await mayContact({ tenantId, partyId, channel: "whatsapp", purpose: "service" });
    expect(service.allowed).toBe(true);

    const marketing = await mayContact({ tenantId, partyId, channel: "whatsapp", purpose: "marketing" });
    expect(marketing.allowed).toBe(false);
    expect(marketing.reason).toMatch(/no opt-in/i);

    await setConsent({ tenantId, partyId, channel: "whatsapp", state: "granted", source: "Asked at the counter" });
    expect((await mayContact({ tenantId, partyId, channel: "whatsapp", purpose: "marketing" })).allowed).toBe(true);
  });

  it("stops everything once they say stop, service included", async () => {
    await setConsent({ tenantId, partyId, channel: "whatsapp", state: "withdrawn" });
    for (const purpose of ["service", "marketing"] as const) {
      const verdict = await mayContact({ tenantId, partyId, channel: "whatsapp", purpose });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/asked not to be contacted/i);
    }
    // And only on that channel — consent is per channel, deliberately.
    expect((await mayContact({ tenantId, partyId, channel: "email", purpose: "service" })).allowed).toBe(true);
  });

  it("reads a one-word reply as an opt-out, and a sentence as not one", () => {
    for (const text of ["STOP", "  stop ", "unsubscribe", "Opt out", "remove me please"]) {
      expect(readsAsOptOut(text), text).toBe(true);
    }
    for (const text of ["stop sending me the wrong invoice, the amount is wrong and I have said so twice", "please carry on"]) {
      expect(readsAsOptOut(text), text).toBe(false);
    }
  });

  it("acts on a reply from a number or an address, and says when it matched nobody", async () => {
    const matched = await withdrawByReply({ tenantId, channel: "whatsapp", from: "+27 82 123 4567" });
    expect(matched.withdrawn).toBe(true);
    expect((await mayContact({ tenantId, partyId, channel: "whatsapp", purpose: "service" })).allowed).toBe(false);

    const missed = await withdrawByReply({ tenantId, channel: "email", from: "nobody@nowhere.test" });
    expect(missed.withdrawn).toBe(false);
  });

  it("counts the list without inventing consent for people never asked", async () => {
    await setConsent({ tenantId, partyId, channel: "email", state: "granted" });
    const summary = await consentSummary(tenantId);
    const email = summary.find((s) => s.channel === "email")!;
    expect(email).toMatchObject({ granted: 1, withdrawn: 0, unasked: 0 });
    const sms = summary.find((s) => s.channel === "sms")!;
    expect(sms.unasked).toBe(1);
  });
});

describe("conversations", () => {
  it("starts a clock when they write and stops it when somebody answers", async () => {
    const wroteAt = new Date(Date.now() - 3 * 3_600_000);
    await customerWrote({ tenantId, threadKey: "jabu|invoice", partyId, at: wroteAt });

    let open = await listConversations(tenantId, { status: "OPEN" });
    expect(open).toHaveLength(1);
    expect(open[0].waitingHours).toBe(3);
    expect(open[0].assignedTo).toBeNull();

    await weAnswered({ tenantId, threadKey: "jabu|invoice" });
    open = await listConversations(tenantId, { status: "OPEN" });
    expect(open[0].waitingSince).toBeNull();
    expect(open[0].firstReplyMins).toBeGreaterThanOrEqual(179);

    // A second question does not overwrite how long the first answer took.
    await customerWrote({ tenantId, threadKey: "jabu|invoice", partyId });
    open = await listConversations(tenantId, { status: "OPEN" });
    expect(open[0].firstReplyMins).toBeGreaterThanOrEqual(179);
  });

  it("reopens itself when they write to something marked done", async () => {
    await customerWrote({ tenantId, threadKey: "jabu|quote", partyId });
    await closeConversation({ tenantId, threadKey: "jabu|quote", closedById: membershipId });
    expect(await listConversations(tenantId, { status: "OPEN" })).toHaveLength(0);

    await customerWrote({ tenantId, threadKey: "jabu|quote", partyId });
    const open = await listConversations(tenantId, { status: "OPEN" });
    expect(open).toHaveLength(1);
    expect(open[0].waitingSince).not.toBeNull();
  });

  it("snoozes, wakes, assigns and takes a private note", async () => {
    await customerWrote({ tenantId, threadKey: "jabu|later", partyId });
    await assign({ tenantId, threadKey: "jabu|later", membershipId });
    await snooze({ tenantId, threadKey: "jabu|later", until: new Date(Date.now() + DAY) });

    expect(await listConversations(tenantId, { status: "OPEN" })).toHaveLength(0);
    expect(await wakeSnoozed(tenantId)).toBe(0);
    expect(await wakeSnoozed(tenantId, new Date(Date.now() + 2 * DAY))).toBe(1);

    const open = await listConversations(tenantId, { status: "OPEN" });
    expect(open[0].assignedTo).toBe("Kagiso");

    await addConversationNote({ tenantId, threadKey: "jabu|later", body: "Their accounts person is away until the 5th.", authorId: membershipId });
    expect((await listConversations(tenantId))[0].noteCount).toBe(1);

    await expect(assign({ tenantId: otherTenantId, threadKey: "jabu|later", membershipId })).rejects.toThrow(/not on this workspace/i);
  });

  it("reports the median rather than letting one forgotten thread describe the rest", async () => {
    for (const [key, hours] of [["a", 1], ["b", 2], ["c", 300]] as const) {
      await customerWrote({ tenantId, threadKey: key, partyId, at: new Date(Date.now() - hours * 3_600_000) });
      await weAnswered({ tenantId, threadKey: key });
    }
    const health = await responseHealth(tenantId);
    expect(health.medianFirstReplyMins).toBeGreaterThan(100);
    expect(health.medianFirstReplyMins).toBeLessThan(200);
  });
});

describe("calls", () => {
  it("matches a number to somebody on file and answers a missed call once", async () => {
    const call = await logCall({
      tenantId,
      fromNumber: "082 123 4567",
      toNumber: "+27110000000",
      direction: "in",
      status: "missed",
    });
    expect(call.partyId).toBe(partyId);

    const outcome = await handleMissedCall({ tenantId, callId: call.id });
    expect(outcome.sent).toMatch(/sorry we missed your call/i);
    expect(outcome.sent).toContain("Jabu");

    await markCallResponded({ tenantId, callId: call.id, with: "WhatsApp" });
    const again = await handleMissedCall({ tenantId, callId: call.id });
    expect(again.sent).toBeNull();
    expect(again.reason).toMatch(/already answered/i);
  });

  it("will not message somebody who asked not to be", async () => {
    await setConsent({ tenantId, partyId, channel: "whatsapp", state: "withdrawn" });
    const call = await logCall({ tenantId, fromNumber: "0821234567", toNumber: "+27110000000", direction: "in", status: "missed" });
    const outcome = await handleMissedCall({ tenantId, callId: call.id });
    expect(outcome.sent).toBeNull();
    expect(outcome.reason).toMatch(/asked not to be contacted/i);
  });

  it("counts what was missed and what was never followed up", async () => {
    await logCall({ tenantId, fromNumber: "0821234567", toNumber: "+27110000000", direction: "in", status: "missed" });
    const answered = await logCall({ tenantId, fromNumber: "0829999999", toNumber: "+27110000000", direction: "in", status: "missed" });
    await markCallResponded({ tenantId, callId: answered.id, with: "Called back" });
    await logCall({ tenantId, fromNumber: "0827777777", toNumber: "+27110000000", direction: "in", status: "answered" });

    const health = await callHealth(tenantId);
    expect(health).toMatchObject({ inbound: 3, missed: 2, missedAndAnswered: 1, missedAndIgnored: 1 });
    expect(await unansweredMissedCalls(tenantId)).toHaveLength(1);
  });
});

describe("enquiries", () => {
  it("makes a customer, records consent, and answers immediately", async () => {
    await createLeadForm({ tenantId, title: "Get a quote", autoReply: "Thanks — we will call you within the hour." });
    const form = await publicForm(tenantId, "get-a-quote");
    expect(form?.fields.some((f) => f.name === "phone")).toBe(true);

    const result = await submitLeadForm({
      tenantId,
      slug: "get-a-quote",
      answers: { name: "Thabo Stores", phone: "083 555 1234", email: "thabo@example.test", need: "Burst geyser" },
    });
    expect(result.reply).toMatch(/within the hour/i);
    expect(result.partyId).toBeTruthy();

    const created = await prisma.party.findUniqueOrThrow({ where: { id: result.partyId! } });
    expect(created.name).toBe("Thabo Stores");
    // Handing over an address and asking to be contacted on it is consent,
    // and it is recorded so the reply is defensible.
    expect((await mayContact({ tenantId, partyId: created.id, channel: "email", purpose: "marketing" })).allowed).toBe(true);

    // The same person enquiring again is the same person.
    await submitLeadForm({ tenantId, slug: "get-a-quote", answers: { name: "Thabo Stores", phone: "0835551234", need: "Again" } });
    expect(await prisma.party.count({ where: { tenantId, name: "Thabo Stores" } })).toBe(1);
  });

  it("refuses when a required answer is missing, and counts how fast they are answered", async () => {
    await createLeadForm({ tenantId, title: "Enquiry" });
    await expect(submitLeadForm({ tenantId, slug: "enquiry", answers: { name: "No phone" } })).rejects.toThrow(/phone number is needed/i);

    const one = await submitLeadForm({ tenantId, slug: "enquiry", answers: { name: "A", phone: "0821111111", need: "x" } });
    await markLeadHandled(tenantId, one.submissionId);
    await submitLeadForm({ tenantId, slug: "enquiry", answers: { name: "B", phone: "0822222222", need: "y" } });

    const health = await leadResponseHealth(tenantId);
    expect(health).toMatchObject({ enquiries: 2, unanswered: 1 });
  });
});

describe("broadcast", () => {
  it("shows who is left out and why, before anything is sent", async () => {
    const opted = await prisma.party.create({
      data: { tenantId, name: "Opted In", role: "CUSTOMER", phone: "0831111111" },
    });
    const stopped = await prisma.party.create({
      data: { tenantId, name: "Said Stop", role: "CUSTOMER", phone: "0832222222" },
    });
    await prisma.party.create({ data: { tenantId, name: "No Number", role: "CUSTOMER" } });

    await setConsent({ tenantId, partyId: opted.id, channel: "whatsapp", state: "granted" });
    await setConsent({ tenantId, partyId: stopped.id, channel: "whatsapp", state: "withdrawn" });

    const preview = await previewAudience({ tenantId, channel: "whatsapp", purpose: "marketing" });
    expect(preview.willReceive.map((r) => r.name)).toEqual(["Opted In"]);

    const reasons = preview.skipped.map((s) => s.reason).join(" ");
    expect(reasons).toMatch(/asked not to be contacted/i);
    expect(reasons).toMatch(/no opt-in/i);
    expect(preview.summary).toMatch(/left out/i);

    const draft = await draftBroadcast({ tenantId, channel: "whatsapp", purpose: "marketing", body: "Half price this week." });
    expect(draft.status).toBe("DRAFT");
    expect(draft.sentCount).toBe(0);
  });

  it("counts consent differently for a service message", async () => {
    const preview = await previewAudience({ tenantId, channel: "whatsapp", purpose: "service" });
    // Jabu has a number and has said nothing either way, which is fine for a
    // message about their own work and not fine for an offer.
    expect(preview.willReceive.map((r) => r.name)).toEqual(["Jabu Ndlovu"]);
  });

  it("filters a list in one pass the same way it filters one person", async () => {
    await setConsent({ tenantId, partyId, channel: "sms", state: "withdrawn" });
    const { allowed, skipped } = await filterByConsent({ tenantId, partyIds: [partyId], channel: "sms", purpose: "service" });
    expect(allowed).toEqual([]);
    expect(skipped[0].reason).toMatch(/asked not to be contacted/i);
  });
});

describe("the timeline", () => {
  it("merges everything with one customer into one list, newest first", async () => {
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 250_000, createdAt: new Date(Date.now() - 5 * DAY) },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 250_000, parentId: invoice.id, createdAt: new Date(Date.now() - DAY) },
    });
    await logCall({
      tenantId,
      fromNumber: "0821234567",
      toNumber: "+27110000000",
      direction: "in",
      status: "answered",
      durationSeconds: 240,
      startedAt: new Date(Date.now() - 3 * DAY),
    });

    const timeline = await customerTimeline(tenantId, partyId);
    expect(timeline).not.toBeNull();
    expect(timeline!.customer).toBe("Jabu Ndlovu");

    const kinds = timeline!.entries.map((e) => e.kind);
    expect(kinds).toEqual(["payment", "call", "invoice"]);
    // Ordering is the whole point.
    for (let i = 1; i < timeline!.entries.length; i++) {
      expect(timeline!.entries[i - 1].at.getTime()).toBeGreaterThanOrEqual(timeline!.entries[i].at.getTime());
    }

    expect(timeline!.summary.invoicedCents).toBe(250_000);
    expect(timeline!.summary.paidCents).toBe(250_000);
    expect(timeline!.summary.outstandingCents).toBe(0);
    expect(timeline!.summary.quietForDays).toBe(1);
  });

  it("gives nothing for somebody in another workspace", async () => {
    expect(await customerTimeline(otherTenantId, partyId)).toBeNull();
  });
});
