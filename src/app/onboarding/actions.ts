"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { NicheSkin } from "@prisma/client";
import { auth } from "@/auth";
import { createProduct } from "@/lib/core/catalog";

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

  // Catalog items suggested by the onboarding "paste your website" prefill
  // — no price known yet, so they land as free-form drafts (owner sets a
  // real price on their first quote) rather than blocking on it here.
  const catalogItemsJson = String(formData.get("catalogItemsJson") ?? "");
  if (catalogItemsJson) {
    try {
      const items: { name: string }[] = JSON.parse(catalogItemsJson);
      for (const item of items.slice(0, 5)) {
        if (item.name) {
          await createProduct({ tenantId: tenant.id, name: item.name, unitPriceCents: 0 });
        }
      }
    } catch {
      // Malformed hint — not worth failing onboarding over.
    }
  }

  redirect(`/dashboard/${tenant.id}`);
}
