"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { sendEmail, staffInviteEmail } from "@/lib/email/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function inviteStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "STAFF");

  if (!email) {
    throw new Error("Email is required.");
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Same one-login-many-businesses pattern as onboarding: reuse the User
  // row if this email already has an account anywhere on the platform.
  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name: name || undefined },
  });

  const membership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role },
    create: { userId: user.id, tenantId, role },
  });

  const { subject, html } = staffInviteEmail({ tenantName: tenant.name, role });
  await sendEmail({ to: email, subject, html });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Membership",
    targetId: membership.id,
    metadata: { invitedEmail: email, role },
  });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}

export async function removeStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.tenantId !== tenantId) throw new Error("Staff member not found.");
  await prisma.membership.delete({ where: { id: membershipId } });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Membership",
    targetId: membershipId,
    metadata: { action: "removed" },
  });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}
