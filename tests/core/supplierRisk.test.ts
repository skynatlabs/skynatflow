// Every flag here is a question for a person, never a finding, so the tests
// check both halves: that the real pattern is caught, and that the wording
// stays a question with the fact that prompted it attached.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  editDistance,
  setSupplierBankDetails,
  bankDetailHistory,
  screenBills,
  lookalikeSuppliers,
} from "../../src/lib/core/supplierRisk";

let tenantId: string;
let supplierId: string;

async function supplier(name: string) {
  const p = await prisma.party.create({ data: { tenantId, role: PartyRole.SUPPLIER, name } });
  return p.id;
}

async function bill(params: {
  supplierId?: string;
  amountCents: number;
  reference?: string;
  daysAgo?: number;
  status?: "AWAITING_APPROVAL" | "APPROVED";
  approvedById?: string;
}) {
  const issuedOn = new Date(Date.now() - (params.daysAgo ?? 1) * 86_400_000);
  const created = await prisma.supplierBill.create({
    data: {
      tenantId,
      supplierId: params.supplierId ?? supplierId,
      reference: params.reference,
      issuedOn,
      dueOn: new Date(issuedOn.getTime() + 30 * 86_400_000),
      amountCents: params.amountCents,
      status: params.status ?? "AWAITING_APPROVAL",
      approvedById: params.approvedById,
    },
  });
  return created.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Supplier Risk Test Co", niche: "SERVICES" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.supplierBill.deleteMany({ where: { tenantId } });
  await prisma.partyBankChange.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.supplierBill.deleteMany({ where: { tenantId } });
  await prisma.partyBankChange.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  supplierId = await supplier("Mahlangu Trading");
});

describe("edit distance", () => {
  it("counts a single character swap as one", () => {
    expect(editDistance("mahlangu", "mahlangv")).toBe(1);
  });

  it("gives up rather than computing a big distance", () => {
    expect(editDistance("short", "acompletelydifferentname", 2)).toBeGreaterThan(2);
  });

  it("is zero for identical strings", () => {
    expect(editDistance("acme", "acme")).toBe(0);
  });
});

describe("remembering where a supplier gets paid", () => {
  it("records the first set of details without calling it a change", async () => {
    const result = await setSupplierBankDetails({
      tenantId,
      partyId: supplierId,
      bankName: "FNB",
      bankAccountNumber: "62012345678",
    });
    expect(result.changed).toBe(true);
    expect(result.wasFirstTime).toBe(true);
  });

  it("keeps what the account number used to be", async () => {
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "62012345678" });
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "10987654321" });

    const history = await bankDetailHistory(tenantId, supplierId);
    expect(history).toHaveLength(2);
    expect(history[0].fromAccountNumber).toBe("62012345678");
    expect(history[0].toAccountNumber).toBe("10987654321");
  });

  it("writes nothing when nothing changed", async () => {
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "62012345678" });
    const again = await setSupplierBankDetails({
      tenantId,
      partyId: supplierId,
      bankAccountNumber: "620 123 456 78",
    });
    expect(again.changed).toBe(false);
    expect(await bankDetailHistory(tenantId, supplierId)).toHaveLength(1);
  });

  it("refuses a supplier from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    const theirs = await prisma.party.create({
      data: { tenantId: other.id, role: PartyRole.SUPPLIER, name: "Theirs" },
    });
    await expect(
      setSupplierBankDetails({ tenantId, partyId: theirs.id, bankAccountNumber: "1" })
    ).rejects.toThrow(/not in this workspace/i);
    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("questions worth asking before the money goes", () => {
  it("asks about a bank account that changed recently", async () => {
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "62012345678" });
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "10987654321" });
    await bill({ amountCents: 450000 });

    const result = await screenBills({ tenantId });
    const flag = result.flags.find((f) => f.kind === "BANK_DETAILS_CHANGED");
    expect(flag?.question).toMatch(/\?$/);
    expect(flag?.because).toContain("62012345678");
    expect(flag?.because).toMatch(/ring the number you already had/i);
  });

  it("does not ask about details being filled in for the first time", async () => {
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "62012345678" });
    await bill({ amountCents: 450000 });
    const result = await screenBills({ tenantId });
    expect(result.flags.find((f) => f.kind === "BANK_DETAILS_CHANGED")).toBeUndefined();
  });

  it("notices a second supplier with almost the same name", async () => {
    await supplier("Mahlangu Tradlng");
    await bill({ amountCents: 100000 });

    const result = await screenBills({ tenantId });
    const flag = result.flags.find((f) => f.kind === "LOOKALIKE_SUPPLIER");
    expect(flag).toBeDefined();
    expect(flag?.question).toMatch(/Mahlangu/);
  });

  it("does not confuse two genuinely different suppliers", async () => {
    await supplier("Cape Fasteners");
    await bill({ amountCents: 100000 });
    const result = await screenBills({ tenantId });
    expect(result.flags.find((f) => f.kind === "LOOKALIKE_SUPPLIER")).toBeUndefined();
  });

  it("notices an invoice number it has seen before", async () => {
    await bill({ amountCents: 100000, reference: "INV-4471", daysAgo: 60 });
    await bill({ amountCents: 250000, reference: "inv-4471" });

    const result = await screenBills({ tenantId });
    const flag = result.flags.find((f) => f.kind === "DUPLICATE_REFERENCE");
    // Matching is deliberately case-insensitive, so whichever of the two
    // bills is screened first supplies the wording.
    expect(flag?.question).toMatch(/inv-4471/i);
  });

  it("notices the same amount twice in a fortnight", async () => {
    await bill({ amountCents: 375000, daysAgo: 6 });
    await bill({ amountCents: 375000, daysAgo: 1 });

    const result = await screenBills({ tenantId });
    expect(result.flags.filter((f) => f.kind === "SAME_AMOUNT_RECENTLY").length).toBeGreaterThan(0);
  });

  it("leaves the same amount a quarter apart alone", async () => {
    await bill({ amountCents: 375000, daysAgo: 95 });
    await bill({ amountCents: 375000, daysAgo: 1 });
    const result = await screenBills({ tenantId });
    expect(result.flags.find((f) => f.kind === "SAME_AMOUNT_RECENTLY")).toBeUndefined();
  });

  it("notices a bill stopping just short of needing a second signature", async () => {
    await bill({ amountCents: 499000 });
    const result = await screenBills({ tenantId, approvalThresholdCents: 500000 });
    const flag = result.flags.find((f) => f.kind === "JUST_UNDER_APPROVAL");
    expect(flag?.because).toMatch(/split in two/i);
  });

  it("leaves a bill comfortably under the limit alone", async () => {
    await bill({ amountCents: 120000 });
    const result = await screenBills({ tenantId, approvalThresholdCents: 500000 });
    expect(result.flags.find((f) => f.kind === "JUST_UNDER_APPROVAL")).toBeUndefined();
  });

  it("phrases every flag as a question with the fact behind it", async () => {
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "1111" });
    await setSupplierBankDetails({ tenantId, partyId: supplierId, bankAccountNumber: "2222" });
    await supplier("Mahlangu Tradlng");
    await bill({ amountCents: 100000, reference: "A1" });
    await bill({ amountCents: 100000, reference: "A1" });

    const result = await screenBills({ tenantId });
    expect(result.flags.length).toBeGreaterThan(2);
    for (const flag of result.flags) {
      expect(flag.question.endsWith("?"), `not a question: ${flag.question}`).toBe(true);
      expect(flag.because.length).toBeGreaterThan(10);
      expect(flag.question).not.toMatch(/fraud|stealing|theft|criminal/i);
    }
  });

  it("says so plainly when nothing is waiting to be paid", async () => {
    const result = await screenBills({ tenantId });
    expect(result.summary).toMatch(/nothing is waiting/i);
  });

  it("leaves paid bills out — a post-mortem nobody asked for is noise", async () => {
    const id = await bill({ amountCents: 100000 });
    await prisma.supplierBill.update({ where: { id }, data: { status: "PAID" } });
    const result = await screenBills({ tenantId });
    expect(result.billsChecked).toBe(0);
  });
});

describe("duplicate supplier records", () => {
  it("pairs them up so one supplier's spend stops being split in two", async () => {
    await supplier("Mahlangu Tradlng");
    const pairs = await lookalikeSuppliers(tenantId);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].aName, pairs[0].bName].sort()).toEqual(["Mahlangu Trading", "Mahlangu Tradlng"]);
  });

  it("sees through a company suffix", async () => {
    await supplier("Mahlangu Trading (Pty) Ltd");
    const pairs = await lookalikeSuppliers(tenantId);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0].edits).toBe(0);
  });

  it("finds nothing among genuinely different names", async () => {
    await supplier("Cape Fasteners");
    await supplier("Durban Diesel");
    expect(await lookalikeSuppliers(tenantId)).toHaveLength(0);
  });
});
