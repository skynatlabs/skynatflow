"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { allowedHostsFrom } from "@/lib/core/embeds";
import { claimDomain, setBranding } from "@/lib/core/whiteLabel";

async function ownerOnly(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // What a customer sees on every document the business sends is not a
  // preference a member of staff changes on a Tuesday afternoon.
  if (!can(access, "staff:manage")) throw new Error("Only an owner can change what customers see.");
}

export async function saveBrandingAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await ownerOnly(tenantId);

  await setBranding(tenantId, {
    logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
    accent: String(formData.get("accent") ?? "").trim() || null,
    hidePlatformBranding: formData.get("hidePlatformBranding") === "on",
  });

  revalidatePath(`/dashboard/${tenantId}/settings/brand`);
}

export async function saveDomainAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await ownerOnly(tenantId);

  await claimDomain(tenantId, String(formData.get("domain") ?? "").trim() || null);
  revalidatePath(`/dashboard/${tenantId}/settings/brand`);
}

export async function saveEmbedHostsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await ownerOnly(tenantId);

  const hosts = allowedHostsFrom(String(formData.get("hosts") ?? ""));
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { embedAllowedHosts: hosts.length > 0 ? hosts.join(" ") : null },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/brand`);
}
