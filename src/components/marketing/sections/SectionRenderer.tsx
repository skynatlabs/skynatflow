// Renders one CMS section by its template `type`. This is the public-facing
// half of the structured section editor — src/lib/cms/pageTemplates.ts
// defines which sections exist and what type each is; the super-admin
// editor (src/app/admin/pages/[slug]) edits the exact same ResolvedSection
// shape this renders.

import Link from "next/link";
import type { ResolvedSection } from "@/lib/core/cms";

interface GridItem { title?: string; body?: string; imageUrl?: string }
interface TestimonialItem { body?: string; name?: string; role?: string; imageUrl?: string }
interface LogoItem { title?: string; imageUrl?: string; href?: string }
interface CardItem { title?: string; body?: string; imageUrl?: string; href?: string }

export default function SectionRenderer({ section }: { section: ResolvedSection }) {
  switch (section.type) {
    case "hero":
      return <HeroSection section={section} />;
    case "richText":
      return <RichTextSection section={section} />;
    case "imageText":
      return <ImageTextSection section={section} />;
    case "grid":
      return <GridSection section={section} />;
    case "testimonials":
      return <TestimonialsSection section={section} />;
    case "logos":
      return <LogosSection section={section} />;
    case "cards":
      return <CardsSection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    default:
      return null;
  }
}

function HeroSection({ section }: { section: ResolvedSection }) {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
      <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.1] tracking-tight text-[var(--kb-text)] sm:text-5xl">
        {section.heading ?? section.label}
      </h1>
      {section.subheading && (
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--kb-text-dim)]">{section.subheading}</p>
      )}
      {section.ctaLabel && section.ctaHref && (
        <div className="mt-8">
          <Link href={section.ctaHref} className="kb-pill kb-pill-primary !px-6 !py-3 text-sm">
            {section.ctaLabel} &rarr;
          </Link>
        </div>
      )}
      {section.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={section.imageUrl} alt="" className="mx-auto mt-12 max-w-4xl rounded-2xl border border-[var(--kb-panel-border)]" />
      )}
    </section>
  );
}

function RichTextSection({ section }: { section: ResolvedSection }) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      {section.heading && (
        <h2 className="text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
      )}
      {section.body && (
        <div className="mt-4 whitespace-pre-line text-[var(--kb-text-dim)]">{section.body}</div>
      )}
    </section>
  );
}

function ImageTextSection({ section }: { section: ResolvedSection }) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid grid-cols-1 items-center gap-10 sm:grid-cols-2">
        <div>
          {section.heading && (
            <h2 className="text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
          )}
          {section.body && <p className="mt-4 text-[var(--kb-text-dim)]">{section.body}</p>}
        </div>
        {section.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={section.imageUrl} alt="" className="rounded-2xl border border-[var(--kb-panel-border)]" />
        ) : (
          <div className="kb-card aspect-video" />
        )}
      </div>
    </section>
  );
}

function GridSection({ section }: { section: ResolvedSection }) {
  const items = section.items as GridItem[];
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {section.heading && (
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
          {section.subheading && (
            <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">{section.subheading}</p>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <div key={i} className="kb-tile kb-tint-mint">
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-8 w-8 rounded" />
              )}
              {item.title && <p className="mt-3 text-lg font-bold">{item.title}</p>}
              {item.body && <p className="mt-2 text-sm opacity-80">{item.body}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TestimonialsSection({ section }: { section: ResolvedSection }) {
  const items = section.items as TestimonialItem[];
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {section.heading && (
        <h2 className="text-center text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
      )}
      {items.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <div key={i} className="kb-card p-5">
              {item.body && <p className="text-sm text-[var(--kb-text)]">&ldquo;{item.body}&rdquo;</p>}
              <div className="mt-4 flex items-center gap-3">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                )}
                <div>
                  {item.name && <p className="text-sm font-semibold text-[var(--kb-text)]">{item.name}</p>}
                  {item.role && <p className="text-xs text-[var(--kb-text-dim)]">{item.role}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LogosSection({ section }: { section: ResolvedSection }) {
  const items = section.items as LogoItem[];
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {section.heading && (
        <h2 className="text-center text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
      )}
      {items.length > 0 && (
        <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {items.map((item, i) => {
            const Wrapper = item.href ? Link : "div";
            return (
              <Wrapper key={i} href={item.href ?? "#"} className="kb-card flex items-center justify-center gap-2 p-5">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.title ?? ""} className="h-8 max-w-[80%] object-contain" />
                )}
                {!item.imageUrl && item.title && <span className="text-sm font-semibold">{item.title}</span>}
              </Wrapper>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CardsSection({ section }: { section: ResolvedSection }) {
  const items = section.items as CardItem[];
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {section.heading && (
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
          {section.subheading && (
            <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">{section.subheading}</p>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => {
            const card = (
              <div className="kb-card h-full overflow-hidden p-0">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-36 w-full object-cover" />
                )}
                <div className="p-5">
                  {item.title && <p className="font-bold text-[var(--kb-text)]">{item.title}</p>}
                  {item.body && <p className="mt-2 text-sm text-[var(--kb-text-dim)]">{item.body}</p>}
                </div>
              </div>
            );
            return item.href ? (
              <Link key={i} href={item.href}>{card}</Link>
            ) : (
              <div key={i}>{card}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CtaSection({ section }: { section: ResolvedSection }) {
  return (
    <section className="mx-auto max-w-4xl px-6 py-24 text-center">
      {section.heading && (
        <h2 className="text-4xl font-extrabold text-[var(--kb-text)]">{section.heading}</h2>
      )}
      {section.body && <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">{section.body}</p>}
      {section.ctaLabel && section.ctaHref && (
        <div className="mt-8">
          <Link href={section.ctaHref} className="kb-pill kb-pill-primary !px-8 !py-3.5 text-base">
            {section.ctaLabel} &rarr;
          </Link>
        </div>
      )}
    </section>
  );
}
