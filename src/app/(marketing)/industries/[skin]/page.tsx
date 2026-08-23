import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NicheSkin } from "@prisma/client";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { getPageForRender } from "@/lib/core/cms";
import { industrySlug } from "@/lib/cms/pageTemplates";
import CmsPage from "@/components/marketing/CmsPage";
import PipelinePreview from "@/components/marketing/PipelinePreview";

function resolveSkin(param: string): NicheSkin | null {
  const upper = param.toUpperCase();
  return upper in NICHE_CONFIGS ? (upper as NicheSkin) : null;
}

export async function generateStaticParams() {
  return Object.keys(NICHE_CONFIGS).map((skin) => ({ skin: skin.toLowerCase() }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ skin: string }>;
}): Promise<Metadata> {
  const skin = resolveSkin((await params).skin);
  if (!skin) return {};
  const page = await getPageForRender(industrySlug(skin));
  return { title: page?.title, description: page?.metaDescription ?? undefined };
}

export default async function IndustryPage({ params }: { params: Promise<{ skin: string }> }) {
  const skin = resolveSkin((await params).skin);
  if (!skin) notFound();

  const page = await getPageForRender(industrySlug(skin));
  if (!page) notFound();

  const config = NICHE_CONFIGS[skin];

  return (
    <>
      <CmsPage sections={page.sections} />
      {/* Live pipeline preview — derived from NICHE_CONFIGS, not CMS-editable */}
      <PipelinePreview label={config.label} stages={config.pipeline} />
    </>
  );
}
