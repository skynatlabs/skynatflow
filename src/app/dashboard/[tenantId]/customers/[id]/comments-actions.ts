"use server";

import { revalidatePath } from "next/cache";
import { addComment } from "@/lib/core/comments";
import { requireTenantAccess } from "@/lib/auth/tenant-access";

export async function addCustomerCommentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) {
    throw new Error("Super-admin accounts can't post comments — join the tenant as a member first.");
  }
  if (!body) throw new Error("Comment can't be empty.");

  await addComment({
    tenantId,
    entityType: "Party",
    entityId: customerId,
    authorId: access.membershipId,
    body,
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}
