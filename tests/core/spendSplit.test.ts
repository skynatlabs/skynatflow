// Business cost versus the owner's own money.
//
// The behaviour worth defending is the refusal: unclassified spending is
// reported as its own number rather than quietly counted as a business cost.
// Folding it in would reproduce exactly the error the feature exists to fix,
// and would do it invisibly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  classifyExpense,
  spendSplit,
  unclassifiedExpenses,
} from "../../src/lib/core/expenses";

let tenantId: string;
let membershipId: string;

async function expense(amountCents: number, opts: { isOwnerDrawing?: boolean; status?: "PENDING" | "APPROVED" | "REJECTED"; text?: string } = {}) {
  return prisma.expense.create({
    data: {
      tenantId,
      submittedById: membershipId,
      descriptionText: opts.text ?? "Something",
      amountCents,
      status: opts.status ?? "APPROVED",
      ...(opts.isOwnerDrawing === undefined ? {} : { isOwnerDrawing: opts.isOwnerDrawing }),
    },
  });
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Split Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `split-${t.id}@test.local`, name: "Owner" } });
  const m = await prisma.membership.create({
    data: { tenantId, userId: u.id, role: "OWNER" },
  });
  membershipId = m.id;
});

afterEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  await prisma.membership.delete({ where: { id: membershipId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  if (m) await prisma.user.delete({ where: { id: m.userId } });
});

describe("spendSplit", () => {
  it("keeps unclassified spending as its own number", async () => {
    await expense(10_000, { isOwnerDrawing: false });
    await expense(5_000, { isOwnerDrawing: true });
    await expense(3_000); // nobody has said

    const split = await spendSplit(tenantId);
    expect(split.businessCents).toBe(10_000);
    expect(split.drawingsCents).toBe(5_000);
    // The whole point: not silently added to business costs.
    expect(split.unreviewedCents).toBe(3_000);
    expect(split.unreviewedCount).toBe(1);
  });

  it("ignores rejected expenses, which were never spent", async () => {
    await expense(10_000, { isOwnerDrawing: false });
    await expense(99_000, { isOwnerDrawing: false, status: "REJECTED" });

    const split = await spendSplit(tenantId);
    expect(split.businessCents).toBe(10_000);
  });

  it("says nothing when everything is classified as business cost", async () => {
    await expense(10_000, { isOwnerDrawing: false });
    const split = await spendSplit(tenantId);
    expect(split.summary).toBe("");
  });

  it("names both problems in one sentence when both exist", async () => {
    await expense(50_000, { isOwnerDrawing: true });
    await expense(2_000);
    await expense(1_000);

    const split = await spendSplit(tenantId);
    expect(split.summary).toContain("was you, not the business");
    expect(split.summary).toContain("2 payments");
    expect(split.summary).toContain("not been split either way");
  });
});

describe("unclassifiedExpenses", () => {
  it("returns only what nobody has decided about", async () => {
    await expense(1_000, { isOwnerDrawing: false, text: "Decided business" });
    await expense(2_000, { isOwnerDrawing: true, text: "Decided personal" });
    await expense(3_000, { text: "Undecided" });

    const rows = await unclassifiedExpenses(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptionText).toBe("Undecided");
  });

  it("drops out of the list once classified", async () => {
    const e = await expense(3_000, { text: "Fuel" });
    expect(await unclassifiedExpenses(tenantId)).toHaveLength(1);

    await classifyExpense({ tenantId, expenseId: e.id, isOwnerDrawing: false });
    expect(await unclassifiedExpenses(tenantId)).toHaveLength(0);

    const split = await spendSplit(tenantId);
    expect(split.businessCents).toBe(3_000);
    expect(split.unreviewedCents).toBe(0);
  });

  it("refuses to classify another workspace's payment", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Split Co", niche: "SERVICES" } });
    const e = await expense(1_000);
    await expect(
      classifyExpense({ tenantId: other.id, expenseId: e.id, isOwnerDrawing: true })
    ).rejects.toThrow(/not found/);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
