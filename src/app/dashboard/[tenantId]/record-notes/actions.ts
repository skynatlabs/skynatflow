"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { addComment } from "@/lib/core/comments";
import { prisma } from "@/lib/db";

/** Which records take notes, and where the note appears afterwards. */
const PLACES: Record<string, (tenantId: string, id: string) => string> = {
  Transaction: (t, id) => `/dashboard/${t}/invoices/${id}`,
  Party: (t, id) => `/dashboard/${t}/customers/${id}`,
  Task: (t) => `/dashboard/${t}/tasks`,
  JobCard: (t) => `/dashboard/${t}/job-cards`,
  DeliveryNote: (t, id) => `/dashboard/${t}/delivery-notes/${id}`,
};

export async function addRecordNoteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("Join this workspace as a member before writing notes on it.");
  if (!body) throw new Error("A note needs something in it.");
  if (!PLACES[entityType]) throw new Error("Notes cannot be attached to that.");

  // The record has to be in this workspace: the id comes off a form.
  const owned =
    entityType === "Transaction"
      ? await prisma.transaction.count({ where: { id: entityId, tenantId } })
      : entityType === "Party"
        ? await prisma.party.count({ where: { id: entityId, tenantId } })
        : entityType === "Task"
          ? await prisma.task.count({ where: { id: entityId, tenantId } })
          : entityType === "JobCard"
            ? await prisma.jobCard.count({ where: { id: entityId, tenantId } })
            : await prisma.deliveryNote.count({ where: { id: entityId, tenantId } });
  if (owned === 0) throw new Error("That record is not in this workspace.");

  await addComment({ tenantId, entityType, entityId, authorId: access.membershipId, body });
  revalidatePath(PLACES[entityType](tenantId, entityId));
}
