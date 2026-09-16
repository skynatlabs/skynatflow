"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { addSystem, recordImport, removeSystem, retireSystem } from "@/lib/core/systems";
import { prisma } from "@/lib/db";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Saying what the business runs, and pulling its history in, is the same
  // bar as maintaining the catalogue those records land in.
  assertCan(access.role, "product:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/systems`);
}

export async function addSystemAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  await addSystem({
    tenantId,
    systemKey: String(formData.get("systemKey") ?? ""),
    label: String(formData.get("label") ?? "") || null,
    isSystemOfRecord: String(formData.get("isSystemOfRecord") ?? "") !== "no",
    notes: String(formData.get("notes") ?? "") || null,
  });
  refresh(tenantId);
}

/** They have moved off it. Kept on the list, dated, rather than deleted. */
export async function retireSystemAction(tenantId: string, systemKey: string) {
  await guard(tenantId);
  await retireSystem(tenantId, systemKey);
  refresh(tenantId);
}

export async function removeSystemAction(tenantId: string, systemKey: string) {
  await guard(tenantId);
  await removeSystem(tenantId, systemKey);
  refresh(tenantId);
}

/** Flip whether the business's real records still live over there. */
export async function setSystemOfRecordAction(tenantId: string, systemKey: string, isSystemOfRecord: boolean) {
  await guard(tenantId);
  const existing = await prisma.connectedSystem.findUnique({
    where: { tenantId_systemKey: { tenantId, systemKey } },
    select: { id: true },
  });
  if (!existing) throw new Error("That system is not on this workspace.");
  await prisma.connectedSystem.update({ where: { id: existing.id }, data: { isSystemOfRecord } });
  refresh(tenantId);
}

/** Called by the import panel once records have actually landed. */
export async function recordImportAction(tenantId: string, systemKey: string, records: number) {
  await guard(tenantId);
  await recordImport(tenantId, systemKey, records);
  refresh(tenantId);
}
