import type { Metadata } from "next";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("benefits");
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function BenefitsPage() {
  const page = await getPageForRender("benefits");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
