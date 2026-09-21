// The actual enforcement point: given the current session, can this person
// see/act on this tenant, and with what role? Every tenant-scoped
// layout/action should call this instead of trusting the URL's tenantId.

import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isBuiltInRole, resolveCapabilities, type Capability } from "@/lib/core/access";

export interface TenantAccess {
  userId: string;
  /**
   * A built-in role name, or the key of a role this workspace defined.
   *
   * Kept as a string rather than the Role union because a workspace may
   * invent its own, and the name alone no longer decides anything — see
   * `capabilities`, which is what every check should consult.
   */
  role: string;
  /** Already resolved. This, not the role name, is what may be done. */
  capabilities: Capability[];
  membershipId: string | null; // null when access is via isSuperAdmin, not a real membership
}

/**
 * Wrapped in React's cache: a dashboard layout and its page render in
 * parallel and both ask, and within one render they now share one answer
 * rather than reading the session and the membership twice. Outside a render
 * — a server action, a route handler — cache passes straight through, so
 * every call there still checks for itself.
 */
export const requireTenantAccess = cache(async (tenantId: string): Promise<TenantAccess> => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthRequiredError();
  }
  const userId = session.user.id;

  // isSuperAdmin is the /car (platform control) gate ONLY — it must never
  // imply blanket access to a tenant's actual business data. A platform
  // admin needs a real Membership on a tenant, same as anyone else, to
  // open that tenant's dashboard.
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId } } }),
  ]);
  if (!user) throw new AuthRequiredError();
  if (!membership) throw new ForbiddenError();

  // A workspace may define its own roles. The stored value is a built-in name
  // or one of those keys, and the lookup only happens when it is not a
  // built-in — so the common path stays two queries, not three.
  const custom = isBuiltInRole(membership.role)
    ? null
    : await prisma.tenantRole.findUnique({
        where: { tenantId_key: { tenantId, key: membership.role } },
        select: { key: true, capabilities: true },
      });

  return {
    userId: user.id,
    role: membership.role,
    capabilities: resolveCapabilities(membership.role, custom),
    membershipId: membership.id,
  };
});

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
