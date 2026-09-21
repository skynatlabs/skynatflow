// Putting somebody on, and taking them off.
//
// This lived entirely inside the staff page's server action, which meant the
// one thing every growing business does — "add Thabo, he starts Monday" — was
// the one thing the agent could not do. Moving it here makes it a capability
// of the platform rather than of one screen: the page calls it, the agent
// calls it, and both go through the same checks.

import { prisma } from "@/lib/db";
import { sendEmail, staffInviteEmail } from "@/lib/email/client";
import { recordAudit } from "./audit";
import { ALL_ROLES, type Role } from "./access";

export interface InviteResult {
  membershipId: string;
  userId: string;
  email: string;
  role: string;
  /** False when nothing is configured to send mail — said, not hidden. */
  emailed: boolean;
  /** True when this person was already on the workspace and had their role changed. */
  alreadyHere: boolean;
}

export async function inviteStaff(params: {
  tenantId: string;
  email: string;
  name?: string | null;
  /** A built-in role name, or the key of one this workspace defined. */
  role?: string;
  /** Who did it, for the audit trail. */
  actorId?: string | null;
}): Promise<InviteResult> {
  const email = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That is not an email address.");

  const role = params.role ?? "STAFF";
  await assertAssignableRole(params.tenantId, role);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true } });

  // One login, many businesses: reuse the User row if this address already
  // has an account anywhere on the platform.
  const user = await prisma.user.upsert({
    where: { email },
    update: params.name?.trim() ? { name: params.name.trim() } : {},
    create: { email, name: params.name?.trim() || undefined },
  });

  const existing = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: params.tenantId } },
    select: { id: true },
  });

  const membership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: params.tenantId } },
    update: { role },
    create: { userId: user.id, tenantId: params.tenantId, role },
  });

  // A failure to send must not lose the membership that was just created —
  // the person is on the workspace either way, and the caller says so.
  let emailed = false;
  try {
    const { subject, html } = staffInviteEmail({ tenantName: tenant.name, role });
    await sendEmail({ to: email, subject, html });
    emailed = true;
  } catch (err) {
    console.error(`[staff] invite email to ${email} failed:`, err);
  }

  await recordAudit({
    tenantId: params.tenantId,
    actorType: "user",
    actorId: params.actorId ?? undefined,
    capability: "staff:manage",
    targetType: "Membership",
    targetId: membership.id,
    metadata: { invitedEmail: email, role, emailed },
  });

  return { membershipId: membership.id, userId: user.id, email, role, emailed, alreadyHere: Boolean(existing) };
}

export async function removeStaff(params: { tenantId: string; membershipId: string; actorId?: string | null }) {
  const membership = await prisma.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    select: { id: true, role: true, userId: true },
  });
  if (!membership) throw new Error("That person is not on this workspace.");

  // A workspace with no owner cannot be administered by anybody, and there is
  // no route back from it short of a database edit.
  if (membership.role === "OWNER") {
    const owners = await prisma.membership.count({ where: { tenantId: params.tenantId, role: "OWNER" } });
    if (owners <= 1) throw new Error("This is the only owner. Make somebody else an owner first.");
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  await recordAudit({
    tenantId: params.tenantId,
    actorType: "user",
    actorId: params.actorId ?? undefined,
    capability: "staff:manage",
    targetType: "Membership",
    targetId: membership.id,
    metadata: { removedUserId: membership.userId, role: membership.role },
  });
  return { removed: true };
}

/**
 * A role this workspace can actually assign.
 *
 * Either one of the built-in five, or a role the workspace defined for
 * itself. Checked against the database rather than against a list in code,
 * because the workspace's own roles are not knowable here otherwise — and
 * assigning a role that does not exist would resolve to no capabilities at
 * all, which looks exactly like a bug.
 */
async function assertAssignableRole(tenantId: string, role: string): Promise<void> {
  if (ALL_ROLES.includes(role as Role)) return;
  const custom = await prisma.tenantRole.findUnique({
    where: { tenantId_key: { tenantId, key: role } },
    select: { id: true },
  });
  if (!custom) throw new Error("There is no such role.");
}

export async function setStaffRole(params: { tenantId: string; membershipId: string; role: string; actorId?: string | null }) {
  await assertAssignableRole(params.tenantId, params.role);
  const membership = await prisma.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    select: { id: true, role: true },
  });
  if (!membership) throw new Error("That person is not on this workspace.");

  if (membership.role === "OWNER" && params.role !== "OWNER") {
    const owners = await prisma.membership.count({ where: { tenantId: params.tenantId, role: "OWNER" } });
    if (owners <= 1) throw new Error("This is the only owner. Make somebody else an owner first.");
  }

  const updated = await prisma.membership.update({ where: { id: membership.id }, data: { role: params.role } });
  await recordAudit({
    tenantId: params.tenantId,
    actorType: "user",
    actorId: params.actorId ?? undefined,
    capability: "staff:manage",
    targetType: "Membership",
    targetId: membership.id,
    metadata: { was: membership.role, now: params.role },
  });
  return updated;
}
