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
         .kb-marketing palette comment in globals.css). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -left-32 -top-40 h-[420px] w-[420px] rounded-full opacity-30 blur-[90px]"
          style={{ background: "linear-gradient(135deg, var(--kb-accent-a), var(--kb-accent-mid))" }}
        />
        <div
          className="absolute -right-40 top-10 h-[380px] w-[380px] rounded-full opacity-20 blur-[90px]"
          style={{ background: "var(--kb-accent-b)" }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 pb-20 pt-24 lg:grid-cols-[1.05fr_1fr]">
        <div className="text-center lg:text-left">
          <h1
            className="mx-auto max-w-xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:mx-0"
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
          <div className="kb-glossy relative mx-auto aspect-[4/3] w-full max-w-md rounded-[26px] lg:mx-0" />
        )}
      </div>
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
