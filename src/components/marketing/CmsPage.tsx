import SectionRenderer from "@/components/marketing/sections/SectionRenderer";
import Reveal from "@/components/marketing/Reveal";
import type { ResolvedSection } from "@/lib/core/cms";

export default function CmsPage({ sections }: { sections: ResolvedSection[] }) {
  return (
    <>
      {sections.map((section, i) => (
        <Reveal key={section.key} delay={Math.min(i, 3) * 0.06}>
          <SectionRenderer section={section} />
        </Reveal>
      ))}
    </>
  );
}
