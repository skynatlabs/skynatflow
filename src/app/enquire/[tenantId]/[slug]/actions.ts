"use server";

import { submitLeadForm } from "@/lib/core/leadForms";

/**
 * A stranger submitting a form.
 *
 * Public by design, so it takes the tenant and the form from the address and
 * nothing else — every field it reads is one the form itself declared, and a
 * field that is not on the form is ignored rather than stored.
 */
export async function submitEnquiryAction(formData: FormData): Promise<{ reply: string }> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const slug = String(formData.get("slug") ?? "");

  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "tenantId" || key === "slug") continue;
    if (typeof value === "string") answers[key] = value.trim();
  }

  const result = await submitLeadForm({ tenantId, slug, answers, source: "web" });
  return { reply: result.reply };
}
