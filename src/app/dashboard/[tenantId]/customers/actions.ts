"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { PartyRole } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function createCustomerAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const party = await createParty({
    tenantId,
    role: tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
    name,
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim() || undefined,
    companyName: String(formData.get("companyName") ?? "").trim() || undefined,
    vatNumber: String(formData.get("vatNumber") ?? "").trim() || undefined,
    addressLine: String(formData.get("addressLine") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    postalCode: String(formData.get("postalCode") ?? "").trim() || undefined,
    country: String(formData.get("country") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });

  redirect(`/dashboard/${tenantId}/customers/${party.id}`);
}
