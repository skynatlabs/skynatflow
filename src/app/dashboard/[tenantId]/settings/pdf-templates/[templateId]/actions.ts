"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { updateSectionLayout, updateStyleOverrides } from "@/lib/core/pdfTemplates";

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

export async function saveStyleOverridesAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await updateStyleOverrides({
    tenantId,
    templateId,
    fontFamily: String(formData.get("fontFamily") ?? ""),
    headerLayout: String(formData.get("headerLayout") ?? ""),
    tableHeaderStyle: String(formData.get("tableHeaderStyle") ?? ""),
    logoShape: String(formData.get("logoShape") ?? ""),
  });
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates/${templateId}`);
}
