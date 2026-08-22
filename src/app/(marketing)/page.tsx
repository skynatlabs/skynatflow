import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { getPageForRender } from "@/lib/core/cms";
import CmsPage from "@/components/marketing/CmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageForRender("home");
  return {
    title: page?.title ?? "flow — AI Business Operating System",
    description: page?.metaDescription ?? undefined,
  };
}

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }
  const page = await getPageForRender("home");
  if (!page) return null;
  return <CmsPage sections={page.sections} />;
}
