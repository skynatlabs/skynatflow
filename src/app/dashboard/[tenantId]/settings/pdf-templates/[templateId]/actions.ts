"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { updateSectionLayout } from "@/lib/core/pdfTemplates";

export async function saveSectionLayoutAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const sectionOrder = String(formData.get("sectionOrder") ?? "").split(",").filter(Boolean);
  const hiddenSections = String(formData.get("hiddenSections") ?? "").split(",").filter(Boolean);

  await updateSectionLayout({ tenantId, templateId, sectionOrder, hiddenSections });
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates/${templateId}`);
}
