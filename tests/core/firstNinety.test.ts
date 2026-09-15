// Find, the arrival, the first audit and the thirty-day check-in.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { find, looksLikeAsking } from "../../src/lib/core/find";
import { runArrival, firstAudit, ninetyDayCheckIn, markArrivalShown } from "../../src/lib/agent/arrival";

let tenantId: string;
let userId: string;
const DAY = 86_400_000;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Arrival Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `arr-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.aiDraft.deleteMany({ where: { tenantId } });
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("find", () => {
  it("tells a name from a question", () => {
    expect(looksLikeAsking("who owes us the most?")).toBe(true);
    expect(looksLikeAsking("chase Acme")).toBe(true);
    expect(looksLikeAsking("Acme")).toBe(false);
  });

  it("finds a customer and their documents by name, and a page by what it is for", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Findable Holdings", role: "CUSTOMER" } });
    await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "INVOICE", status: "SENT", amountCents: 1_000_00, subject: "Borehole pump" } });
    const byName = await find(tenantId, "Findable");
    expect(byName.some((r) => r.kind === "customer" && r.href.endsWith(p.id))).toBe(true);
    expect(byName.some((r) => r.kind === "invoice")).toBe(true);
    const bySubject = await find(tenantId, "borehole");
    expect(bySubject[0].kind).toBe("invoice");
    const page = await find(tenantId, "subscriptions");
    expect(page.some((r) => r.kind === "page" && r.href.endsWith("/savings"))).toBe(true);
  });

  it("stays inside the workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    await prisma.party.create({ data: { tenantId: other.id, name: "Findable Elsewhere", role: "CUSTOMER" } });
    expect((await find(tenantId, "Elsewhere")).filter((r) => r.kind !== "page")).toEqual([]);
    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("the arrival", () => {
  it("gives six introductions, each with a finding or what it needs", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Late Payer", role: "CUSTOMER" } });
    await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "INVOICE", status: "OVERDUE", amountCents: 20_000_00, dueAt: new Date(Date.now() - 30 * DAY) } });
    const intros = await runArrival(tenantId);
    expect(intros.map((i) => i.officer).sort()).toEqual(["CEO", "CFO", "COO", "EFFICIENCY", "LEGAL", "SALES"]);
    const cfo = intros.find((i) => i.officer === "CFO")!;
    expect(cfo.finding?.headline).toContain("Late Payer");
    const legal = intros.find((i) => i.officer === "LEGAL")!;
    expect(legal.finding === null ? legal.needs : legal.finding.headline).toBeTruthy();
    await markArrivalShown(tenantId);
    expect((await prisma.tenant.findUnique({ where: { id: tenantId } }))!.arrivalShownAt).not.toBeNull();
  });
});

describe("the first audit", () => {
  it("reads all five areas and says what it needs where it has too little", async () => {
    const audit = await firstAudit(tenantId);
    expect(audit.sections.map((s) => s.key)).toEqual(["leakage", "uncosted", "compliance", "contracts", "held"]);
    expect(audit.sections.find((s) => s.key === "compliance")!.summary).toContain("No compliance calendar");
    expect((await prisma.tenant.findUnique({ where: { id: tenantId } }))!.firstAuditAt).not.toBeNull();
  });
});

describe("ninety days, measured", () => {
  it("speaks once at day thirty and not again that week", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });
    expect(await ninetyDayCheckIn(tenantId)).toBe(30);
    expect(await ninetyDayCheckIn(tenantId)).toBeNull();
    const n = await prisma.notification.findFirst({ where: { tenantId } });
    expect(n!.title).toContain("Day 30");
  });

  it("is silent between milestones", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { createdAt: new Date(Date.now() - 45 * DAY) } });
    expect(await ninetyDayCheckIn(tenantId)).toBeNull();
  });
});
