// Putting somebody on, and taking them off.
//
// The property worth protecting is the one that has no route back: a
// workspace with no owner cannot be administered by anybody, and getting
// there takes one careless click. The rest is ordinary — one login across
// many businesses, and an invitation that fails to send says so rather than
// losing the membership it just created.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { inviteStaff, removeStaff, setStaffRole } from "../../src/lib/core/staff";

let tenantId: string;
let otherTenantId: string;
let ownerMembershipId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const owner = await prisma.user.create({ data: { email: `owner-${t.id}@example.test`, name: "Kagiso" } });
  const membership = await prisma.membership.create({ data: { tenantId, userId: owner.id, role: "OWNER" } });
  ownerMembershipId = membership.id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    const memberships = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
    await prisma.auditLog.deleteMany({ where: { tenantId: id } });
    await prisma.membership.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
    for (const m of memberships) {
      const left = await prisma.membership.count({ where: { userId: m.userId } });
      if (left === 0) await prisma.user.delete({ where: { id: m.userId } }).catch(() => {});
    }
  }
});

describe("inviting", () => {
  it("adds somebody, normalises the address, and records who did it", async () => {
    const result = await inviteStaff({ tenantId, email: "  Thabo@Example.TEST ", name: "Thabo", role: "DRIVER" });

    expect(result.email).toBe("thabo@example.test");
    expect(result.role).toBe("DRIVER");
    expect(result.alreadyHere).toBe(false);

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: result.membershipId } });
    expect(membership.tenantId).toBe(tenantId);
    expect(membership.role).toBe("DRIVER");

    const audit = await prisma.auditLog.findFirst({ where: { tenantId, targetId: result.membershipId } });
    expect(audit?.capability).toBe("staff:manage");
  });

  it("changes the role of somebody already here rather than adding them twice", async () => {
    const first = await inviteStaff({ tenantId, email: "thabo@example.test", role: "DRIVER" });
    const again = await inviteStaff({ tenantId, email: "thabo@example.test", role: "REP" });

    expect(again.membershipId).toBe(first.membershipId);
    expect(again.alreadyHere).toBe(true);
    expect(await prisma.membership.count({ where: { tenantId } })).toBe(2);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: first.membershipId } })).role).toBe("REP");
  });

  it("puts one login on two businesses rather than making a second account", async () => {
    const here = await inviteStaff({ tenantId, email: "thabo@example.test", role: "STAFF" });
    const there = await inviteStaff({ tenantId: otherTenantId, email: "thabo@example.test", role: "OWNER" });

    expect(there.userId).toBe(here.userId);
    expect(there.membershipId).not.toBe(here.membershipId);
  });

  it("refuses something that is not an address, and a role that does not exist", async () => {
    await expect(inviteStaff({ tenantId, email: "thabo" })).rejects.toThrow(/not an email address/i);
    // A role is a string now, because a workspace may define its own — so
    // this is no longer a compile error and the runtime check is what stops
    // it. That check is stronger than the old one: it asks whether THIS
    // workspace has such a role, not whether the product does.
    await expect(inviteStaff({ tenantId, email: "t@example.test", role: "ADMIN" })).rejects.toThrow(/no such role/i);
  });
});

describe("removing", () => {
  it("will not leave a workspace without an owner", async () => {
    await expect(removeStaff({ tenantId, membershipId: ownerMembershipId })).rejects.toThrow(/only owner/i);
    await expect(setStaffRole({ tenantId, membershipId: ownerMembershipId, role: "STAFF" })).rejects.toThrow(/only owner/i);

    // With a second owner, both are fine.
    await inviteStaff({ tenantId, email: "second@example.test", role: "OWNER" });
    await expect(setStaffRole({ tenantId, membershipId: ownerMembershipId, role: "STAFF" })).resolves.toBeTruthy();
  });

  it("removes somebody who is here, and refuses somebody who is not", async () => {
    const added = await inviteStaff({ tenantId, email: "thabo@example.test", role: "STAFF" });
    await expect(removeStaff({ tenantId: otherTenantId, membershipId: added.membershipId })).rejects.toThrow(
      /not on this workspace/i
    );

    await removeStaff({ tenantId, membershipId: added.membershipId });
    expect(await prisma.membership.count({ where: { tenantId } })).toBe(1);
  });
});
