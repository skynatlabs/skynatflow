// Roles a workspace defines for itself.
//
// The five built-in roles cover a plumber with three staff. They do not cover
// a company with a compliance officer who may see everything and change
// nothing, or a bookkeeper who touches money but never customers. "Which
// roles can I define" is a question enterprise buyers ask before almost
// anything else, and the honest answer used to be "the five we chose".
//
// Two rules hold this together:
//
//   A CUSTOM ROLE CAN NEVER EXCEED ITS AUTHOR. Somebody who cannot manage
//   staff cannot mint a role that can. Otherwise defining a role is a
//   privilege escalation with extra steps.
//
//   A BUILT-IN NAME IS NEVER SHADOWED. "OWNER" always means the built-in
//   owner; a workspace cannot redefine it into something weaker and lock
//   itself out, or into something stronger and grant itself more.

import { prisma } from "@/lib/db";
import {
  ALL_CAPABILITIES,
  isBuiltInRole,
  type Capability,
  type CapabilityHolder,
} from "./access";
import { recordAudit } from "./audit";

export interface WorkspaceRole {
  id: string;
  key: string;
  name: string;
  capabilities: Capability[];
  /** How many people currently hold it. */
  members: number;
}

/** Lowercase, hyphenated, and never a built-in name. */
export function roleKeyFrom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function listWorkspaceRoles(tenantId: string): Promise<WorkspaceRole[]> {
  const roles = await prisma.tenantRole.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  });

  const counts = await prisma.membership.groupBy({
    by: ["role"],
    where: { tenantId },
    _count: { _all: true },
  });
  const byRole = new Map(counts.map((c) => [c.role, c._count._all]));

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    capabilities: role.capabilities.filter((c): c is Capability =>
      ALL_CAPABILITIES.includes(c as Capability)
    ),
    members: byRole.get(role.key) ?? 0,
  }));
}

export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleError";
  }
}

/**
 * Define or redefine a role.
 *
 * `author` is whoever is doing it, already resolved. Every capability being
 * granted is checked against what the author themselves holds — a person
 * cannot hand out an authority they do not have.
 */
export async function saveWorkspaceRole(params: {
  tenantId: string;
  author: CapabilityHolder & { userId: string };
  name: string;
  capabilities: string[];
  /** Set when editing; omitted when creating. */
  key?: string;
}): Promise<WorkspaceRole> {
  const name = params.name.trim();
  if (name.length < 2) throw new RoleError("Give the role a name.");

  const key = params.key ?? roleKeyFrom(name);
  if (!key) throw new RoleError("That name has no letters or numbers in it.");
  if (isBuiltInRole(key.toUpperCase())) {
    throw new RoleError("That is one of the built-in roles. Pick another name.");
  }

  const wanted = params.capabilities.filter((c): c is Capability =>
    ALL_CAPABILITIES.includes(c as Capability)
  );

  // No minting authority you do not hold.
  const beyond = wanted.filter((c) => !params.author.capabilities.includes(c));
  if (beyond.length > 0) {
    throw new RoleError(
      `You can't give a role something you can't do yourself: ${beyond.join(", ")}.`
    );
  }

  const saved = await prisma.tenantRole.upsert({
    where: { tenantId_key: { tenantId: params.tenantId, key } },
    create: { tenantId: params.tenantId, key, name, capabilities: wanted },
    update: { name, capabilities: wanted },
  });

  await recordAudit({
    tenantId: params.tenantId,
    actorType: "user",
    actorId: params.author.userId,
    capability: "staff:manage",
    targetType: "TenantRole",
    targetId: saved.id,
    metadata: { key, name, capabilities: wanted },
  });

  return { id: saved.id, key: saved.key, name: saved.name, capabilities: wanted, members: 0 };
}

/**
 * Remove a role.
 *
 * Refused while anybody still holds it. Deleting it out from under them would
 * silently resolve every one of those people to no capabilities at all, which
 * looks exactly like a bug and arrives as a support call on a Monday.
 */
export async function deleteWorkspaceRole(params: {
  tenantId: string;
  key: string;
  author: { userId: string };
}): Promise<void> {
  const holders = await prisma.membership.count({
    where: { tenantId: params.tenantId, role: params.key },
  });
  if (holders > 0) {
    throw new RoleError(
      `${holders} ${holders === 1 ? "person is" : "people are"} on this role. Move them to another one first.`
    );
  }

  const role = await prisma.tenantRole.findUnique({
    where: { tenantId_key: { tenantId: params.tenantId, key: params.key } },
  });
  if (!role) return;

  await prisma.tenantRole.delete({ where: { id: role.id } });
  await recordAudit({
    tenantId: params.tenantId,
    actorType: "user",
    actorId: params.author.userId,
    capability: "staff:manage",
    targetType: "TenantRole",
    targetId: role.id,
    metadata: { deleted: role.key },
  });
}
