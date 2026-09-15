"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { addNote, deleteNote, setNotePinned } from "@/lib/core/notes";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("Join this workspace as a member before writing notes on it.");
  return access;
}

export async function addTeamNoteAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("A note needs something in it.");

  await addNote({
    tenantId,
    entityType: "Tenant",
    entityId: tenantId,
    authorId: access.membershipId!,
    title: String(formData.get("title") ?? "").trim() || undefined,
    body,
    audience: String(formData.get("audience") ?? "team") === "private" ? "private" : "team",
    mentions: formData.getAll("mentions").map(String).filter(Boolean),
    pinned: formData.get("pinned") === "on",
  });

  revalidatePath(`/dashboard/${tenantId}/notes`);
}

export async function pinNoteAction(tenantId: string, noteId: string, pinned: boolean) {
  await guard(tenantId);
  await setNotePinned(tenantId, noteId, pinned);
  revalidatePath(`/dashboard/${tenantId}/notes`);
}

export async function deleteNoteAction(tenantId: string, noteId: string) {
  const access = await guard(tenantId);
  await deleteNote(tenantId, noteId, access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/notes`);
}
