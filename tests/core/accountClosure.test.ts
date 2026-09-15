// Closing an account.
//
// Three properties, and all three are the kind that only matter on the day
// somebody uses them: it takes a deliberate confirmation rather than a
// misclick, the owner can change their mind for a week, and when it finally
// runs it leaves nothing behind — including tables added long after this was
// written.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { readZip } from "../../src/lib/import/zip";
import {
  cancelClosure,
  closureState,
  GRACE_DAYS,
  purgeDueTenants,
  purgeTenant,
  recordsArchive,
  requestClosure,
} from "../../src/lib/core/accountClosure";

let tenantId: string;
let userId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Leaving Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const user = await prisma.user.create({ data: { email: `leaving-${tenant.id}@test.local`, name: "Owner" } });
  userId = user.id;
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });

  const party = await prisma.party.create({ data: { tenantId, name: "Jabu Traders", role: "CUSTOMER" } });
  const item = await prisma.item.create({ data: { tenantId, name: "Callout", unitPriceCents: 85_000 } });
  const invoice = await prisma.transaction.create({
    data: { tenantId, partyId: party.id, type: "INVOICE", status: "SENT", amountCents: 85_000 },
  });
  await prisma.transactionLine.create({
    data: { transactionId: invoice.id, itemId: item.id, quantity: 1, unitPriceCents: 85_000 },
  });
  await prisma.intakeDocument.create({
    data: { tenantId, fileName: "cipc.pdf", mediaType: "application/pdf", kind: "company_registration", reading: {} },
  });
});

afterEach(async () => {
  // Most cases purge the workspace themselves; this clears the ones that did not.
  if (await prisma.tenant.count({ where: { id: tenantId } })) await purgeTenant(tenantId);
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("closing an account", () => {
  it("will not close on a misclick — the business name has to be typed", async () => {
    await expect(requestClosure(tenantId, userId, "leaving")).rejects.toThrow(/type the business name/i);
    await expect(requestClosure(tenantId, userId, "")).rejects.toThrow();
    expect((await closureState(tenantId)).requestedAt).toBeNull();

    // Case and stray spaces are not the point of the check.
    const state = await requestClosure(tenantId, userId, "  leaving co  ");
    expect(state.requestedAt).not.toBeNull();
    expect(state.deletesOn!.getTime() - state.requestedAt!.getTime()).toBe(GRACE_DAYS * 86_400_000);
  });

  it("gives a week to change their mind, and nothing is touched in it", async () => {
    await requestClosure(tenantId, userId, "Leaving Co");
    const stillDue = await purgeDueTenants(new Date());
    expect(stillDue).toEqual([]);
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(1);

    await cancelClosure(tenantId);
    expect((await closureState(tenantId)).requestedAt).toBeNull();

    // Even well past the week, a cancelled closure never runs.
    const later = new Date(Date.now() + 30 * 86_400_000);
    expect(await purgeDueTenants(later)).toEqual([]);
    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
  });

  it("hands over a copy of the records that a spreadsheet can open", async () => {
    const { fileName, data } = await recordsArchive(tenantId);
    expect(fileName).toMatch(/^leaving-co-records-\d{4}-\d{2}-\d{2}\.zip$/);

    const files = readZip(data);
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    expect(manifest.businessName).toBe("Leaving Co");
    expect(manifest.totalRows).toBeGreaterThan(0);
    // The tables a person actually opens are CSV, with a header row.
    const csv = files.get("csv/transactions.csv")!.toString("utf8");
    expect(csv.split("\r\n")[0]).toContain("amountCents");
    expect(csv).toContain("85000");
    // And everything is there in full underneath.
    expect(JSON.parse(files.get("json/parties.json")!.toString("utf8"))).toHaveLength(1);
    expect(files.get("README.txt")!.toString("utf8")).toContain("Leaving Co");
  });

  it("leaves nothing behind when the week is up", async () => {
    await requestClosure(tenantId, userId, "Leaving Co");
    const done = await purgeDueTenants(new Date(Date.now() + (GRACE_DAYS + 1) * 86_400_000));
    expect(done.map((d) => d.name)).toContain("Leaving Co");

    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
    for (const count of [
      prisma.transaction.count({ where: { tenantId } }),
      prisma.transactionLine.count({ where: { transaction: { tenantId } } }),
      prisma.party.count({ where: { tenantId } }),
      prisma.item.count({ where: { tenantId } }),
      prisma.membership.count({ where: { tenantId } }),
      prisma.intakeDocument.count({ where: { tenantId } }),
    ]) {
      expect(await count).toBe(0);
    }
    // The person's own login is theirs, not the business's.
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
  });

  it("clears every table that carries a tenant id, including ones added later", async () => {
    // Read off the schema rather than a list here, so a model added tomorrow
    // is covered by this test the day it appears.
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenantId' AND table_name <> 'tenants'`;
    expect(tables.length).toBeGreaterThan(30);

    await purgeTenant(tenantId);

    for (const { table_name } of tables) {
      const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "${table_name}" WHERE "tenantId" = $1`,
        tenantId
      );
      expect(Number(count), `${table_name} still holds rows for a closed account`).toBe(0);
    }
  });
});
