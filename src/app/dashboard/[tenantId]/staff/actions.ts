"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { sendEmail, staffInviteEmail } from "@/lib/email/client";

export async function inviteStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "STAFF");

  if (!tenantId || !email) {
    throw new Error("tenantId and email are required.");
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Same one-login-many-businesses pattern as onboarding: reuse the User
  // row if this email already has an account anywhere on the platform.
  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name: name || undefined },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role },
    create: { userId: user.id, tenantId, role },
  });

  const { subject, html } = staffInviteEmail({ tenantName: tenant.name, role });
  await sendEmail({ to: email, subject, html });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}

export async function removeStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  await prisma.membership.delete({ where: { id: membershipId } });
  revalidatePath(`/dashboard/${tenantId}/staff`);
}
