// Single source of truth for what sections exist on which marketing page,
// and how each renders. Drives both the public SectionRenderer and the
// super-admin editor form — add a section here and it shows up in both
// automatically. Deliberately a fixed set of named slots per page
// (structured editor), not a free block builder: an admin can edit text and
// images and add/remove repeatable items within a section, but can't
// rearrange or invent new sections.

import { NicheSkin } from "@prisma/client";
import { NICHE_CONFIGS } from "@/lib/niches/config";

export type SectionType =
  | "hero"
  | "richText"
  | "imageText"
  | "grid"
  | "testimonials"
  | "logos"
  | "cards"
  | "cta";

export interface SectionTemplate {
  key: string;
  type: SectionType;
  label: string; // shown as the section's heading in the admin editor
}

export interface PageTemplate {
  slug: string;
  title: string;
  path: string; // public route
  group: "core" | "industry";
  sections: SectionTemplate[];
}

const CORE_SECTIONS: Record<string, SectionTemplate[]> = {
  home: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "stats", type: "grid", label: "Stats strip" },
    { key: "before_after", type: "cards", label: "Before / after transformation" },
    { key: "verticals", type: "cards", label: "Verticals grid" },
    { key: "features", type: "grid", label: "Feature grid" },
    { key: "ai_section", type: "imageText", label: "AI callout" },
    { key: "faq", type: "grid", label: "FAQ / objections" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  about: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "story", type: "richText", label: "Our story" },
    { key: "values", type: "grid", label: "Values / team" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  "ai-agents": [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "how_it_works", type: "imageText", label: "How it works" },
    { key: "features", type: "grid", label: "AI feature grid" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  "case-studies": [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "cases", type: "cards", label: "Case study cards" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  benefits: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "benefits_grid", type: "grid", label: "Benefit tiles" },
    { key: "stats", type: "grid", label: "Stats strip" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  integrations: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "logos", type: "logos", label: "Integration logos" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  comparison: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "why_flow_wins", type: "grid", label: "Why flow wins" },
    { key: "vs_tools", type: "cards", label: "Vs. specific tools" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
  pricing: [
    { key: "hero", type: "hero", label: "Hero" },
    { key: "tiers", type: "cards", label: "Pricing tiers" },
    { key: "roi", type: "imageText", label: "ROI framing" },
    { key: "faq", type: "grid", label: "FAQ / objections" },
    { key: "cta", type: "cta", label: "Final call to action" },
  ],
};

const INDUSTRY_SECTIONS: SectionTemplate[] = [
  { key: "hero", type: "hero", label: "Hero" },
  { key: "pain_points", type: "grid", label: "Pain points / benefits" },
  { key: "how_it_works", type: "imageText", label: "How it works for this industry" },
  { key: "testimonials", type: "testimonials", label: "Testimonials" },
  { key: "faq", type: "grid", label: "FAQ / objections" },
  { key: "cta", type: "cta", label: "Final call to action" },
];

export const NICHE_SLUGS = Object.keys(NICHE_CONFIGS) as NicheSkin[];

export function industrySlug(skin: NicheSkin) {
  return `industry-${skin}`;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { slug: "home", title: "Home", path: "/", group: "core", sections: CORE_SECTIONS.home },
  { slug: "about", title: "About Us", path: "/about", group: "core", sections: CORE_SECTIONS.about },
  { slug: "ai-agents", title: "AI & Agents", path: "/ai", group: "core", sections: CORE_SECTIONS["ai-agents"] },
  { slug: "case-studies", title: "Case Studies", path: "/case-studies", group: "core", sections: CORE_SECTIONS["case-studies"] },
  { slug: "benefits", title: "Benefits", path: "/benefits", group: "core", sections: CORE_SECTIONS.benefits },
  { slug: "integrations", title: "Integrations", path: "/integrations", group: "core", sections: CORE_SECTIONS.integrations },
  { slug: "comparison", title: "Compare", path: "/compare", group: "core", sections: CORE_SECTIONS.comparison },
  { slug: "pricing", title: "Pricing", path: "/pricing", group: "core", sections: CORE_SECTIONS.pricing },
  ...NICHE_SLUGS.map((skin): PageTemplate => ({
    slug: industrySlug(skin),
    title: NICHE_CONFIGS[skin].label,
    path: `/industries/${skin.toLowerCase()}`,
    group: "industry",
    sections: INDUSTRY_SECTIONS,
  })),
];

export function getPageTemplate(slug: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((p) => p.slug === slug);
}
