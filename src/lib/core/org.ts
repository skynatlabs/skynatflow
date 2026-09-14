// Org hierarchy — reporting lines on top of the per-staff Membership
// accounts that already existed (each staff member already gets their own
// login; this just adds who reports to whom).

import { prisma } from "@/lib/db";

// Both the person being edited AND their new manager have to be real
// memberships on THIS tenant. Without this, a form post carrying any
// membership id rewrote the reporting line of a staff member in someone
// else's company — the caller only ever proved access to its own tenant.
// tenantId is appended rather than prepended on purpose: both params are
// strings, so a missed call site fails to compile instead of silently
// swapping two arguments.
async function requireOwnedMembership(membershipId: string, tenantId: string) {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.tenantId !== tenantId) throw new Error("Staff member not found.");
  return membership;
}

export async function setManager(
  membershipId: string,
  managerId: string | null,
  tenantId: string
) {
  if (managerId === membershipId) throw new Error("A person can't manage themselves.");
  await requireOwnedMembership(membershipId, tenantId);
  if (managerId) {
    await requireOwnedMembership(managerId, tenantId);
    await assertNoReportingCycle(membershipId, managerId, tenantId);
  }
  return prisma.membership.update({ where: { id: membershipId }, data: { managerId } });
}

// Walks up the proposed manager's chain. Without this, A->B plus B->A was
// accepted, and getOrgChart then dropped both of them: neither is a root
// (each has a manager that exists), so the cycle rendered as nobody at
// all rather than as an error at the point the loop was created.
async function assertNoReportingCycle(membershipId: string, managerId: string, tenantId: string) {
  const members = await prisma.membership.findMany({
    where: { tenantId },
    select: { id: true, managerId: true },
  });
  const managerOf = new Map(members.map((m) => [m.id, m.managerId]));
  let cursor: string | null = managerId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === membershipId) {
      throw new Error("That would create a reporting loop.");
    }
    if (seen.has(cursor)) break; // pre-existing loop elsewhere; don't hang
    seen.add(cursor);
    cursor = managerOf.get(cursor) ?? null;
  }
}

export async function setDepartment(
  membershipId: string,
  department: string | null,
  tenantId: string
) {
  await requireOwnedMembership(membershipId, tenantId);
  return prisma.membership.update({ where: { id: membershipId }, data: { department } });
}

export interface OrgNode {
  membershipId: string;
  name: string;
  role: string;
  department: string | null;
  reports: OrgNode[];
}

// Builds the reporting tree from Membership.managerId — top-level nodes
// are anyone with no manager set (typically the OWNER, but any unmanaged
// person shows at the top rather than being silently dropped).
export async function getOrgChart(tenantId: string): Promise<OrgNode[]> {
  const members = await prisma.membership.findMany({
    where: { tenantId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  const nodeById = new Map<string, OrgNode>();
  for (const m of members) {
    nodeById.set(m.id, {
      membershipId: m.id,
      name: m.user.name ?? m.user.email,
      role: m.role,
      department: m.department,
      reports: [],
    });
  }

  const roots: OrgNode[] = [];
  for (const m of members) {
    const node = nodeById.get(m.id)!;
    if (m.managerId && nodeById.has(m.managerId)) {
      nodeById.get(m.managerId)!.reports.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
