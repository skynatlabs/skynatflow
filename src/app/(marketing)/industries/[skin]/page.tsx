import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NicheSkin } from "@prisma/client";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { getPageForRender } from "@/lib/core/cms";
import { industrySlug } from "@/lib/cms/pageTemplates";
import CmsPage from "@/components/marketing/CmsPage";

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
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-center text-3xl font-extrabold text-[var(--kb-text)]">
          Your {config.label.toLowerCase()} pipeline, out of the box
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {config.pipeline.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-2">
              <span className="kb-pill kb-pill-ghost">{stage.label}</span>
              {i < config.pipeline.length - 1 && (
                <span className="text-[var(--kb-text-dim)]">&rarr;</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
