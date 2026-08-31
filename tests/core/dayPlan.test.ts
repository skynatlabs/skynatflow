// The Today planner — merges real, timed appointments/job cards with
// proactively-surfaced untimed priorities (overdue > follow-up-due >
// stale > unscheduled job cards), deduped so nothing appears twice. See
// src/lib/core/dayPlan.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { createQuote, recordResponse, convertToInvoice } from "../../src/lib/core/money";
import { getTodayPlan } from "../../src/lib/core/dayPlan";

let tenantId: string;
let itemId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Day Plan Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const item = await prisma.item.create({ data: { tenantId, name: "Day Plan Widget", unitPriceCents: 100000 } });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.jobCardTask.deleteMany({ where: { jobCard: { tenantId } } });
  await prisma.jobCard.deleteMany({ where: { tenantId } });
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("getTodayPlan", () => {
  it("puts today's real appointments in the timed list, sorted chronologically", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Timed Customer" } });
    const later = new Date(); later.setHours(15, 0, 0, 0);
    const earlier = new Date(); earlier.setHours(9, 0, 0, 0);

    await prisma.event.create({ data: { tenantId, partyId: customer.id, type: "SITE_VISIT", scheduledAt: later } });
    await prisma.event.create({ data: { tenantId, partyId: customer.id, type: "CONSULTATION", scheduledAt: earlier } });

    const plan = await getTodayPlan(tenantId);
    const times = plan.timed.filter((t) => t.partyName === "Timed Customer").map((t) => t.scheduledAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.length).toBe(2);
  });

  it("surfaces an overdue invoice as the most urgent untimed item", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Overdue Customer" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await prisma.transaction.update({ where: { id: invoice.id }, data: { status: "SENT", dueAt: new Date(Date.now() - 5 * 86400000) } });

    const plan = await getTodayPlan(tenantId);
    const found = plan.untimed.find((u) => u.id === invoice.id);
    expect(found?.reason).toBe("overdue_invoice");
    expect(found?.urgencyRank).toBe(0);
  });

  it("never lists the same transaction twice even if it qualifies for multiple reasons", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Dedup Customer" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    // Overdue AND has a follow-up due today AND is stale (createdAt old) — should still appear once.
    await prisma.transaction.update({
      where: { id: invoice.id },
      data: { status: "SENT", dueAt: new Date(Date.now() - 5 * 86400000), nextFollowUpAt: new Date(), createdAt: new Date(Date.now() - 10 * 86400000) },
    });

    const plan = await getTodayPlan(tenantId);
    const matches = plan.untimed.filter((u) => u.id === invoice.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe("overdue_invoice"); // most urgent reason wins
  });

  it("lists an unscheduled job card as untimed, never inventing a time for it", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Job Card Customer" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    const jobCard = await prisma.jobCard.create({ data: { tenantId, transactionId: quote.id, partyId: customer.id, title: "Unscheduled install" } });

    const plan = await getTodayPlan(tenantId);
    const found = plan.untimed.find((u) => u.id === jobCard.id);
    expect(found?.reason).toBe("unscheduled_job_card");
    expect(plan.timed.some((t) => t.id === jobCard.id)).toBe(false);
  });

  it("excludes an appointment already marked as a no-show from today's schedule", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "No-Show Customer" } });
    const todayAt10am = new Date(); todayAt10am.setHours(10, 0, 0, 0);
    const event = await prisma.event.create({ data: { tenantId, partyId: customer.id, type: "SITE_VISIT", scheduledAt: todayAt10am, noShow: true } });

    const plan = await getTodayPlan(tenantId);
    expect(plan.timed.some((t) => t.id === event.id)).toBe(false);
  });

  it("puts a job card scheduled for today in the timed list instead", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Scheduled Job Card Customer" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    const todayAt2pm = new Date(); todayAt2pm.setHours(14, 0, 0, 0);
    const jobCard = await prisma.jobCard.create({ data: { tenantId, transactionId: quote.id, partyId: customer.id, title: "Scheduled install", scheduledAt: todayAt2pm } });

    const plan = await getTodayPlan(tenantId);
    expect(plan.timed.some((t) => t.id === jobCard.id)).toBe(true);
    expect(plan.untimed.some((u) => u.id === jobCard.id)).toBe(false);
  });
});
