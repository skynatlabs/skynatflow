import type { Metadata } from "next";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("comparison");
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function ComparePage() {
  const page = await getPageForRender("comparison");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
