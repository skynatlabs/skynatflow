// The setup strip decides what a brand-new business is told to do next, and
// when to stop telling them. The properties that matter: it reads real rows
// so it can never disagree with the workspace, it points at the thing that
// unblocks the most, and it retires itself once the business is actually
// invoicing and getting paid.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { getReadiness } from "../../src/lib/core/readiness";

let tenantId: string;
let partyId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Fresh Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenantPdfTemplate.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("a brand-new workspace", () => {
  it("has nothing done and knows what comes first", async () => {
    const r = await getReadiness(tenantId);
    expect(r.doneCount).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.operational).toBe(false);
    // A customer, because nothing else can exist without one.
    expect(r.nextStep?.key).toBe("customer");
  });

  it("gives every step a reason in the owner's terms", async () => {
    const r = await getReadiness(tenantId);
    for (const step of r.steps) {
      expect(step.why.length).toBeGreaterThan(15);
      // Not "configure X" — a reason, not an instruction.
      expect(step.why.toLowerCase()).not.toMatch(/^configure |^set up /);
      expect(step.href).toContain(tenantId);
    }
  });
});

describe("it ticks itself off", () => {
  it("notices a customer without being told", async () => {
    const p = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "First Client" },
    });
    partyId = p.id;

    const r = await getReadiness(tenantId);
    expect(r.steps.find((s) => s.key === "customer")?.done).toBe(true);
    expect(r.nextStep?.key).toBe("product");
  });

  it("notices a product", async () => {
    await prisma.item.create({ data: { tenantId, name: "A service", unitPriceCents: 50_000 } });
    const r = await getReadiness(tenantId);
    expect(r.steps.find((s) => s.key === "product")?.done).toBe(true);
  });

  it("does not count a draft quote as a sent one", async () => {
    const draft = await prisma.transaction.create({
      data: {
        tenantId, partyId, type: TransactionType.QUOTE,
        status: TransactionStatus.DRAFT, amountCents: 100_000,
      },
    });

    let r = await getReadiness(tenantId);
    expect(r.steps.find((s) => s.key === "quote")?.done).toBe(false);

    await prisma.transaction.update({
      where: { id: draft.id },
      data: { status: TransactionStatus.SENT },
    });
    r = await getReadiness(tenantId);
    expect(r.steps.find((s) => s.key === "quote")?.done).toBe(true);
  });

  it("counts business details and banking from the tenant itself", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { businessAddress: "12 Long Street, Cape Town", bankAccountNumber: "001234567" },
    });
    const r = await getReadiness(tenantId);
    expect(r.steps.find((s) => s.key === "businessDetails")?.done).toBe(true);
    expect(r.steps.find((s) => s.key === "banking")?.done).toBe(true);
  });
});

describe("retiring", () => {
  it("stays up while a core step is outstanding, even at high progress", async () => {
    const r = await getReadiness(tenantId);
    // Everything but a recorded payment.
    expect(r.steps.find((s) => s.key === "payment")?.done).toBe(false);
    expect(r.operational).toBe(false);
    expect(r.nextStep?.key).toBe("payment");
  });

  it("retires once money has moved, without waiting on the optional steps", async () => {
    await prisma.transaction.create({
      data: {
        tenantId, partyId, type: TransactionType.PAYMENT,
        status: TransactionStatus.PAID, amountCents: 100_000,
      },
    });

    const r = await getReadiness(tenantId);
    expect(r.operational).toBe(true);
    // Deliberately still incomplete — a business that is invoicing and being
    // paid is operational whether or not it invited a teammate, and nagging
    // past that point is how a checklist becomes furniture.
    expect(r.doneCount).toBeLessThan(r.total);
  });
});
