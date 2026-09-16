// The engine under what they already run.
//
// The property that matters here is honesty: the switchover figure is the
// whole mechanism for persuading a business to move, and a figure that
// flatters is worse than none. So the tests check that it goes up only when
// real data lands, that every gap names a real consequence, and that the
// catalogue never claims a connection this codebase does not have.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  SYSTEM_CATALOGUE,
  addSystem,
  listSystems,
  recordImport,
  removeSystem,
  retireSystem,
  switchover,
} from "../../src/lib/core/systems";

let tenantId: string;
let otherTenantId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Corner Shop", niche: "RETAIL", currency: "ZAR" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "SERVICES" } });
  otherTenantId = other.id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.connectedSystem.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id, parentId: { not: null } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.item.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("the catalogue", () => {
  it("never claims a live connection that this codebase does not have", () => {
    // An integrations page that lies is worse than no integrations page. Only
    // the two providers with a connector in src/lib may say "live".
    const live = SYSTEM_CATALOGUE.filter((s) => s.links.includes("live")).map((s) => s.key);
    expect(live.sort()).toEqual(["woocommerce", "yoco"]);
  });

  it("tells somebody where the export actually is, not to go and find it", () => {
    for (const system of SYSTEM_CATALOGUE) {
      expect(system.exportPath, `${system.key} has no export path`).toBeTruthy();
      // "Export your data" is not instructions; a real path names a screen.
      expect(system.exportPath!.length).toBeGreaterThan(20);
      expect(system.what.length).toBeGreaterThan(10);
    }
  });
});

describe("what they run", () => {
  it("records a system, updates it rather than duplicating, and keeps it after they move off", async () => {
    await addSystem({ tenantId, systemKey: "loyverse", notes: "the front till" });
    await addSystem({ tenantId, systemKey: "loyverse", notes: "both tills" });

    let mine = await listSystems(tenantId);
    expect(mine).toHaveLength(1);
    expect(mine[0].notes).toBe("both tills");
    expect(mine[0].category).toBe("till");
    expect(mine[0].def.label).toBe("Loyverse");

    await recordImport(tenantId, "loyverse", 240);
    await recordImport(tenantId, "loyverse", 60);
    mine = await listSystems(tenantId);
    expect(mine[0].importedRecords).toBe(300);
    expect(mine[0].lastImportAt).toBeInstanceOf(Date);

    await retireSystem(tenantId, "loyverse");
    mine = await listSystems(tenantId);
    // Kept, dated. What somebody moved off and when is worth more than a
    // tidy list.
    expect(mine).toHaveLength(1);
    expect(mine[0].retiredAt).toBeInstanceOf(Date);
    expect(mine[0].isSystemOfRecord).toBe(false);
  });

  it("wants a name for something not in the catalogue, and refuses a system it has never heard of", async () => {
    await expect(addSystem({ tenantId, systemKey: "other" })).rejects.toThrow(/what is it called/i);
    await expect(addSystem({ tenantId, systemKey: "definitely-not-a-thing" })).rejects.toThrow(/not one of the systems/i);
    const row = await addSystem({ tenantId, systemKey: "other", label: "Kazang" });
    expect(row.label).toBe("Kazang");
  });

  it("will not touch another workspace's list", async () => {
    await addSystem({ tenantId, systemKey: "xero" });
    expect(await listSystems(otherTenantId)).toHaveLength(0);
    await expect(retireSystem(otherTenantId, "xero")).rejects.toThrow(/not on this workspace/i);
    await expect(removeSystem(otherTenantId, "xero")).rejects.toThrow(/not on this workspace/i);
  });
});

describe("the switchover figure", () => {
  it("starts at nothing on an empty workspace, and every gap says what is actually broken", async () => {
    const move = await switchover(tenantId);
    expect(move.percent).toBe(0);
    expect(move.onFlow).toEqual([]);
    expect(move.gaps.length).toBeGreaterThan(5);
    for (const gap of move.gaps) {
      // A consequence the owner feels, not a missing table.
      expect(gap.missing.length).toBeGreaterThan(20);
      expect(gap.needs.length).toBeGreaterThan(5);
    }
  });

  it("goes up only when real data lands", async () => {
    const before = await switchover(tenantId);

    const party = await prisma.party.create({ data: { tenantId, name: "Jabu", role: "CUSTOMER" } });
    await prisma.item.create({ data: { tenantId, name: "Pallet wrap", unitPriceCents: 18_900, costCents: 12_000 } });
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId: party.id, type: "INVOICE", status: "SENT", amountCents: 50_000 },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId: party.id, type: "PAYMENT", status: "PAID", amountCents: 50_000, parentId: invoice.id },
    });

    const after = await switchover(tenantId);
    expect(after.percent).toBeGreaterThan(before.percent);
    expect(after.onFlow).toContain("Your customers are here.");
    expect(after.onFlow).toContain("Your price list is here.");
    expect(after.onFlow).toContain("Payments are recorded against the invoices.");
    expect(after.onFlow).toContain("Your costs are on your items, so margin is real.");
    // And it does not claim the ones that are genuinely still missing.
    expect(after.gaps.map((g) => g.key)).toContain("expenses");
  });

  it("names the system that is holding what is missing", async () => {
    await addSystem({ tenantId, systemKey: "sage", isSystemOfRecord: true });
    const move = await switchover(tenantId);

    const customers = move.gaps.find((g) => g.key === "customers");
    expect(customers?.heldBy).toBe("Sage Business Cloud / Pastel");
    expect(move.stillElsewhere.map((s) => s.key)).toEqual(["sage"]);

    // Once they say the records live here, it stops being named as the holder.
    await retireSystem(tenantId, "sage");
    const later = await switchover(tenantId);
    expect(later.gaps.find((g) => g.key === "customers")?.heldBy).toBeUndefined();
    expect(later.stillElsewhere).toEqual([]);
    expect(later.movedOff.map((m) => m.label)).toEqual(["Sage Business Cloud / Pastel"]);
  });
});
