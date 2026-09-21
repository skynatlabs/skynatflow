// Roles a workspace defines for itself.
//
// The property that matters most is the one that is easy to forget: defining
// a role must not be a way to acquire authority you did not have. Everything
// else here is about not letting a workspace lock itself out.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  RoleError,
  deleteWorkspaceRole,
  listWorkspaceRoles,
  roleKeyFrom,
  saveWorkspaceRole,
} from "../../src/lib/core/roles";
import { capabilitiesOfBuiltIn, resolveCapabilities } from "../../src/lib/core/access";

let tenantId: string;
let userId: string;

const owner = () => ({
  userId,
  role: "OWNER",
  capabilities: capabilitiesOfBuiltIn("OWNER"),
});

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Roles Test Co" } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: { email: `roles-${Date.now()}@example.com`, name: "Roles Tester" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.tenantRole.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("naming", () => {
  it("makes a stable key out of a name somebody typed", () => {
    expect(roleKeyFrom("  Compliance Officer ")).toBe("compliance-officer");
    expect(roleKeyFrom("Book-keeper (part time)")).toBe("book-keeper-part-time");
  });

  it("refuses to shadow a built-in role", async () => {
    await expect(
      saveWorkspaceRole({ tenantId, author: owner(), name: "Owner", capabilities: [] })
    ).rejects.toBeInstanceOf(RoleError);
  });
});

describe("defining a role", () => {
  it("creates one and resolves what it may do", async () => {
    const role = await saveWorkspaceRole({
      tenantId,
      author: owner(),
      name: "Bookkeeper",
      capabilities: ["invoice:create", "payment:record"],
    });

    expect(role.key).toBe("bookkeeper");
    expect(resolveCapabilities("bookkeeper", role)).toEqual(["invoice:create", "payment:record"]);
  });

  it("never lets somebody grant what they cannot do themselves", async () => {
    // A rep can quote. A rep cannot manage staff — so a rep must not be able
    // to define a role that can, which would be an escalation with extra
    // steps.
    const rep = { userId, role: "REP", capabilities: capabilitiesOfBuiltIn("REP") };
    await expect(
      saveWorkspaceRole({
        tenantId,
        author: rep,
        name: "Sneaky Admin",
        capabilities: ["staff:manage"],
      })
    ).rejects.toThrow(/can't give a role something you can't do yourself/i);
  });

  it("drops a capability the product no longer has, rather than refusing", async () => {
    // Removing a capability from the product must not break every workspace
    // that had granted it.
    const role = await saveWorkspaceRole({
      tenantId,
      author: owner(),
      name: "Legacy",
      capabilities: ["invoice:create", "teleport:everywhere"],
    });
    expect(role.capabilities).toEqual(["invoice:create"]);
  });

  it("edits in place rather than making a second role", async () => {
    await saveWorkspaceRole({ tenantId, author: owner(), name: "Auditor", capabilities: [] });
    await saveWorkspaceRole({
      tenantId,
      author: owner(),
      key: "auditor",
      name: "Auditor",
      capabilities: ["task:manage"],
    });

    const roles = await listWorkspaceRoles(tenantId);
    const auditors = roles.filter((r) => r.key === "auditor");
    expect(auditors).toHaveLength(1);
    expect(auditors[0].capabilities).toEqual(["task:manage"]);
  });

  it("records who defined it", async () => {
    await saveWorkspaceRole({ tenantId, author: owner(), name: "Dispatcher", capabilities: ["delivery:log"] });
    const entries = await prisma.auditLog.findMany({
      where: { tenantId, targetType: "TenantRole" },
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].actorId).toBe(userId);
  });
});

describe("resolving", () => {
  it("gives an unknown role nothing, never everything", () => {
    // The failure direction matters: a role we cannot resolve must close, not
    // open.
    expect(resolveCapabilities("not-a-role", null)).toEqual([]);
    expect(resolveCapabilities("bookkeeper", { key: "different", capabilities: ["staff:manage"] })).toEqual([]);
  });

  it("still resolves the built-in roles", () => {
    expect(resolveCapabilities("OWNER", null)).toEqual(capabilitiesOfBuiltIn("OWNER"));
    expect(resolveCapabilities("DRIVER", null)).toEqual(capabilitiesOfBuiltIn("DRIVER"));
  });
});

describe("removing a role", () => {
  it("refuses while somebody still holds it", async () => {
    await saveWorkspaceRole({ tenantId, author: owner(), name: "Occupied", capabilities: [] });
    await prisma.membership.create({ data: { tenantId, userId, role: "occupied" } });

    await expect(
      deleteWorkspaceRole({ tenantId, key: "occupied", author: { userId } })
    ).rejects.toThrow(/move them to another one first/i);

    await prisma.membership.deleteMany({ where: { tenantId, role: "occupied" } });
    await deleteWorkspaceRole({ tenantId, key: "occupied", author: { userId } });
    const roles = await listWorkspaceRoles(tenantId);
    expect(roles.find((r) => r.key === "occupied")).toBeUndefined();
  });

  it("is quiet about a role that is already gone", async () => {
    await expect(
      deleteWorkspaceRole({ tenantId, key: "never-existed", author: { userId } })
    ).resolves.toBeUndefined();
  });
});
