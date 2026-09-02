"use client";

// Renders one CMS section by its template `type`. This is the public-facing
// half of the structured section editor — src/lib/cms/pageTemplates.ts
// defines which sections exist and what type each is; the super-admin
// editor (src/app/admin/pages/[slug]) edits the exact same ResolvedSection
// shape this renders.

import Link from "next/link";
import MotionLink from "@/components/marketing/MotionLink";
import type { ResolvedSection } from "@/lib/core/cms";

const ELASTIC_HOVER = { whileHover: { scale: 1.05 }, whileTap: { scale: 0.96 }, transition: { type: "spring" as const, stiffness: 400, damping: 15 } };

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
    <section className="relative overflow-hidden">
      {/* Soft blurred color field — pink/orange kept as one gradient family,
         blue as its own separate blob, never blended together (see the
         .kb-marketing palette comment in globals.css). Three blobs, sized
         and placed to match the approved concept mockup exactly. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full opacity-30 blur-[90px]"
          style={{ background: "linear-gradient(135deg, var(--kb-accent-a), var(--kb-accent-mid))" }}
        />
        <div
          className="absolute -right-40 top-[15%] h-[420px] w-[420px] rounded-full opacity-25 blur-[90px]"
          style={{ background: "var(--kb-accent-b)" }}
        />
        <div
          className="absolute -bottom-36 left-[28%] h-[380px] w-[380px] rounded-full opacity-20 blur-[90px]"
          style={{ background: "var(--kb-accent-mid)" }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 pb-24 pt-24 lg:grid-cols-[1.05fr_1fr]">
        <div className="text-center lg:text-left">
          <span className="kb-card-light inline-flex items-center gap-2 rounded-full border border-[var(--kb-panel-border)] px-3.5 py-1.5 text-xs font-bold text-[var(--kb-text-dim)]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--kb-accent-b)" }} />
            Built for busy business owners
          </span>
          <h1
            className="mx-auto mt-6 max-w-xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:mx-0"
            style={{
              fontFamily: "var(--font-display), Fraunces, serif",
              background: "linear-gradient(100deg, var(--kb-accent-a) 10%, var(--kb-accent-mid) 90%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {section.heading ?? section.label}
          </h1>
          {section.subheading && (
            <p className="mx-auto mt-6 max-w-lg text-lg text-[var(--kb-text-dim)] lg:mx-0">{section.subheading}</p>
          )}
          {section.ctaLabel && section.ctaHref && (
            <div className="mt-9">
              <MotionLink href={section.ctaHref} className="kb-pill kb-pill-primary !px-6 !py-3 text-sm" {...ELASTIC_HOVER}>
                {section.ctaLabel} &rarr;
              </MotionLink>
            </div>
          )}
        </div>

        {section.imageUrl ? (
          <div className="relative mx-auto w-full max-w-md lg:mx-0">
            <div
              className="absolute inset-0 translate-x-3 translate-y-3 rounded-[26px] opacity-70 blur-sm"
              style={{ background: "linear-gradient(150deg, var(--kb-accent-a), var(--kb-accent-mid))" }}
              aria-hidden
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={section.imageUrl}
              alt=""
              className="relative rounded-[26px] border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] shadow-xl"
            />
          </div>
        ) : (
          <HeroIllustration />
        )}
      </div>
    </section>
  );
}

// Default hero visual when no CMS image is set — an illustrative sample
// quote card (example data, not a claim about this company's real
// performance) plus two floating widget chips, matching the approved
// concept mockup's composition. Purely decorative UI, same category as any
// product-screenshot hero graphic.
function HeroIllustration() {
  return (
    <div className="relative mx-auto h-[420px] w-full max-w-md lg:mx-0">
      <div
        className="kb-scatter absolute right-2 top-0 w-[300px] rounded-[22px] p-6 text-white shadow-2xl"
        style={{ background: "linear-gradient(150deg, var(--kb-accent-a) 0%, var(--kb-accent-mid) 100%)" }}
      >
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide opacity-75">Quote #1042</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-extrabold">Accepted</span>
        </div>
        <p className="mt-5 font-serif text-4xl font-medium" style={{ fontFamily: "var(--font-display), Fraunces, serif" }}>
          R85,000
        </p>
        <p className="mt-1 text-sm opacity-85">Jane Homeowner · 8kVA solar system</p>
        <div className="mt-6 flex h-10 items-end gap-1">
          {[40, 65, 30, 80, 50, 95, 60, 75, 45].map((h, i) => (
            <span key={i} className="w-1.5 rounded-sm bg-white/50" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className="kb-scatter kb-card-light absolute left-0 top-[230px] w-[190px] overflow-hidden rounded-2xl border-t-[3px] p-4" style={{ borderTopColor: "var(--kb-accent-b)" }}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--kb-text-dim)]">Collected, 12wk</p>
        <p className="mt-1 text-lg font-semibold" style={{ color: "var(--kb-accent-b)" }}>R612,400</p>
        <p className="mt-0.5 text-xs font-bold" style={{ color: "var(--kb-tint-mint-ink)" }}>&uarr; 18% vs last period</p>
      </div>

      <div className="kb-scatter kb-card-light absolute left-10 bottom-0 flex w-[220px] items-center gap-3 overflow-hidden rounded-2xl border-t-[3px] p-4" style={{ borderTopColor: "var(--kb-tint-mint-ink)" }}>
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(var(--kb-tint-mint-ink) 0deg 252deg, var(--kb-panel-border) 252deg 360deg)` }}
        >
          <div className="h-8 w-8 rounded-full" style={{ background: "var(--kb-panel)" }} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--kb-text-dim)]">Pipeline won</p>
          <p className="text-base font-semibold text-[var(--kb-text)]">70%</p>
        </div>
      </div>
    </div>
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
    <section className="py-20" style={{ background: "var(--kb-navy)" }}>
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-10 px-6 sm:grid-cols-2">
        <div>
          {section.heading && (
            <h2 className="text-3xl font-extrabold text-white">{section.heading}</h2>
          )}
          {section.body && <p className="mt-4 text-white/60">{section.body}</p>}
        </div>
        {section.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={section.imageUrl} alt="" className="rounded-2xl border border-white/10" />
        ) : (
          <div className="kb-glossy aspect-video rounded-2xl" />
        )}
      </div>
    </section>
  );
}

// Cycled instead of a single flat color across every card — a flat grid of
// identical white tiles is exactly what the approved concept mockup moved
// away from. Each card gets its own resting treatment (light/dark/two
// accent gradients) and its own ambient float animation, so a row of cards
// reads as things placed on the page rather than a table.
const CARD_VARIANTS = ["kb-card-light", "kb-card-dark", "kb-card-accent", "kb-card-accent2"];

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
        <div className="mt-10 flex flex-wrap justify-center gap-7">
          {items.map((item, i) => {
            const variant = CARD_VARIANTS[i % CARD_VARIANTS.length];
            const mutedClass = variant === "kb-card-light" ? "text-[var(--kb-text-dim)]" : "kb-muted";
            return (
              <div key={i} className={`kb-scatter ${variant} w-[280px] rounded-[20px] p-7`}>
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-8 w-8 rounded" />
                )}
                {item.title && <p className="mt-3 text-lg font-bold">{item.title}</p>}
                {item.body && <p className={`mt-2 text-sm ${mutedClass}`}>{item.body}</p>}
              </div>
            );
          })}
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
        <div className="mt-10 flex flex-wrap justify-center gap-7">
          {items.map((item, i) => {
            const variant = CARD_VARIANTS[i % CARD_VARIANTS.length];
            const mutedClass = variant === "kb-card-light" ? "text-[var(--kb-text-dim)]" : "kb-muted";
            return (
              <div key={i} className={`kb-scatter ${variant} w-[300px] rounded-[20px] p-6`}>
                {item.body && <p className="text-sm">&ldquo;{item.body}&rdquo;</p>}
                <div className="mt-4 flex items-center gap-3">
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                  )}
                  <div>
                    {item.name && <p className="text-sm font-semibold">{item.name}</p>}
                    {item.role && <p className={`text-xs ${mutedClass}`}>{item.role}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LogosSection({ section }: { section: ResolvedSection }) {
  const items = section.items as LogoItem[];
  return (
    <section className="py-16" style={{ background: "var(--kb-navy)" }}>
      <div className="mx-auto max-w-6xl px-6">
        {section.heading && (
          <h2 className="text-center text-3xl font-extrabold text-white">{section.heading}</h2>
        )}
        {items.length > 0 && (
          <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-4">
            {items.map((item, i) => {
              const Wrapper = item.href ? Link : "div";
              return (
                <Wrapper
                  key={i}
                  href={item.href ?? "#"}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                >
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.title ?? ""} className="h-8 max-w-[80%] object-contain" />
                  )}
                  {!item.imageUrl && item.title && (
                    <span className="text-sm font-semibold text-white/90">{item.title}</span>
                  )}
                </Wrapper>
              );
            })}
          </div>
        )}
      </div>
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
        <div className="mt-10 flex flex-wrap justify-center gap-7">
          {items.map((item, i) => {
            const variant = CARD_VARIANTS[i % CARD_VARIANTS.length];
            const mutedClass = variant === "kb-card-light" ? "text-[var(--kb-text-dim)]" : "kb-muted";
            const card = (
              <div className={`kb-scatter ${variant} h-full w-[280px] overflow-hidden rounded-[20px]`}>
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-36 w-full object-cover" />
                )}
                <div className="p-5">
                  {item.title && <p className="font-bold">{item.title}</p>}
                  {item.body && <p className={`mt-2 text-sm ${mutedClass}`}>{item.body}</p>}
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
    <section className="py-24" style={{ background: "var(--kb-navy)" }}>
      <div className="mx-auto max-w-4xl px-6 text-center">
        {section.heading && (
          <h2 className="text-4xl font-extrabold text-white">{section.heading}</h2>
        )}
        {section.body && <p className="mx-auto mt-3 max-w-xl text-white/60">{section.body}</p>}
        {section.ctaLabel && section.ctaHref && (
          <div className="mt-8">
            <MotionLink href={section.ctaHref} className="kb-pill kb-pill-primary !px-8 !py-3.5 text-base" {...ELASTIC_HOVER}>
              {section.ctaLabel} &rarr;
            </MotionLink>
          </div>
        )}
      </div>
    </section>
  );
}
