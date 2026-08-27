import type { Metadata } from "next";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("pricing");
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function PricingPage() {
  const page = await getPageForRender("pricing");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
