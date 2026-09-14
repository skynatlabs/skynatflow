"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan, ALL_ROLES, type Role } from "@/lib/core/access";
import { mintApiKey, revokeApiKey } from "@/lib/api/keys";
import { createEndpoint, deleteEndpoint } from "@/lib/api/webhooks";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // A key is a standing credential to this workspace's money. Owner-level
  // only, regardless of what the key itself will be allowed to do.
  assertCan(access.role, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/settings/developer`);
}

export async function createKeyAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Give the key a name you'll recognise later.");

  const role = String(formData.get("role") ?? "STAFF") as Role;
  if (!ALL_ROLES.includes(role)) throw new Error("Unknown role.");

  const days = Number(formData.get("expiresInDays"));
  const minted = await mintApiKey({
    tenantId,
    name,
    role,
    readOnly: formData.get("readOnly") === "on",
    expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
    createdBy: access.userId,
  });

  refresh(tenantId);
  // Returned, not stored: this is the only moment the secret exists outside
  // the caller's hands, and the page shows it exactly once.
  return { secret: minted.secret, prefix: minted.prefix };
}

export async function revokeKeyAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);
  await revokeApiKey(tenantId, String(formData.get("keyId") ?? ""));
  refresh(tenantId);
}

export async function createEndpointAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const events = String(formData.get("events") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  await createEndpoint({
    tenantId,
    url: String(formData.get("url") ?? "").trim(),
    events,
  });
  refresh(tenantId);
}

export async function deleteEndpointAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);
  await deleteEndpoint(tenantId, String(formData.get("endpointId") ?? ""));
  refresh(tenantId);
}
