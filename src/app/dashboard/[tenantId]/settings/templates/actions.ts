"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createProposalTemplate, deleteProposalTemplate } from "@/lib/core/templates";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function createTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const name = String(formData.get("name") ?? "").trim();
  const introText = String(formData.get("introText") ?? "").trim();
  const scopeOfWork = String(formData.get("scopeOfWork") ?? "").trim();
  if (!name) throw new Error("Template name is required.");

  await createProposalTemplate({
    tenantId,
    name,
    introText: introText || undefined,
    scopeOfWork: scopeOfWork || undefined,
  });

  revalidatePath(`/dashboard/${tenantId}/settings/templates`);
}

export async function deleteTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const existing = await prisma.proposalTemplate.findUnique({ where: { id: templateId } });
  if (!existing || existing.tenantId !== tenantId) throw new Error("Template not found.");

  await deleteProposalTemplate(templateId);
  revalidatePath(`/dashboard/${tenantId}/settings/templates`);
}
