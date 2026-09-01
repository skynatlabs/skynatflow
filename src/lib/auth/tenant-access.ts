// The actual enforcement point: given the current session, can this person
// see/act on this tenant, and with what role? Every tenant-scoped
// layout/action should call this instead of trusting the URL's tenantId.

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/core/access";

export interface TenantAccess {
  userId: string;
  role: Role;
  membershipId: string | null; // null when access is via isSuperAdmin, not a real membership
}

export async function requireTenantAccess(tenantId: string): Promise<TenantAccess> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthRequiredError();
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw new AuthRequiredError();

  // isSuperAdmin is the /car (platform control) gate ONLY — it must never
  // imply blanket access to a tenant's actual business data. A platform
  // admin needs a real Membership on a tenant, same as anyone else, to
  // open that tenant's dashboard.
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
  });
  if (!membership) throw new ForbiddenError();

  return { userId: user.id, role: membership.role as Role, membershipId: membership.id };
}

export interface SuperAdminAccess {
  userId: string;
}

// Guard for platform-global surfaces (the marketing site CMS) that aren't
// scoped to any one tenant — distinct from requireTenantAccess, which
// always resolves against a specific tenantId.
export async function requireSuperAdmin(): Promise<SuperAdminAccess> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthRequiredError();
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.isSuperAdmin) throw new ForbiddenError();

  return { userId: user.id };
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Sign-in required");
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Not a member of this workspace");
    this.name = "ForbiddenError";
  }
}
