// Org hierarchy — reporting lines on top of the per-staff Membership
// accounts that already existed (each staff member already gets their own
// login; this just adds who reports to whom).

import { prisma } from "@/lib/db";

export async function setManager(membershipId: string, managerId: string | null) {
  if (managerId === membershipId) throw new Error("A person can't manage themselves.");
  return prisma.membership.update({ where: { id: membershipId }, data: { managerId } });
}

export async function setDepartment(membershipId: string, department: string | null) {
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
