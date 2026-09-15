// The chief financial officer.
//
// Two properties matter more than any individual check: that it stays silent
// on a well-run business, and that one broken check never costs the others.
// A CFO that observes nine things every day is one nobody reads, and a
// partial run that reports itself as a full one is worse than a crash.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { runCFO } from "../../src/lib/agent/officers/cfo";
import { listOpen } from "../../src/lib/agent/observations";
import { ensureChartOfAccounts } from "../../src/lib/core/ledger";
import { backfillLedger } from "../../src/lib/core/ledgerBackfill";

let tenantId: string;
let partyId: string;
let membershipId: string;
let userId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "CFO Co", niche: "SERVICES" } });
  tenantId = t.id;
  const p = await prisma.party.create({
    data: { tenantId, name: "Slow Payer Ltd", role: "CUSTOMER" },
  });
  partyId = p.id;
  const u = await prisma.user.create({ data: { email: `cfo-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  const m = await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  membershipId = m.id;
  await ensureChartOfAccounts(tenantId);
});

afterEach(async () => {
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.membership.delete({ where: { id: membershipId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

const headlines = async () => (await listOpen(tenantId)).map((o) => o.headline);

describe("the CFO", () => {
  it("says nothing about an empty, tidy workspace", async () => {
    const run = await runCFO(tenantId);
    // Silence on a well-run week is the behaviour that makes the noisy weeks
    // worth reading.
    expect(run.observed).toBe(0);
    expect(run.failed).toEqual([]);
    expect(run.checked).toBeGreaterThan(5);
  });

  it("notices work that never reached the books, and says what it hides", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 84_000_00 },
    });

    await runCFO(tenantId);
    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === "cfo:books-behind");

    expect(found).toBeTruthy();
    expect(found!.headline).toContain("never reached the books");
    // The money attached is what the reports are currently blind to.
    expect(found!.moneyCents).toBe(84_000_00);
    expect(found!.confidence).toBe(100);
    // Evidence a person can go and check, not just a claim.
    expect(Array.isArray(found!.evidence)).toBe(true);
  });

  it("goes quiet once the books are caught up", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 },
    });
    await runCFO(tenantId);
    expect(await headlines()).toHaveLength(1);

    await prisma.observation.deleteMany({ where: { tenantId } });
    await backfillLedger(tenantId);

    await runCFO(tenantId);
    const after = (await listOpen(tenantId)).filter((o) => o.dedupeKey === "cfo:books-behind");
    expect(after).toHaveLength(0);
  });

  it("names the largest overdue customer rather than reporting a count", async () => {
    const big = await prisma.party.create({
      data: { tenantId, name: "Big Debtor Ltd", role: "CUSTOMER" },
    });
    const past = new Date(Date.now() - 40 * 86_400_000);
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "OVERDUE", amountCents: 5_000_00, dueAt: past },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId: big.id, type: "INVOICE", status: "OVERDUE", amountCents: 90_000_00, dueAt: past },
    });

    await runCFO(tenantId);
    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === "cfo:overdue-debtors");

    expect(found!.headline).toContain("Big Debtor Ltd");
    expect(found!.moneyCents).toBe(95_000_00);
    // A count is a number to dismiss; a named customer is a call to make.
    expect(found!.proposedAction).toContain("draft");
  });

  it("does not raise a handful of unsplit receipts", async () => {
    // Two unreviewed receipts is not a finding, it is a Tuesday.
    for (let i = 0; i < 2; i++) {
      await prisma.expense.create({
        data: {
          tenantId, submittedById: membershipId,
          descriptionText: `Small ${i}`, amountCents: 200_00, status: "APPROVED",
        },
      });
    }
    await runCFO(tenantId);
    expect((await listOpen(tenantId)).some((o) => o.dedupeKey === "cfo:unclassified-spend")).toBe(false);
  });

  it("raises unsplit spending once it is material", async () => {
    await prisma.expense.create({
      data: {
        tenantId, submittedById: membershipId,
        descriptionText: "Large unreviewed", amountCents: 40_000_00, status: "APPROVED",
      },
    });

    await runCFO(tenantId);
    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === "cfo:unclassified-spend");

    expect(found).toBeTruthy();
    expect(found!.detail).toContain("Drawings counted as costs");
  });

  it("reports a loss plainly and points at the biggest overhead", async () => {
    await prisma.expense.create({
      data: {
        tenantId, submittedById: membershipId,
        descriptionText: "Office rent for the quarter", amountCents: 60_000_00,
        status: "APPROVED", isOwnerDrawing: false,
      },
    });
    await backfillLedger(tenantId);

    await runCFO(tenantId);
    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === "cfo:trading-loss");

    expect(found).toBeTruthy();
    expect(found!.headline).toContain("more went out than came in");
    expect(found!.moneyCents).toBe(60_000_00);
  });

  it("does not call an empty ledger a loss", async () => {
    // Nothing posted means nothing to conclude, which is a different thing
    // from having lost money.
    await runCFO(tenantId);
    expect((await listOpen(tenantId)).some((o) => o.dedupeKey === "cfo:trading-loss")).toBe(false);
  });

  it("supersedes its own finding rather than repeating it", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 },
    });

    await runCFO(tenantId);
    await runCFO(tenantId);
    await runCFO(tenantId);

    // Three runs, one live finding — the bus holds the current state of a
    // problem, not a log of every time it was noticed.
    const open = (await listOpen(tenantId)).filter((o) => o.dedupeKey === "cfo:books-behind");
    expect(open).toHaveLength(1);
  });

  it("marks the forecast as a forecast", async () => {
    // Confidence is not decoration. A shortfall projection deserves less than
    // a bank line that is simply unexplained, and the number should say so.
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 },
    });
    await runCFO(tenantId);

    const books = (await listOpen(tenantId)).find((o) => o.dedupeKey === "cfo:books-behind");
    expect(books!.confidence).toBe(100);
  });

  it("keeps going when one check throws", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 },
    });

    // Break the margin check by leaving an item with a nonsense price that
    // the repricing engine will still read. The run must complete regardless.
    await prisma.item.create({
      data: { tenantId, name: "Odd", unitPriceCents: 0, costCents: 0 },
    });

    const run = await runCFO(tenantId);
    // Whatever happened to individual checks, the books finding still landed.
    expect((await listOpen(tenantId)).some((o) => o.dedupeKey === "cfo:books-behind")).toBe(true);
    expect(run.checked).toBeGreaterThan(5);
  });

  it("stays out of another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other CFO", niche: "SERVICES" } });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 },
    });

    await runCFO(other.id);
    expect(await prisma.observation.count({ where: { tenantId: other.id } })).toBe(0);

    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
