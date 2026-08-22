// CRUD + read helpers for the marketing site CMS (PageContent/PageSection).
// Content is platform-global (not tenant-scoped) — access control is
// requireSuperAdmin() for writes, public for reads.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPageTemplate, PAGE_TEMPLATES, type SectionTemplate } from "@/lib/cms/pageTemplates";

export interface ResolvedSection extends SectionTemplate {
  id: string | null; // null when this section has never been saved — render as empty
  heading: string | null;
  subheading: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  items: unknown[];
}

// Merges saved PageSection rows onto the page's template so every template
// slot always renders — a newly added template section shows up empty
// rather than 404ing or crashing, both on the public page and in the editor.
export async function getPageForRender(slug: string) {
  const template = getPageTemplate(slug);
  if (!template) return null;

  const page = await prisma.pageContent.findUnique({
    where: { slug },
    include: { sections: true },
  });

  const savedByKey = new Map((page?.sections ?? []).map((s) => [s.key, s]));

  const sections: ResolvedSection[] = template.sections.map((slot) => {
    const saved = savedByKey.get(slot.key);
    return {
      ...slot,
      id: saved?.id ?? null,
      heading: saved?.heading ?? null,
      subheading: saved?.subheading ?? null,
      body: saved?.body ?? null,
      imageUrl: saved?.imageUrl ?? null,
      ctaLabel: saved?.ctaLabel ?? null,
      ctaHref: saved?.ctaHref ?? null,
      items: (saved?.items as unknown[]) ?? [],
    };
  });

  return {
    slug: template.slug,
    title: page?.title ?? template.title,
    metaDescription: page?.metaDescription ?? null,
    sections,
  };
}

export async function listPagesForAdmin() {
  const saved = await prisma.pageContent.findMany({ select: { slug: true, updatedAt: true } });
  const updatedBySlug = new Map(saved.map((p) => [p.slug, p.updatedAt]));
  return PAGE_TEMPLATES.map((t) => ({
    slug: t.slug,
    title: t.title,
    path: t.path,
    group: t.group,
    updatedAt: updatedBySlug.get(t.slug) ?? null,
  }));
}

export async function upsertPageSection(params: {
  slug: string;
  key: string;
  title: string; // page title, kept in sync each save
  heading?: string | null;
  subheading?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  items?: unknown[];
  updatedByUserId: string;
}) {
  const template = getPageTemplate(params.slug);
  if (!template) throw new Error(`Unknown page slug: ${params.slug}`);
  const slot = template.sections.find((s) => s.key === params.key);
  if (!slot) throw new Error(`Unknown section key "${params.key}" for page "${params.slug}"`);

  const page = await prisma.pageContent.upsert({
    where: { slug: params.slug },
    create: { slug: params.slug, title: params.title, updatedByUserId: params.updatedByUserId },
    update: { title: params.title, updatedByUserId: params.updatedByUserId },
  });

  return prisma.pageSection.upsert({
    where: { pageId_key: { pageId: page.id, key: params.key } },
    create: {
      pageId: page.id,
      key: params.key,
      heading: params.heading ?? null,
      subheading: params.subheading ?? null,
      body: params.body ?? null,
      imageUrl: params.imageUrl ?? null,
      ctaLabel: params.ctaLabel ?? null,
      ctaHref: params.ctaHref ?? null,
      items: (params.items ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    update: {
      heading: params.heading ?? null,
      subheading: params.subheading ?? null,
      body: params.body ?? null,
      imageUrl: params.imageUrl ?? null,
      ctaLabel: params.ctaLabel ?? null,
      ctaHref: params.ctaHref ?? null,
      items: (params.items ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
