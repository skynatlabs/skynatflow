import type { Metadata } from "next";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("case-studies");
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function CaseStudiesPage() {
  const page = await getPageForRender("case-studies");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
