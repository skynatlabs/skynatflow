"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { sendQuote } from "@/lib/core/money";

export async function sendQuoteNowAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  const quoteId = String(formData.get("quoteId") ?? "");
  await sendQuote(quoteId);
  revalidatePath(`/dashboard/${tenantId}/unsent-quotes`);
}
