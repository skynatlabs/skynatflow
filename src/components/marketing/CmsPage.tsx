import SectionRenderer from "@/components/marketing/sections/SectionRenderer";
import type { ResolvedSection } from "@/lib/core/cms";

export default function CmsPage({ sections }: { sections: ResolvedSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <SectionRenderer key={section.key} section={section} />
      ))}
    </>
  );
}
