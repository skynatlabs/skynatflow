import { notFound } from "next/navigation";
import Link from "next/link";
import { getPageTemplate } from "@/lib/cms/pageTemplates";
import { getPageForRender } from "@/lib/core/cms";
import SectionEditor from "./SectionEditor";

export default async function AdminPageEditor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const template = getPageTemplate(slug);
  if (!template) notFound();

  const page = await getPageForRender(slug);
  if (!page) notFound();

  return (
    <div>
      <Link href="/admin" className="text-sm text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]">
        &larr; All pages
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--kb-text)]">{template.title}</h1>
        <a
          href={template.path}
          target="_blank"
          rel="noreferrer"
          className="kb-pill kb-pill-ghost !py-1.5 !px-4 text-sm"
        >
          View page &rarr;
        </a>
      </div>

      <div className="mt-6 flex flex-col gap-5">
        {page.sections.map((section) => (
          <SectionEditor key={section.key} slug={slug} section={section} />
        ))}
      </div>
    </div>
  );
}
