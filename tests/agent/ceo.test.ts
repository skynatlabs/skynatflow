// The chief executive.
//
// Its judgement is arithmetic, so it can be tested the way an executive is
// judged: seed three months of a business and ask which customer it names.
// The model, when there is one, only rewrites the sentence; these tests run
// without it and assert the facts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { runCEO } from "../../src/lib/agent/officers/ceo";
import { listOpen } from "../../src/lib/agent/observations";
import { submitExpense } from "../../src/lib/core/expenses";
import { formatMoney } from "../../src/lib/core/currency";

let tenantId: string;
let ownerId: string;
let userId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "CEO Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `ceo-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
});

afterEach(async () => {
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

async function customer(name: string, invoices: number[], costs: number[]) {
  const p = await prisma.party.create({ data: { tenantId, name, role: "CUSTOMER" } });
  for (const amount of invoices) {
    const inv = await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "INVOICE", status: "PAID", amountCents: amount } });
    for (const c of costs) {
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Job cost", amountCents: c, transactionId: inv.id, isOwnerDrawing: false });
    }
  }
  return p;
}

describe("the CEO", () => {
  it("is silent on an empty workspace", async () => {
    const run = await runCEO(tenantId, { force: true, phrase: false });
    expect(run.ran).toBe(true);
    expect(run.observed).toBe(0);
    expect(run.failed).toEqual([]);
  });

  it("names the customer that costs more to serve than they pay, with the figures", async () => {
    const loser = await customer("Loss Maker", [3_000_00, 3_000_00], [4_000_00]);
    await customer("Good Client", [10_000_00, 10_000_00], [2_000_00]);

    const run = await runCEO(tenantId, { force: true, phrase: false });
    expect(run.observed).toBeGreaterThanOrEqual(1);

    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === `ceo:customer-loss:${loser.id}`);
    expect(found).toBeTruthy();
    expect(found!.officer).toBe("CEO");
    expect(found!.headline).toContain("Loss Maker");
    expect(found!.headline).toContain(formatMoney(2_000_00, "ZAR"));
    expect(found!.proposedAction).toContain("Reprice");
    // The facts that led there travel with it.
    const evidence = found!.evidence as Array<{ label: string; value: string }>;
    expect(evidence.map((e) => e.label)).toEqual(["Customer", "Money", "Margin", "Basis"]);

    expect((await listOpen(tenantId)).some((o) => o.headline.includes("Good Client") && o.dedupeKey.startsWith("ceo:customer-loss"))).toBe(false);
  });

  it("notices when one customer is most of the business", async () => {
    const whale = await customer("The Whale", [50_000_00], []);
    await customer("Small A", [5_000_00], []);
    await customer("Small B", [5_000_00], []);

    await runCEO(tenantId, { force: true, phrase: false });
    const found = (await listOpen(tenantId)).find((o) => o.dedupeKey === `ceo:concentration:${whale.id}`);
    expect(found).toBeTruthy();
    expect(found!.headline).toContain("83%");
    expect(found!.confidence).toBe(75);
  });

  it("speaks once a month, then holds its peace", async () => {
    await customer("The Whale", [50_000_00], []);
    await customer("Small A", [5_000_00], []);
    await customer("Small B", [5_000_00], []);

    const first = await runCEO(tenantId, { force: true, phrase: false });
    expect(first.observed).toBeGreaterThanOrEqual(1);

    const second = await runCEO(tenantId, { phrase: false });
    expect(second.ran).toBe(false);
    expect(second.skipped).toContain("this month");

    const nextMonth = await runCEO(tenantId, { now: new Date(Date.now() + 40 * 86_400_000), phrase: false });
    expect(nextMonth.ran).toBe(true);
  });

  it("only ever suggests — the ladder caps it whatever anyone sets", async () => {
    // Asserted via the ladder's own hard cap; the CEO writes at SUGGEST and
    // nothing here can raise it.
    const { getCeiling, setCeiling } = await import("../../src/lib/agent/ladder");
    await setCeiling({ tenantId, officer: "CEO", ceiling: "ACT" }).catch(() => undefined);
    expect(await getCeiling(tenantId, "CEO")).toBe("SUGGEST");
  });
});
