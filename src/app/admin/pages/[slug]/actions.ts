"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { upsertPageSection } from "@/lib/core/cms";
import { getPageTemplate } from "@/lib/cms/pageTemplates";

export async function saveSectionAction(formData: FormData) {
  const access = await requireSuperAdmin();

  const slug = String(formData.get("slug") ?? "");
  const key = String(formData.get("key") ?? "");
  const template = getPageTemplate(slug);
  if (!template) throw new Error(`Unknown page slug: ${slug}`);

  const str = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };

  let items: unknown[] = [];
  const itemsRaw = formData.get("items");
  if (typeof itemsRaw === "string" && itemsRaw.trim() !== "") {
    items = JSON.parse(itemsRaw);
  }

  await upsertPageSection({
    slug,
    key,
    title: template.title,
    heading: str("heading"),
    subheading: str("subheading"),
    body: str("body"),
    imageUrl: str("imageUrl"),
    ctaLabel: str("ctaLabel"),
    ctaHref: str("ctaHref"),
    items,
    updatedByUserId: access.userId,
  });

  revalidatePath(`/admin/pages/${slug}`);
  revalidatePath(template.path);
}
