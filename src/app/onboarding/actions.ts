"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { NicheSkin } from "@prisma/client";
import { auth } from "@/auth";

export async function createTenantAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const name = String(formData.get("businessName") ?? "").trim();
  const niche = String(formData.get("niche") ?? "") as NicheSkin;
  const ownerPhone = String(formData.get("ownerPhone") ?? "").trim();

  if (!name || !niche) {
    throw new Error("Business name and niche are required.");
  }

  const tenant = await prisma.tenant.create({ data: { name, niche } });

  if (ownerPhone) {
    await prisma.user.update({ where: { id: session.user.id }, data: { phone: ownerPhone } });
  }

  // The signed-in user is the owner — no more trusting an email typed into
  // the form itself, which is what let anyone claim ownership of a
  // workspace before real auth existed.
  await prisma.membership.create({
    data: { userId: session.user.id, tenantId: tenant.id, role: "OWNER" },
  });

  redirect(`/dashboard/${tenant.id}`);
}
