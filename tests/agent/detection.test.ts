// "It notices things" is the other half of the agentic claim, and it rots the
// same way tool coverage does — quietly. The event bus declared nine signals
// from the day it shipped; the business emitted three of them. The rest were
// dead constants, so a customer could sign a quote and the agent would never
// hear about it.
//
// Two kinds of check here: a static one that fails when a declared event type
// has no emitter anywhere in the source, and behavioural ones against a real
// database for the paths that were actually silent.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { PartyRole, TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { EVENT_LABELS, isActionable, type DomainEventType } from "../../src/lib/agent/events";
import { acceptQuoteWithSignature, recordPayment, createQuote } from "../../src/lib/core/money";
import { createParty } from "../../src/lib/core/parties";
import { markClaimDenied } from "../../src/lib/core/claims";

const SRC = join(process.cwd(), "src");

/** Every .ts/.tsx file under src, except the bus's own declarations. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

// Types recorded for the activity feed by something other than a domain
// emitter, or deliberately not emitted yet — each needs a reason, and the
// second test below makes sure a reason here can't hide a real emitter.
const NOT_EMITTED_BY_DESIGN: Partial<Record<DomainEventType, string>> = {};

describe("detection coverage", () => {
  const corpus = sourceFiles(SRC)
    .filter((f) => !f.endsWith(join("lib", "agent", "events.ts")))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("emits every event type it declares", () => {
    const declared = Object.keys(EVENT_LABELS) as DomainEventType[];
    const orphaned = declared
      .filter((t) => !(t in NOT_EMITTED_BY_DESIGN))
      .filter((t) => !corpus.includes(`"${t}"`));

    // Anything here is a signal the UI and the prompts talk about but that
    // nothing in the business ever raises. Wire it, or record why not.
    expect(orphaned, "declared event types with no emitter").toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const contradictions = Object.keys(NOT_EMITTED_BY_DESIGN).filter((t) =>
      corpus.includes(`"${t}"`)
    );
    expect(contradictions, "listed as not emitted but actually emitted").toEqual([]);
  });

  it("wakes the agent for the events that need a decision, and not the rest", () => {
    // Good news must stay out of the queue or the queue becomes noise.
    expect(isActionable("invoice.overdue")).toBe(true);
    expect(isActionable("payment.failed")).toBe(true);
    expect(isActionable("quote.accepted")).toBe(true);
    expect(isActionable("invoice.paid")).toBe(false);
    expect(isActionable("customer.created")).toBe(false);
  });
});

describe("the paths that were silent", () => {
  let tenantId: string;
  let partyId: string;
  let itemId: string;

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: "Detect Co", niche: "SERVICES" } });
    tenantId = t.id;
    const p = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Signer" },
    });
    partyId = p.id;
    const i = await prisma.item.create({
      data: { tenantId, name: "Install", unitPriceCents: 500_00 },
    });
    itemId = i.id;
  });

  afterAll(async () => {
    await prisma.domainEvent.deleteMany({ where: { tenantId } });
    await prisma.insuranceClaim.deleteMany({ where: { tenantId } });
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
    await prisma.transaction.deleteMany({ where: { tenantId } });
    await prisma.item.deleteMany({ where: { tenantId } });
    await prisma.party.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  const eventsOfType = (type: string, subjectId?: string) =>
    prisma.domainEvent.findMany({
      where: { tenantId, type, ...(subjectId ? { subjectId } : {}) },
    });

  it("raises quote.accepted when a customer signs, not only when they click a button", async () => {
    // The signature flow is the path most customers take, and it emitted
    // nothing at all — the agent's most important trigger was unreachable
    // from the way it actually happens.
    const quote = await createQuote({
      tenantId,
      partyId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 500_00 }],
    });

    await acceptQuoteWithSignature({
      quoteId: quote.id,
      signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      acceptanceIp: "127.0.0.1",
    });

    const raised = await eventsOfType("quote.accepted", quote.id);
    expect(raised).toHaveLength(1);
    expect(raised[0].processedAt, "accepted quotes must reach the agent's queue").toBeNull();
  });

  it("raises invoice.paid only once the invoice is fully settled", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId,
        partyId,
        type: TransactionType.INVOICE,
        status: TransactionStatus.SENT,
        amountCents: 1000_00,
      },
    });

    await recordPayment({ invoiceId: invoice.id, amountCents: 400_00 });
    expect(await eventsOfType("invoice.paid", invoice.id)).toHaveLength(0);

    await recordPayment({ invoiceId: invoice.id, amountCents: 600_00 });
    const paid = await eventsOfType("invoice.paid", invoice.id);
    expect(paid).toHaveLength(1);
    // Good news: recorded for the feed, already marked handled.
    expect(paid[0].processedAt).not.toBeNull();
  });

  it("raises customer.created for customers and stays quiet for suppliers", async () => {
    const customer = await createParty({ tenantId, role: PartyRole.CUSTOMER, name: "New Buyer" });
    const supplier = await createParty({ tenantId, role: PartyRole.SUPPLIER, name: "Parts Ltd" });

    expect(await eventsOfType("customer.created", customer.id)).toHaveLength(1);
    expect(await eventsOfType("customer.created", supplier.id)).toHaveLength(0);
  });

  it("raises dispute.raised when a claim is denied", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId,
        partyId,
        type: TransactionType.INVOICE,
        status: TransactionStatus.SENT,
        amountCents: 2000_00,
      },
    });
    const claim = await prisma.insuranceClaim.create({
      data: { tenantId, transactionId: invoice.id, payerName: "Discovery", claimedCents: 2000_00 },
    });

    await markClaimDenied(tenantId, claim.id, "Coding error");

    const raised = await eventsOfType("dispute.raised", claim.id);
    expect(raised).toHaveLength(1);
    expect(raised[0].processedAt, "a denial ages into a write-off unless someone acts").toBeNull();
    expect((raised[0].payload as { denialReason?: string }).denialReason).toBe("Coding error");
  });
});
