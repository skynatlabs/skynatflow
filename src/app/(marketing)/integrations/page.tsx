import type { Metadata } from "next";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("integrations");
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function IntegrationsPage() {
  const page = await getPageForRender("integrations");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
